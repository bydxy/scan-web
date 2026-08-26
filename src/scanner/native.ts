import { GROUPS } from '../formats.js';
import type { FormatGroup } from '../formats.js';
import type { ScanResult } from './types.js';

/**
 * 原生引擎能力探测：
 * 仅凭 'BarcodeDetector' in window 不够，必须验证 getSupportedFormats()
 * 覆盖当前分组全部码型；任何异常都视为不可用。
 */
export async function probeNative(group: FormatGroup): Promise<boolean> {
  if (!('BarcodeDetector' in globalThis)) return false;
  try {
    const supported = await BarcodeDetector.getSupportedFormats();
    const set = new Set(supported);
    return GROUPS[group].native.every((f) => set.has(f));
  } catch {
    return false;
  }
}

export class NativeEngine {
  private detector: BarcodeDetector;

  constructor(group: FormatGroup) {
    this.detector = new BarcodeDetector({ formats: [...GROUPS[group].native] });
  }

  async detect(source: ImageBitmapSource): Promise<ScanResult[]> {
    const found = await this.detector.detect(source);
    return found.map((r) => ({
      text: r.rawValue,
      format: r.format,
      corners:
        r.cornerPoints?.map((p) => ({ x: p.x, y: p.y })) ??
        (r.boundingBox ? rectCorners(r.boundingBox) : emptyCorners()),
    }));
  }
}

function rectCorners(b: DOMRectReadOnly) {
  return [
    { x: b.left, y: b.top },
    { x: b.right, y: b.top },
    { x: b.right, y: b.bottom },
    { x: b.left, y: b.bottom },
  ];
}

const emptyCorners = () => [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
