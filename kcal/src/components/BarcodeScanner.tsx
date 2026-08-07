import { onMounted, onUnmounted, shallowRef } from 'vue';
import { useRef } from 'vue-jsx-vapor';

/** Есть ли в этом браузере нативное распознавание штрихкодов (Chromium). */
export function isBarcodeScanSupported(): boolean {
  return typeof BarcodeDetector !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

const SCAN_INTERVAL_MS = 300;

/**
 * Камера + BarcodeDetector: распознали EAN/UPC — отдали наверх и погасили
 * камеру. Компонент монтируется только после isBarcodeScanSupported().
 */
export default function BarcodeScanner(props: { onDetected: (code: string) => void; onCancel: () => void }) {
  const videoEl = useRef();
  const error = shallowRef('');

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
        video: { facingMode: 'environment' },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();

      const detector = new BarcodeDetector({
        formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'],
      });
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
      error.value = cause instanceof DOMException && cause.name === 'NotAllowedError'
        ? 'Нет доступа к камере — разрешите его в настройках браузера.'
        : 'Не удалось включить камеру.';
    }
  });

  onUnmounted(stop);

  return (
    <div class="overflow-hidden rounded-2xl border hairline bg-black/60">
      {error.value === ''
        ? (
            <div class="relative">
              <video ref={videoEl} muted playsinline class="aspect-[4/3] w-full object-cover" />
              {/* Рамка прицела */}
              <div class="pointer-events-none absolute inset-0 grid place-items-center">
                <div class="h-24 w-56 rounded-xl border-2 border-ember-bright/80 shadow-[0_0_0_999px_rgba(0,0,0,0.35)]" />
              </div>
              <p class="absolute right-0 bottom-2 left-0 text-center text-[12px] text-ink/90">
                Наведите на штрихкод упаковки
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
