<script setup lang="ts">
/**
 * Короткая метка состояния рядом с текстом: «черновик», «просрочено», «+120».
 *
 * Тон — это РОЛЬ, а не цвет: `positive` остаётся положительным и в тёмной теме,
 * где зелёный другой. Поэтому наружу торчат имена ролей, а не палитра.
 */
type Tone = 'neutral' | 'accent' | 'positive' | 'warning' | 'danger';

const { tone = 'neutral' } = defineProps<{
  tone?: Tone;
  /**
   * Расшифровка для скринридера: цвет метки читателю экрана не виден, и без
   * неё «12» ничем не отличается от «12 просроченных».
   */
  srLabel?: string;
}>();

// Мягкие подложки есть только у акцента и опасности; остальным тонам хватает
// поверхности `sunken` и цветного текста — иначе список пестрит.
const TONES: Record<Tone, string> = {
  neutral: 'bg-sunken text-text-soft',
  accent: 'bg-accent-soft text-accent',
  positive: 'bg-sunken text-positive',
  warning: 'bg-sunken text-warning',
  danger: 'bg-danger-soft text-danger',
};
</script>

<template>
  <span
    class="tnum inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
    :class="TONES[tone]"
  >
    <slot />
    <span v-if="srLabel" class="sr-only">{{ srLabel }}</span>
  </span>
</template>
