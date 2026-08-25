import type { ScannerAdapter, ScanResult } from './scanner/index.js';

/**
 * 高速抽帧管线（连续多码 · 全屏识别模式）
 *
 * 铁律：忙则丢帧，绝不排队——解码落后时宁可跳帧，
 * 也不让识别停留在几百毫秒前的旧画面上。
 *
 * 命中后不停止：软复位阶梯（misses-=2），持续跟踪移动中的码。
 *
 * 识别区域：整个可视画面（cover 裁切后的可见部分），
 * 取景框仅为视觉引导。长边降采样阶梯：
 *   0-3 帧   fast  @720   极速档（约 720×405，比旧 640² 更省）
 *   4-7 帧   fast  @1080  小码升分辨率
 *   8-15 帧  rescue@1080  开启 try* 启发式（残缺/反色/歪斜）
 *   ≥16 帧   rescue@原生  最后手段
 */

const LONG_FAST = 720;
const LONG_HIGH = 1080;
const SHARP_SKIP_THRESHOLD = 6; // 拉普拉斯方差低于此视为运动模糊帧

export interface FrameHits {
  results: ScanResult[];
  /** 送解码画面对应的视频源区域 */
  src: { x: number; y: number; w: number; h: number };
  /** 解码画面实际尺寸（像素） */
  out: { w: number; h: number };
}

export class FramePipeline {
  private rafId = 0;
  private busy = false;
  private misses = 0;
  private stopped = true;

  constructor(
    private video: HTMLVideoElement,
    private canvas: HTMLCanvasElement,
    private scanner: ScannerAdapter,
    private onHits: (hits: FrameHits) => void
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.misses = 0;
    this.scheduleNext();
  }

  stop(): void {
    this.stopped = true;
    cancelAnimationFrame(this.rafId);
  }

  resetTier(): void {
    this.misses = 0;
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
    // 忙则丢帧：这是管线速度的核心
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
    const { videoWidth: vw, videoHeight: vh } = this.video;
    if (!vw || !vh) return;

    const [tier, longSide] = this.currentTier(vw, vh);
    const src = this.visibleRect(vw, vh);
    const out = this.grab(src, longSide);
    if (!out) return;

    if (tier !== 'rescue' && !isSharpEnough(out.imageData)) {
      this.misses++; // 模糊帧不送解码，直接计入升级阶梯
      return;
    }

    try {
      const results = await this.scanner.detect(out.imageData, tier);
      if (results.length > 0) {
        this.misses = Math.max(0, this.misses - 2); // 软复位，保持跟踪不降档震荡
        this.onHits({ results, src, out: { w: out.w, h: out.h } });
      } else {
        this.misses++;
      }
    } catch {
      this.misses++;
    }
  }

  /** 策略阶梯 */
  private currentTier(vw: number, vh: number): [tier: 'fast' | 'rescue', longSide: number] {
    if (this.misses < 4) return ['fast', LONG_FAST];
    if (this.misses < 8) return ['fast', LONG_HIGH];
    if (this.misses < 16) return ['rescue', LONG_HIGH];
    return ['rescue', Math.max(vw, vh)];
  }

  /**
   * 屏幕上实际可见的视频区域（object-fit: cover 裁掉了画面边缘，
   * 只识别用户看得见的部分，避免给看不见的区域白付解码算力）。
   */
  private visibleRect(vw: number, vh: number): { x: number; y: number; w: number; h: number } {
    const cw = window.innerWidth;
    const ch = window.innerHeight;
    const scale = Math.max(cw / vw, ch / vh); // cover
    const visW = Math.min(vw, cw / scale);
    const visH = Math.min(vh, ch / scale);
    return {
      x: (vw - visW) / 2,
      y: (vh - visH) / 2,
      w: visW,
      h: visH,
    };
  }

  private grab(
    src: { x: number; y: number; w: number; h: number },
    longSide: number
  ): { imageData: ImageData; w: number; h: number } | null {
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    const k = longSide / Math.max(src.w, src.h);
    const w = Math.round(src.w * k);
    const h = Math.round(src.h * k);
    this.canvas.width = w;
    this.canvas.height = h;
    ctx.drawImage(this.video, src.x, src.y, src.w, src.h, 0, 0, w, h);
    return { imageData: ctx.getImageData(0, 0, w, h), w, h };
  }
}

/** 拉普拉斯方差近似：隔行抽样灰度差分，代价 ~O(N/4)，专筛运动模糊帧 */
function isSharpEnough(img: ImageData): boolean {
  const { data, width, height } = img;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y += 3) {
    for (let x = 1; x < width - 1; x += 3) {
      const i = (y * width + x) * 4;
      const g =
        data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      sum += g;
      sumSq += g * g;
      n++;
    }
  }
  const mean = sum / n;
  // 用亮度方差近似对焦度量（完整拉普拉斯卷积太贵，此近似已足够区分虚焦/清晰）
  const variance = sumSq / n - mean * mean;
  return variance > SHARP_SKIP_THRESHOLD;
}
