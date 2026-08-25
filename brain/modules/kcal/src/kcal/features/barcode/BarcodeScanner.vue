<script setup lang="ts">
import { onMounted, onUnmounted, ref, useTemplateRef } from 'vue';
import { useIntervalFn, useUserMedia } from '@robonen/vue';
import { Button } from '@brain/ui';
import { SCAN_INTERVAL_MS, SCAN_UNAVAILABLE, createDetector, scanSupport } from './scan';
import type { BarcodeDetectorLike } from './scan';

/**
 * Камера + детектор: распознали EAN/UPC — отдали наверх и погасили камеру.
 *
 * Камера гасится в тот же момент, когда код прочитан, и повторно из этого
 * компонента не включается: видоискатель, работающий после того, как он больше
 * не нужен, — это горящий индикатор камеры и разряженная батарея.
 *
 * Поток и опрос детектора держат композаблы, а не свои `MediaStream` и
 * `setInterval`: оба гаснут сами на размонтировании, поэтому забыть погасить
 * камеру следующей правкой этого файла попросту негде.
 */
const emit = defineEmits<{ detected: [code: string]; cancel: [] }>();

const video = useTemplateRef<HTMLVideoElement>('video');
const support = scanSupport();
const error = ref('');
const loading = ref(true);

/** Не реактивен намеренно: это признак «сцена закрыта», а не состояние вида. */
let finished = false;
let detector: BarcodeDetectorLike | null = null;

const camera = useUserMedia({
  constraints: { video: { facingMode: { ideal: 'environment' } }, audio: false },
  // Отказ в доступе — не сбой, а ответ, и человеку он объясняется словами:
  // молчаливый чёрный кадр не подсказал бы, что чинить.
  onError: (cause) => {
    error.value = cause instanceof DOMException && cause.name === 'NotAllowedError'
      ? 'Нет доступа к камере — разрешите его в настройках браузера.'
      : 'Не удалось включить камеру.';
  },
});

const scan = useIntervalFn(() => {
  const element = video.value;
  if (detector === null || element === null) return;
  void tick(detector.detect(element));
}, SCAN_INTERVAL_MS, { immediate: false });

function stop(): void {
  scan.pause();
  camera.stop();
}

async function start(): Promise<void> {
  if (support !== 'ready') return;

  const stream = await camera.start();
  const element = video.value;
  // Пока ждали разрешение, сцену могли закрыть: поток в этом случае уже погашен
  // композаблом, и возвращаться тут не к чему.
  if (stream === undefined || element === null || finished) return;

  element.srcObject = stream;
  detector = createDetector();
  if (detector === null) {
    stop();
    return;
  }

  try {
    await element.play();
  }
  catch {
    error.value = 'Не удалось включить камеру.';
    stop();
    return;
  }

  loading.value = false;
  // Ещё одна проверка после `await`: таймер, заведённый после ухода со сцены,
  // снимать уже некому — уборка композабла к этому моменту отработала.
  if (!finished) scan.resume();
}

async function tick(pending: Promise<Array<{ rawValue: string }>>): Promise<void> {
  if (finished || video.value === null || video.value.readyState < 2) return;
  try {
    const code = (await pending)[0]?.rawValue;
    if (code === undefined || code === '') return;
    finished = true;
    stop();
    emit('detected', code);
  }
  catch {
    // Единичный сбой кадра — просто ждём следующий тик.
  }
}

onMounted(() => {
  void start();
});

// Гасить руками нечего — камеру и опрос снимают композаблы. Флаг закрывает
// сцену для уже улетевших `await`: без него `start()`, дождавшийся разрешения
// после ухода, завёл бы таймер, который никто не остановит.
onUnmounted(() => {
  finished = true;
});
</script>

<template>
  <div class="overflow-hidden rounded-card border border-line bg-sunken">
    <p v-if="support !== 'ready'" class="px-4 py-5 text-center text-[0.8125rem] text-text-soft">
      {{ SCAN_UNAVAILABLE[support] }}
    </p>

    <p v-else-if="error !== ''" class="px-4 py-5 text-center text-[0.8125rem] text-danger">
      {{ error }}
    </p>

    <div v-else class="relative">
      <video ref="video" muted playsinline class="aspect-[4/3] w-full object-cover" />
      <!-- Рамка прицела: показывает, куда смотреть, и не ловит клики. -->
      <div class="pointer-events-none absolute inset-0 grid place-items-center">
        <div class="h-24 w-56 rounded-control border-2 border-accent/80" />
      </div>
    </div>

    <div class="flex items-center gap-2 border-t border-line p-2">
      <!-- Подпись рядом с кнопкой, а не поверх кадра: цвет видео заранее не
           известен, и любой текст на нём читается через раз. -->
      <p class="flex-1 pl-1.5 text-xs text-text-faint">
        {{ loading ? 'Готовим распознавание…' : 'Наведите на штрихкод упаковки' }}
      </p>
      <Button tone="ghost" size="sm" @click="emit('cancel')">
        Убрать камеру
      </Button>
    </div>
  </div>
</template>
