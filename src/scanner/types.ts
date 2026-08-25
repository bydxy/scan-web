export interface ScanResult {
  text: string;
  format: string;
  /** 四角坐标（ROI 图像像素坐标系） */
  corners: Array<{ x: number; y: number }>;
}

export type ScanTier = 'fast' | 'rescue';
