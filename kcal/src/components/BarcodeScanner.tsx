import { onMounted, onUnmounted, shallowRef } from 'vue';
import { useRef } from 'vue-jsx-vapor';
import type { BarcodeFormat, DetectedBarcode } from 'barcode-detector/ponyfill';
// Только URL: сам wasm в бандл не попадает, он эмитится отдельным файлом и
// скачивается лишь тогда, когда до него дойдёт дело. Версия zxing-wasm в
// package.json приколочена намертво — обвязка и .wasm обязаны быть из одного
// релиза, иначе модуль не инициализируется.
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

/**
 * Сканер доступен везде, где есть камера. Нативный Shape Detection API —
 * только в Chromium; в WebKit (Safari и любой браузер на iOS, включая Chrome)
 * BarcodeDetector не реализован, там работает wasm-сборка zxing.
 */
export function isBarcodeScanSupported(): boolean {
  return !!navigator.mediaDevices?.getUserMedia;
}

const FORMATS: BarcodeFormat[] = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];
const SCAN_INTERVAL_MS = 300;

interface Detector {
  detect: (source: HTMLVideoElement) => Promise<DetectedBarcode[]>;
}

type NativeDetector = new (options?: { formats?: BarcodeFormat[] }) => Detector;

/**
 * Нативный детектор бесплатен и энергоэффективнее, поэтому wasm подключается
 * только там, где своего распознавания нет.
 */
async function createDetector(): Promise<Detector> {
  const Native = (globalThis as { BarcodeDetector?: NativeDetector }).BarcodeDetector;
  if (Native) return new Native({ formats: FORMATS });

  const { BarcodeDetector, prepareZXingModule } = await import('barcode-detector/ponyfill');
  // По умолчанию zxing тянет .wasm с CDN — это ломало бы сканер офлайн и
  // упиралось бы в CSP, поэтому подставляем файл из собственной сборки.
  await prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : `${prefix}${path}`),
    },
    fireImmediately: true,
  });
  return new BarcodeDetector({ formats: FORMATS });
}

/**
 * Камера + детектор: распознали EAN/UPC — отдали наверх и погасили камеру.
 */
export default function BarcodeScanner(props: { onDetected: (code: string) => void; onCancel: () => void }) {
  const videoEl = useRef();
  const error = shallowRef('');
  const loading = shallowRef(true);

  let stream: MediaStream | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let finished = false;

  const stop = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
  };

  onMounted(async () => {
    const video = videoEl.value as HTMLVideoElement | null;
    if (!video) return;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      // Пока ждали разрешение, лист мог закрыться — поток нужно погасить.
      if (finished) return;
      video.srcObject = stream;
      await video.play();

      const detector = await createDetector();
      if (finished) return;
      loading.value = false;

      timer = setInterval(async () => {
        if (finished || video.readyState < 2) return;
        try {
          const barcodes = await detector.detect(video);
          const code = barcodes[0]?.rawValue;
          if (code) {
            finished = true;
            stop();
            props.onDetected(code);
          }
        }
        catch {
          // Единичный сбой кадра — просто ждём следующий тик.
        }
      }, SCAN_INTERVAL_MS);
    }
    catch (cause) {
      if (cause instanceof DOMException && cause.name === 'NotAllowedError') {
        error.value = 'Нет доступа к камере — разрешите его в настройках браузера.';
      }
      else if (stream) {
        // Камера уже работает, значит споткнулись на загрузке распознавания.
        error.value = 'Не удалось загрузить распознавание штрихкодов. Введите цифры вручную.';
      }
      else {
        error.value = 'Не удалось включить камеру.';
      }
      stop();
    }
  });

  onUnmounted(() => {
    finished = true;
    stop();
  });

  return (
    <div class="overflow-hidden rounded-2xl border hairline bg-black/60">
      {error.value === ''
        ? (
            <div class="relative">
              <video ref={videoEl} muted playsinline class="aspect-4/3 w-full object-cover" />
              {/* Рамка прицела */}
              <div class="pointer-events-none absolute inset-0 grid place-items-center">
                <div class="h-24 w-56 rounded-xl border-2 border-ember-bright/80 shadow-[0_0_0_999px_rgba(0,0,0,0.35)]" />
              </div>
              <p class="absolute right-0 bottom-2 left-0 text-center text-[12px] text-ink/90">
                {loading.value ? 'Готовим распознавание…' : 'Наведите на штрихкод упаковки'}
              </p>
            </div>
          )
        : <p class="px-4 py-6 text-center text-[13px] text-over-bright">{error.value}</p>}
      <button
        type="button"
        class="w-full border-t hairline py-2.5 text-[13px] text-ink-soft transition hover:bg-white/5"
        onClick={props.onCancel}
      >
        Отмена
      </button>
    </div>
  );
}
