/** 码型中心定义：原生/WASM 名称互映、分组过滤、展示名统一 */

export type FormatGroup = 'all' | 'qr' | 'barcode';

/** Web Barcode Detection 标准码型名 */
export const NATIVE_FORMATS = [
  'qr_code',
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e',
  'code_128',
  'code_39',
  'code_93',
  'itf',
  'codabar',
  'data_matrix',
  'pdf417',
  'aztec',
] as const;

export type NativeFormat = (typeof NATIVE_FORMATS)[number];

/** ZXing-C++ 码型名（与 NATIVE_FORMATS 一一对应） */
export const ZXING_FORMATS = [
  'QRCode',
  'EAN13',
  'EAN8',
  'UPCA',
  'UPCE',
  'Code128',
  'Code39',
  'Code93',
  'ITF',
  'Codabar',
  'DataMatrix',
  'PDF417',
  'Aztec',
] as const;

export type ZxingFormat = (typeof ZXING_FORMATS)[number];

const NATIVE_TO_ZXING: Record<NativeFormat, ZxingFormat> = {
  qr_code: 'QRCode',
  ean_13: 'EAN13',
  ean_8: 'EAN8',
  upc_a: 'UPCA',
  upc_e: 'UPCE',
  code_128: 'Code128',
  code_39: 'Code39',
  code_93: 'Code93',
  itf: 'ITF',
  codabar: 'Codabar',
  data_matrix: 'DataMatrix',
  pdf417: 'PDF417',
  aztec: 'Aztec',
};

const ZXING_TO_NATIVE = Object.fromEntries(
  Object.entries(NATIVE_TO_ZXING).map(([k, v]) => [v, k])
) as Record<ZxingFormat, NativeFormat>;

export function toZxing(fs: readonly string[]): ZxingFormat[] {
  return fs.map((f) => NATIVE_TO_ZXING[f as NativeFormat]).filter(Boolean);
}

export function toNative(fs: readonly string[]): string[] {
  return fs.map((f) => ZXING_TO_NATIVE[f as ZxingFormat]).filter(Boolean);
}

/** 分组 → 各引擎码型子集 */
export const GROUPS: Record<FormatGroup, { native: string[]; zxing: ZxingFormat[] }> = {
  all: { native: [...NATIVE_FORMATS], zxing: [...ZXING_FORMATS] },
  qr: {
    native: ['qr_code', 'data_matrix', 'aztec', 'pdf417'],
    zxing: ['QRCode', 'DataMatrix', 'Aztec', 'PDF417'],
  },
  barcode: {
    native: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'itf', 'codabar'],
    zxing: ['EAN13', 'EAN8', 'UPCA', 'UPCE', 'Code128', 'Code39', 'Code93', 'ITF', 'Codabar'],
  },
};

/** 统一展示名（原生/WASM 名都能进） */
const PRETTY: Record<string, string> = {
  QRCode: '二维码',
  qr_code: '二维码',
  EAN13: 'EAN-13 商品码',
  ean_13: 'EAN-13 商品码',
  EAN8: 'EAN-8 商品码',
  ean_8: 'EAN-8 商品码',
  UPCA: 'UPC-A 商品码',
  upc_a: 'UPC-A 商品码',
  UPCE: 'UPC-E 商品码',
  upc_e: 'UPC-E 商品码',
  Code128: 'Code 128',
  code_128: 'Code 128',
  Code39: 'Code 39',
  code_39: 'Code 39',
  Code93: 'Code 93',
  code_93: 'Code 93',
  ITF: 'ITF 物流码',
  itf: 'ITF 物流码',
  Codabar: 'Codabar',
  codabar: 'Codabar',
  DataMatrix: 'DataMatrix',
  data_matrix: 'DataMatrix',
  PDF417: 'PDF417',
  pdf417: 'PDF417',
  Aztec: 'Aztec',
  aztec: 'Aztec',
};

export function prettyFormat(f: string): string {
  return PRETTY[f] ?? f;
}

export function isQrFamily(format: string): boolean {
  const z = NATIVE_TO_ZXING[format as NativeFormat] ?? format;
  return z === 'QRCode' || z === 'DataMatrix' || z === 'Aztec' || z === 'PDF417';
}
