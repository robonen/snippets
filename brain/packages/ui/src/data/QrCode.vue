<script setup lang="ts">
import { QrCodeCells, QrCodeMarkers, QrCodeRoot } from '@robonen/primitives';

/**
 * QR-код на примитивах `@robonen/primitives`: печатает строку кодом,
 * пригодным для сканирования камерой.
 *
 * Плитка всегда светлая с тёмными модулями — сканерам нужен именно этот
 * контраст, поэтому цвета здесь константы, а не токены темы: «тёмная тема»
 * для QR-кода означала бы код, который не читается половиной камер.
 */
const { size = 176 } = defineProps<{
  /** Строка для кодирования — обычно ссылка. */
  value: string;
  /** Сторона кода в пикселях (без учёта плитки). */
  size?: number;
  /** Подпись для скринридера: сам код читателю экрана не виден. */
  label?: string;
}>();
</script>

<template>
  <div class="inline-flex rounded-card border border-line bg-white p-2">
    <!-- Тихая зона — штатный margin примитива (4 модуля по спецификации),
         поэтому плитке хватает символического отступа. Модули — чёрные по
         умолчанию SVG: заливка нигде не задаётся, чтобы её не задал никто. -->
    <QrCodeRoot
      :value="value"
      error-correction="M"
      :aria-label="label"
      :style="{ width: `${size}px`, height: `${size}px`, display: 'block' }"
    >
      <QrCodeCells pattern="rounded" />
      <QrCodeMarkers frame="rounded" ball="rounded" />
    </QrCodeRoot>
  </div>
</template>
