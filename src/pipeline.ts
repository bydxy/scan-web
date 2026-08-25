import type { ScannerAdapter, ScanResult } from './scanner/index.js';

/**
 * 高速抽帧管线（连续多码模式）
 *
 * 铁律：忙则丢帧，绝不排队——解码落后时宁可跳帧，
 * 也不让识别停留在几百毫秒前的旧画面上。
 *
 * 命中后不停止：软复位阶梯（misses-=2），持续跟踪移动中的码。
 *
 * 分辨率/策略阶梯（连续未命中自动升级）：
 *   0-3 帧   fast  @640   极速档
 *   4-7 帧   fast  @960   远距离小码升分辨率
 *   8-15 帧  rescue@960   开启 try* 启发式（残缺/反色/歪斜）
 *   ≥16 帧   rescue@原图  最后手段
 */

const ROI_FAST = 640;
const ROI_HIGH = 960;
const SHARP_SKIP_THRESHOLD = 6; // 拉普拉斯方差低于此视为运动模糊帧

export interface FrameHits {
  results: ScanResult[];
  roi: { x: number; y: number; w: number; h: number };
  size: number; // 送解码的方形边长（像素）
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

    const [tier, size] = this.currentTier(vw, vh);
    const roi = this.roiInVideo(vw, vh);
    const imageData = this.grab(roi, Math.min(size, Math.max(roi.w, roi.h)));
    if (!imageData) return;

    if (tier !== 'rescue' && !isSharpEnough(imageData)) {
      this.misses++; // 模糊帧不送解码，直接计入升级阶梯
      return;
    }

    try {
      const results = await this.scanner.detect(imageData, tier);
      if (results.length > 0) {
        this.misses = Math.max(0, this.misses - 2); // 软复位，保持跟踪不降档震荡
        this.onHits({ results, roi, size: imageData.width });
      } else {
        this.misses++;
      }
    } catch {
      this.misses++;
    }
  }

  /** 策略阶梯 */
  private currentTier(
    vw: number,
    vh: number
  ): [tier: 'fast' | 'rescue', size: number] {
    if (this.misses < 4) return ['fast', ROI_FAST];
    if (this.misses < 8) return ['fast', ROI_HIGH];
    if (this.misses < 16) return ['rescue', ROI_HIGH];
    return ['rescue', Math.min(vw, vh)];
  }

  /**
   * 取景框在视频像素坐标系中的位置。
   * 屏幕上取景框为居中正方形（72% 短边），object-fit: cover 存在裁切偏移，
   * 必须按 cover 缩放映射回视频坐标，否则扫到的区域和看到的区域不一致。
   */
  private roiInVideo(vw: number, vh: number): { x: number; y: number; w: number; h: number } {
    const cw = window.innerWidth;
    const ch = window.innerHeight;
    const sideCss = Math.min(cw, ch) * 0.72;
    const scale = Math.max(cw / vw, ch / vh); // cover
    const offsetX = (cw - vw * scale) / 2;
    const offsetY = (ch - vh * scale) / 2;

    const x = (-offsetX + (cw - sideCss) / 2) / scale;
    const y = (-offsetY + (ch - sideCss) / 2) / scale;
    const w = sideCss / scale;

    // 裁到画面内并保证最小尺寸
    const cx = Math.max(0, Math.min(x, vw - 16));
    const cy = Math.max(0, Math.min(y, vh - 16));
    const cw2 = Math.max(16, Math.min(w, vw - cx));
    const ch2 = Math.max(16, Math.min(w, vh - cy));
    return { x: cx, y: cy, w: cw2, h: ch2 };
  }

  private grab(
    roi: { x: number; y: number; w: number; h: number },
    targetSize: number
  ): ImageData | null {
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    this.canvas.width = targetSize;
    this.canvas.height = targetSize;
    ctx.drawImage(this.video, roi.x, roi.y, roi.w, roi.h, 0, 0, targetSize, targetSize);
    return ctx.getImageData(0, 0, targetSize, targetSize);
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
