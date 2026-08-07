/// <reference types="vite/client" />

// BarcodeDetector (Chromium): в lib.dom его ещё нет — минимальная декларация.
interface DetectedBarcode {
  rawValue: string;
  format: string;
}

declare class BarcodeDetector {
  constructor(options?: { formats?: string[] });
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
  static getSupportedFormats(): Promise<string[]>;
}
