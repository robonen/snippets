<script setup lang="ts">
import { computed } from 'vue';
import Spinner from '../layout/Spinner.vue';

/**
 * Кнопка. Четыре тона, и у каждого своя работа:
 * `primary` — главное действие экрана, ровно одно; `quiet` — обычные действия;
 * `ghost` — действия на плотных поверхностях и в шапках; `danger` — разрушающие.
 */
/**
 * `primary` — ИНВЕРСИЯ нейтрали, а не цветная заливка: на графите цвет
 * оставлен смыслу (ссылка, фокус, состояние), и синяя кнопка «просто потому,
 * что кнопка» ломает эту договорённость. Так же сделано у Vercel и cobalt.
 */
type Tone = 'primary' | 'quiet' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const {
  tone = 'quiet',
  size = 'md',
  type = 'button',
  disabled = false,
  loading = false,
  block = false,
} = defineProps<{
  tone?: Tone;
  size?: Size;
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
  /** Показывает спиннер и не пускает повторное нажатие. */
  loading?: boolean;
  block?: boolean;
}>();

const TONES: Record<Tone, string> = {
  primary: 'bg-solid text-on-solid hover:opacity-90',
  quiet: 'bg-surface text-text border border-line hover:bg-sunken',
  ghost: 'text-text-soft hover:bg-sunken hover:text-text',
  danger: 'text-danger hover:bg-danger-soft',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 gap-1.5 px-2.5 text-[0.8125rem]',
  md: 'h-10 gap-2 px-3.5 text-sm',
  lg: 'h-12 gap-2 px-5 text-[0.9375rem]',
};

// Нажатие во время загрузки — это второй запрос на то же действие.
const inert = computed(() => disabled || loading);
</script>

<template>
  <button
    :type="type"
    :disabled="inert"
    :aria-busy="loading || undefined"
    class="pressable inline-flex shrink-0 select-none items-center justify-center rounded-control
           font-medium disabled:pointer-events-none disabled:opacity-45"
    :class="[TONES[tone], SIZES[size], block && 'w-full']"
  >
    <Spinner v-if="loading" class="size-4" />
    <slot />
  </button>
</template>
