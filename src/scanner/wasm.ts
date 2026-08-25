import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import type { ReaderOptions } from 'zxing-wasm/reader';
import { ZXING_FORMATS } from './formats.js';
import type { ScanResult } from './types.js';

type WasmModule = typeof import('zxing-wasm/reader');

/**
 * WASM 引擎：zxing-wasm/reader 直连（保留 ReaderOptions 全部控制权）。
 * 模块与 .wasm 均为动态加载 + 同源自托管（locateFile 覆盖，不依赖 CDN），
 * 浏览器 HTTP 缓存生效后二次进入零下载。
 */

let modulePromise: Promise<WasmModule> | null = null;

async function loadModule(): Promise<WasmModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const mod = await import('zxing-wasm/reader');
      mod.prepareZXingModule({
        overrides: { locateFile: () => wasmUrl },
      });
      return mod;
    })();
  }
  return modulePromise;
}

/** 极速档：最小选项集。注意 zxing-wasm 默认 try* 全开，必须显式关闭 */
const FAST_OPTIONS: ReaderOptions = {
  formats: [...ZXING_FORMATS],
  maxNumberOfSymbols: 1,
  tryHarder: false,
  tryRotate: false,
  tryInvert: false,
  tryDownscale: false,
  binarizer: 'LocalAverage',
};

/** 救援档：残缺/污损/反色码，全量启发式 */
const RESCUE_OPTIONS: ReaderOptions = {
  ...FAST_OPTIONS,
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: true,
};

/** 变体档：救援仍失败后的图像变体重试（特殊二值化） */
const VARIANT_PASSES: ReaderOptions[] = [
  RESCUE_OPTIONS,
  { ...RESCUE_OPTIONS, binarizer: 'GlobalHistogram' },
];

export class WasmEngine {
  async detect(
    imageData: ImageData,
    tier: 'fast' | 'rescue' | 'variant' = 'fast'
  ): Promise<ScanResult[]> {
    const { readBarcodes } = await loadModule();
    const passes =
      tier === 'fast'
        ? [FAST_OPTIONS]
        : tier === 'rescue'
          ? [RESCUE_OPTIONS]
          : VARIANT_PASSES;

    for (const options of passes) {
      const found = await readBarcodes(imageData, options);
      if (found.length > 0) {
        return found.map((r) => ({ text: r.text, format: r.format }));
      }
    }
    return [];
  }
}

/** 相册识别入口：直接吃图片文件，一步到救援档 */
export async function scanImageFile(file: File): Promise<ScanResult[]> {
  const { readBarcodesFromImageFile } = await loadModule();
  const found = await readBarcodesFromImageFile(file, RESCUE_OPTIONS);
  return found.map((r) => ({ text: r.text, format: r.format }));
}
