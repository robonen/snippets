/**
 * Чтение штрихкода камерой.
 *
 * Распознавание берётся у браузера — Shape Detection API (`BarcodeDetector`).
 * Он есть в Chromium и в Android-браузерах; в WebKit (Safari и любой браузер на
 * iOS) его нет, и оригинальное приложение подключало там wasm-сборку zxing
 * (`barcode-detector` + `zxing-wasm`).
 *
 * Этих пакетов в зависимостях модуля СЕЙЧАС нет, а тянуть их самовольно —
 * значит решить за сборку: `.wasm` эмитится отдельным файлом, версии обвязки и
 * бинарника обязаны совпадать, и это правка `package.json`, а не экрана.
 * Поэтому там, где своего распознавания у браузера нет, экран честно говорит об
 * этом и оставляет ручной ввод цифр с упаковки — путь, который работает везде.
 */

/** Форматы упаковок: EAN/UPC плюс Code 128 с весовых этикеток. */
export const BARCODE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] as const;

/** Как часто дёргаем детектор: чаще — греем телефон, реже — «не ловит». */
export const SCAN_INTERVAL_MS = 300;

interface DetectedBarcode {
  rawValue: string;
}

export interface BarcodeDetectorLike {
  detect: (source: HTMLVideoElement) => Promise<DetectedBarcode[]>;
}

type DetectorCtor = new (options?: { formats?: readonly string[] }) => BarcodeDetectorLike;

export type ScanSupport = 'ready' | 'no-camera' | 'no-detector';

/** Почему сканер недоступен — текстом для человека, а не кодом ошибки. */
export const SCAN_UNAVAILABLE: Record<Exclude<ScanSupport, 'ready'>, string> = {
  'no-camera': 'Камера недоступна: браузер её не отдаёт или страница открыта не по HTTPS.',
  'no-detector': 'Этот браузер не умеет читать штрихкоды камерой. Наберите цифры с упаковки — найдём по ним.',
};

function detectorCtor(): DetectorCtor | undefined {
  return (globalThis as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
}

export function scanSupport(): ScanSupport {
  // `navigator` может не быть вовсе — в тестах и на сервере.
  if (globalThis.navigator?.mediaDevices?.getUserMedia === undefined) return 'no-camera';
  return detectorCtor() === undefined ? 'no-detector' : 'ready';
}

/** Детектор браузера или `null`, если читать штрихкоды нечем. */
export function createDetector(): BarcodeDetectorLike | null {
  const Ctor = detectorCtor();
  return Ctor === undefined ? null : new Ctor({ formats: BARCODE_FORMATS });
}
