import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import type { ReaderOptions } from 'zxing-wasm/reader';
import { GROUPS } from '../formats.js';
import type { FormatGroup } from '../formats.js';
import type { ScanResult } from './types.js';

type WasmModule = typeof import('zxing-wasm/reader');

let modulePromise: Promise<WasmModule> | null = null;

async function loadModule(): Promise<WasmModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const mod = await import('zxing-wasm/reader');
      mod.prepareZXingModule({ overrides: { locateFile: () => wasmUrl } });
      return mod;
    })();
  }
  return modulePromise;
}

/** 极速档：最小选项集（zxing-wasm v3 默认 try* 全开，必须显式关闭） */
function fastOptions(group: FormatGroup): ReaderOptions {
  return {
    formats: [...GROUPS[group].zxing],
    maxNumberOfSymbols: 8,
    tryHarder: false,
    tryRotate: false,
    tryInvert: false,
    tryDownscale: false,
    binarizer: 'LocalAverage',
  };
}

const rescueOf = (fast: ReaderOptions): ReaderOptions => ({
  ...fast,
  maxNumberOfSymbols: 16,
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: true,
});

export class WasmEngine {
  async detect(
    imageData: ImageData,
    tier: 'fast' | 'rescue' | 'variant',
    group: FormatGroup
  ): Promise<ScanResult[]> {
    const { readBarcodes } = await loadModule();
    const base = fastOptions(group);
    const passes =
      tier === 'fast'
        ? [base]
        : tier === 'rescue'
          ? [rescueOf(base)]
          : ([rescueOf(base), { ...rescueOf(base), binarizer: 'GlobalHistogram' }] as ReaderOptions[]);

    for (const options of passes) {
      const found = await readBarcodes(imageData, options);
      if (found.length > 0) {
        return found.map((r) => ({
          text: r.text,
          format: r.format,
          corners: [
            r.position.topLeft,
            r.position.topRight,
            r.position.bottomRight,
            r.position.bottomLeft,
          ],
        }));
      }
    }
    return [];
  }
}

/** 相册识别入口：直接吃图片文件，一步到救援档 */
export async function scanImageFile(file: File, group: FormatGroup): Promise<ScanResult[]> {
  const { readBarcodesFromImageFile } = await loadModule();
  const found = await readBarcodesFromImageFile(file, rescueOf(fastOptions(group)));
  return found.map((r) => ({
    text: r.text,
    format: r.format,
    corners: [
      r.position.topLeft,
      r.position.topRight,
      r.position.bottomRight,
      r.position.bottomLeft,
    ],
  }));
}
