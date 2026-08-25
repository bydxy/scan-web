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

/** ZXing-C++ 码型名（与上面一一对应） */
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
