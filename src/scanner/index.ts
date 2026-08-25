import { probeNative, NativeEngine } from './native.js';
import { WasmEngine, scanImageFile } from './wasm.js';
import type { ScanResult, ScanTier } from './types.js';

export { scanImageFile };
export type { ScanResult, ScanTier };

/**
 * 扫描适配器（双引擎 + 运行期热降级）
 *
 * 能力检测链：'BarcodeDetector' in window → getSupportedFormats() 全覆盖
 *   ├─ 通过   → Android Chromium：原生 FAST，WASM RESCUE
 *   └─ 不通过 → Safari/Firefox/WebView：WASM FAST，WASM RESCUE
 *
 * 原生引擎连续抛错 N 次即永久热切换 WASM（微信 XWeb / 魔改 ROM 兜底）。
 */
const NATIVE_MAX_CONSECUTIVE_FAILURES = 3;

export class ScannerAdapter {
  private native: NativeEngine | null = null;
  private wasm: WasmEngine | null = null;
  private useNative = false;
  private nativeFailures = 0;

  /** 首屏轻探测（不加载 WASM），结果缓存 */
  static async create(): Promise<ScannerAdapter> {
    const adapter = new ScannerAdapter();
    adapter.useNative = await probeNative();
    if (adapter.useNative) {
      try {
        adapter.native = new NativeEngine();
      } catch {
        adapter.useNative = false;
      }
    }
    return adapter;
  }

  get engineKind(): 'native' | 'wasm' | 'pending' {
    if (!this.native && !this.wasm) return 'pending';
    return this.useNative ? 'native' : 'wasm';
  }

  async detect(imageData: ImageData, tier: ScanTier): Promise<ScanResult[]> {
    // 救援档永远走 WASM（原生 API 无 try*/binarizer 控制）
    if (this.useNative && tier === 'fast') {
      try {
        const results = await this.native!.detect(imageData);
        this.nativeFailures = 0;
        if (results.length > 0) return results;
        // 原生未命中 → 落到 WASM 极速档再试一次（两引擎互补）
        return await this.wasmDetect(imageData, 'fast');
      } catch {
        if (++this.nativeFailures >= NATIVE_MAX_CONSECUTIVE_FAILURES) {
          this.degradeToWasm();
        }
      }
    }
    return this.wasmDetect(imageData, tier);
  }

  private async wasmDetect(
    imageData: ImageData,
    tier: ScanTier
  ): Promise<ScanResult[]> {
    if (!this.wasm) this.wasm = new WasmEngine();
    return this.wasm.detect(imageData, tier);
  }

  private degradeToWasm(): void {
    this.useNative = false;
    this.nativeFailures = 0;
  }
}
