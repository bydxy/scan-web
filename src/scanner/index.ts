import { probeNative, NativeEngine } from './native.js';
import { WasmEngine, scanImageFile } from './wasm.js';
import type { ScanResult, ScanTier } from './types.js';
import type { FormatGroup } from '../formats.js';

export { scanImageFile };
export type { ScanResult, ScanTier };

/**
 * 扫描适配器（双引擎 + 升级节流 + 运行期热降级）
 *
 * 极速档：优先原生；原生未命中不立刻调 WASM（避免每帧双引擎开销），
 * 连续 NATIVE_ESCALATE_MISSES 帧未命中才升级 WASM 极速档。
 * 救援档：直接 WASM（原生引擎没有启发式选项控制）。
 * 原生连续抛错 → 永久热切换 WASM。
 */
const NATIVE_ESCALATE_MISSES = 6;
const NATIVE_MAX_CONSECUTIVE_FAILURES = 3;

export class ScannerAdapter {
  private native: NativeEngine | null = null;
  private wasm: WasmEngine | null = null;
  private useNative = false;
  private nativeFailures = 0;
  private nativeMissStreak = 0;
  private group: FormatGroup = 'all';

  static async create(group: FormatGroup): Promise<ScannerAdapter> {
    const adapter = new ScannerAdapter();
    adapter.group = group;
    adapter.useNative = await probeNative(group);
    if (adapter.useNative) {
      try {
        adapter.native = new NativeEngine(group);
      } catch {
        adapter.useNative = false;
      }
    }
    return adapter;
  }

  async setGroup(group: FormatGroup): Promise<void> {
    if (group === this.group) return;
    this.group = group;
    this.nativeMissStreak = 0;
    this.useNative = await probeNative(group);
    this.native = this.useNative ? new NativeEngine(group) : null;
  }

  get engineKind(): 'native' | 'wasm' | 'pending' {
    if (!this.native && !this.wasm) return 'pending';
    return this.useNative ? 'native' : 'wasm';
  }

  async detect(imageData: ImageData, tier: ScanTier): Promise<ScanResult[]> {
    if (this.useNative && tier === 'fast') {
      try {
        const results = await this.native!.detect(imageData);
        if (results.length > 0) {
          this.nativeFailures = 0;
          this.nativeMissStreak = 0;
          return results;
        }
        // 未命中：攒够 streak 才升级 WASM，省去每帧双跑
        if (++this.nativeMissStreak >= NATIVE_ESCALATE_MISSES) {
          this.nativeMissStreak = 0;
          return await this.wasmDetect(imageData, 'fast');
        }
        return [];
      } catch {
        if (++this.nativeFailures >= NATIVE_MAX_CONSECUTIVE_FAILURES) {
          this.degradeToWasm();
        }
      }
    }
    return tier === 'fast' && this.useNative
      ? [] // 原生在岗但本帧因节流跳过 WASM
      : this.wasmDetect(imageData, tier);
  }

  private async wasmDetect(
    imageData: ImageData,
    tier: ScanTier
  ): Promise<ScanResult[]> {
    if (!this.wasm) this.wasm = new WasmEngine();
    return this.wasm.detect(imageData, tier, this.group);
  }

  private degradeToWasm(): void {
    this.useNative = false;
    this.nativeFailures = 0;
    this.nativeMissStreak = 0;
  }
}
