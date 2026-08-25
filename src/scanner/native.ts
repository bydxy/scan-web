import { NATIVE_FORMATS } from './formats.js';
import type { ScanResult } from './types.js';

/**
 * 原生引擎能力探测：
 * 仅凭 'BarcodeDetector' in window 不够，必须验证 getSupportedFormats()
 * 覆盖全部目标码型；任何异常都视为不可用（微信/魔改 WebView 兜底）。
 */
export async function probeNative(): Promise<boolean> {
  if (!('BarcodeDetector' in globalThis)) return false;
  try {
    const supported = await BarcodeDetector.getSupportedFormats();
    const set = new Set(supported);
    return NATIVE_FORMATS.every((f) => set.has(f));
  } catch {
    return false;
  }
}

export class NativeEngine {
  private detector: BarcodeDetector;

  constructor() {
    this.detector = new BarcodeDetector({ formats: [...NATIVE_FORMATS] });
  }

  async detect(source: ImageBitmapSource): Promise<ScanResult[]> {
    const found = await this.detector.detect(source);
    return found.map((r) => ({ text: r.rawValue, format: r.format }));
  }
}
