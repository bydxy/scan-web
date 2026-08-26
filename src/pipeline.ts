import type { ScannerAdapter, ScanResult } from './scanner/index.js';
import { getSettings } from './settings.js';

/**
 * 高速抽帧管线 v2（全屏/取景框自适应阶梯 + 热点优先 + 多帧确认）
 *
 * 铁律：忙则丢帧，绝不排队。
 *
 * 区域策略（settings.area）：
 *   viewfinder → 先扫取景框 ROI，连续未命中自动扩到全屏，命中回落
 *   full       → 直接全屏
 * 热点优先：刚识别成功的码位置 1.2s 内作为首选小 ROI。
 * 多帧确认：同一文本 ≥CONFIRM_FRAMES 帧才对外发射（防误报闪烁），
 *           单次模式放宽为 1 帧（快进快出）。
 */

const LONG_FAST = 720;
const LONG_HIGH = 1080;
const SHARP_SKIP_THRESHOLD = 14;
const LOW_LIGHT_LUMA = 46;
const CONFIRM_FRAMES = 2;
const HOT_TTL_MS = 1200;

export interface FrameHits {
  results: ScanResult[];
  src: { x: number; y: number; w: number; h: number };
  out: { w: number; h: number };
}

interface PendingCount {
  n: number;
  last: number;
}

export class FramePipeline {
  private ctx: CanvasRenderingContext2D | null = null;
  private rafId = 0;
  private busy = false;
  private misses = 0;
  private stopped = true;
  private pending = new Map<string, PendingCount>();
  private hot: { x: number; y: number; size: number; at: number } | null = null;
  lowLight = false;

  constructor(
    private video: HTMLVideoElement,
    private canvas: HTMLCanvasElement,
    private scanner: ScannerAdapter,
    private onHits: (hits: FrameHits) => void,
    private onAmbient?: (state: { lowLight: boolean }) => void
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.misses = 0;
    this.pending.clear();
    this.scheduleNext();
  }

  stop(): void {
    this.stopped = true;
    cancelAnimationFrame(this.rafId);
  }

  resetTier(): void {
    this.misses = 0;
    this.hot = null;
    this.pending.clear();
  }

  private scheduleNext(): void {
    const video = this.video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
    };
    if (typeof video.requestVideoFrameCallback === 'function') {
      video.requestVideoFrameCallback(() => this.tick());
    } else {
      this.rafId = requestAnimationFrame(() => this.tick());
    }
  }

  private tick(): void {
    if (this.stopped) return;
    if (!this.busy) {
      this.busy = true;
      this.process().finally(() => {
        this.busy = false;
        this.scheduleNext();
      });
    } else {
      this.scheduleNext();
    }
  }

  private async process(): Promise<void> {
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    if (!vw || !vh) return;

    // ---- 选择扫描区域与档位 ----
    let src = this.visibleRect(vw, vh);
    let longSide = LONG_FAST;
    let tier: 'fast' | 'rescue' = 'fast';
    let hotCrop = false;

    const now = Date.now();
    if (this.hot && now - this.hot.at < HOT_TTL_MS) {
      // 热点：上次命中处的小邻域，最快路径
      const half = Math.min(Math.max(this.hot.size, 200), Math.min(vw, vh)) / 1.6;
      src = clampRect(this.hot.x - half, this.hot.y - half, half * 2, half * 2, vw, vh);
      longSide = 480;
      hotCrop = true;
    } else {
      const useViewfinder =
        getSettings().area === 'viewfinder' &&
        !(getSettings().area === 'viewfinder' && this.misses >= 4);
      if (useViewfinder) {
        src = viewfinderRect(vw, vh);
        [tier, longSide] =
          this.misses < 2 ? ['fast', LONG_FAST] : ['fast', LONG_HIGH];
      } else {
        [tier, longSide] = this.fullTier(vw, vh);
      }
    }

    const grab = this.grab(src, longSide);
    if (!grab) return;

    // 环境感知：低光提示
    const luma = meanLuma(grab.imageData);
    const lowNow = luma < LOW_LIGHT_LUMA;
    if (lowNow !== this.lowLight) {
      this.lowLight = lowNow;
      this.onAmbient?.({ lowLight: lowNow });
    }

    // 模糊帧跳过（救援档与热点不跳：热点本就清晰）
    if (tier === 'fast' && !hotCrop && !isSharpEnough(grab.imageData)) {
      this.misses++;
      return;
    }

    try {
      const raw = await this.scanner.detect(grab.imageData, tier);
      if (raw.length > 0) {
        this.misses = Math.max(0, this.misses - 2);
        const first = raw[0];
        const c = first.corners;
        if (c?.length) {
          const xs = c.map((p) => p.x);
          const ys = c.map((p) => p.y);
          const sidePx = Math.max(
            (Math.max(...xs) - Math.min(...xs)) * (src.w / grab.w),
            (Math.max(...ys) - Math.min(...ys)) * (src.h / grab.h)
          );
          const cxV = src.x + ((Math.min(...xs) + Math.max(...xs)) / 2 / grab.w) * src.w;
          const cyV = src.y + ((Math.min(...ys) + Math.max(...ys)) / 2 / grab.h) * src.h;
          this.hot = { x: cxV, y: cyV, size: sidePx * 1.5, at: Date.now() };
        }

        const confirmed = this.confirm(raw);
        if (confirmed.length > 0) {
          this.onHits({ results: confirmed, src, out: { w: grab.w, h: grab.h } });
        }
      } else {
        this.misses++;
        this.hot = null;
      }
    } catch {
      this.misses++;
    }
  }

  /** 多帧确认：同文本累计 ≥CONFIRM_FRAMES 才发射 */
  private confirm(raw: ScanResult[]): ScanResult[] {
    const singleMode = getSettings().mode === 'single';
    const need = singleMode ? 1 : CONFIRM_FRAMES;
    const now = Date.now();
    const out: ScanResult[] = [];
    for (const r of raw) {
      const p = this.pending.get(r.text);
      if (!p || now - p.last > 1500) {
        this.pending.set(r.text, { n: 1, last: now });
      } else {
        p.n++;
        p.last = now;
      }
      if ((this.pending.get(r.text)?.n ?? 0) >= need) out.push(r);
    }
    return need === 1 ? raw : out;
  }

  private fullTier(vw: number, vh: number): ['fast' | 'rescue', number] {
    if (this.misses < 3) return ['fast', LONG_FAST];
    if (this.misses < 7) return ['fast', LONG_HIGH];
    if (this.misses < 15) return ['rescue', LONG_HIGH];
    return ['rescue', Math.max(vw, vh)];
  }

  private visibleRect(vw: number, vh: number): { x: number; y: number; w: number; h: number } {
    const cw = window.innerWidth;
    const ch = window.innerHeight;
    const scale = Math.max(cw / vw, ch / vh);
    const visW = Math.min(vw, cw / scale);
    const visH = Math.min(vh, ch / scale);
    return { x: (vw - visW) / 2, y: (vh - visH) / 2, w: visW, h: visH };
  }

  /** Canvas 上下文缓存；尺寸不变则不重置画布（减少每帧状态重置） */
  private grab(
    src: { x: number; y: number; w: number; h: number },
    longSide: number
  ): { imageData: ImageData; w: number; h: number } | null {
    if (!this.ctx) {
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
      if (!this.ctx) return null;
    }
    const k = longSide / Math.max(src.w, src.h);
    const w = Math.round(src.w * k);
    const h = Math.round(src.h * k);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.ctx.drawImage(this.video, src.x, src.y, src.w, src.h, 0, 0, w, h);
    return { imageData: this.ctx.getImageData(0, 0, w, h), w, h };
  }
}

function clampRect(
  x: number, y: number, w: number, h: number,
  vw: number, vh: number
): { x: number; y: number; w: number; h: number } {
  const cx = Math.max(0, Math.min(x, vw - 32));
  const cy = Math.max(0, Math.min(y, vh - 32));
  return {
    x: cx,
    y: cy,
    w: Math.max(32, Math.min(w, vw - cx)),
    h: Math.max(32, Math.min(h, vh - cy)),
  };
}

/** 取景框区域（72% 短边居中正方形）映射到视频坐标 */
function viewfinderRect(vw: number, vh: number): { x: number; y: number; w: number; h: number } {
  const cw = window.innerWidth;
  const ch = window.innerHeight;
  const sideCss = Math.min(cw, ch) * 0.72;
  const scale = Math.max(cw / vw, ch / vh);
  const offX = (cw - vw * scale) / 2;
  const offY = (ch - vh * scale) / 2;
  const x = (-offX + (cw - sideCss) / 2) / scale;
  const y = (-offY + (ch - sideCss) / 2) / scale;
  const w = sideCss / scale;
  return clampRect(x, y, w, w, vw, vh);
}

/** Laplacian 3×3 卷积方差（抽样），比亮度方差更抗场景误判 */
function isSharpEnough(img: ImageData): boolean {
  const { data, width, height } = img;
  const gray = (i: number) =>
    data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y += 3) {
    for (let x = 1; x < width - 1; x += 3) {
      const i = (y * width + x) * 4;
      const s = (dy: number, dx: number) => gray(i + (dy * width + dx) * 4);
      const lap =
        4 * gray(i) - s(0, -1) - s(0, 1) - s(-1, 0) - s(1, 0);
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean > SHARP_SKIP_THRESHOLD;
}

function meanLuma(img: ImageData): number {
  const { data } = img;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4 * 97) {
    sum += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    n++;
  }
  return sum / Math.max(1, n);
}
