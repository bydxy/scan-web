/// <reference types="vite/client" />

interface BarcodeDetectorResult {
  rawValue: string;
  format: string;
}

declare class BarcodeDetector {
  constructor(options?: { formats?: string[] });
  static getSupportedFormats(): Promise<string[]>;
  detect(source: ImageBitmapSource): Promise<BarcodeDetectorResult[]>;
}
