<script setup lang="ts">
import { computed } from 'vue';

/**
 * Строка списка: иконка, заголовок, подпись, значение справа и место под
 * действия.
 *
 * Три варианта — не косметика, а разная семантика нажатия. `button` открывает
 * или переключает, `link` ведёт по адресу (и должен уметь «открыть в новой
 * вкладке»), `static` не нажимается вовсе. Свести их к одному `<div @click>`
 * значило бы отнять у половины строк клавиатуру и контекстное меню.
 *
 * Слот действий вынесен из зоны нажатия: кнопка внутри кнопки — невалидная
 * разметка, а внутри ссылки — ловушка для случайного перехода.
 */
const { as = 'static', href, disabled = false } = defineProps<{
  title: string;
  /** Вторая строка: время, категория, автор. */
  subtitle?: string;
  /** Значение справа: сумма, вес, счётчик. */
  value?: string;
  as?: 'static' | 'button' | 'link';
  /** Адрес для `as="link"`. */
  href?: string;
  disabled?: boolean;
}>();

const interactive = computed(() => as !== 'static');
const tag = computed(() => (as === 'link' ? 'a' : as === 'button' ? 'button' : 'div'));
</script>

<template>
  <div class="flex items-center gap-1">
    <component
      :is="tag"
      :href="as === 'link' ? href : undefined"
      :type="as === 'button' ? 'button' : undefined"
      :disabled="as === 'button' && disabled ? true : undefined"
      :aria-disabled="as === 'link' && disabled ? true : undefined"
      class="flex min-w-0 flex-1 items-center gap-3 rounded-control px-2 py-2.5 text-left"
      :class="interactive && 'pressable hoverable disabled:pointer-events-none disabled:opacity-45'"
    >
      <span v-if="$slots.icon" class="grid size-9 shrink-0 place-items-center rounded-control bg-sunken text-text-soft">
        <slot name="icon" />
      </span>

      <span class="min-w-0 flex-1">
        <span class="block truncate text-sm text-text">{{ title }}</span>
        <span v-if="subtitle" class="mt-0.5 block truncate text-xs text-text-faint">{{ subtitle }}</span>
      </span>

      <span v-if="value" class="tnum shrink-0 text-sm text-text-soft">{{ value }}</span>
    </component>

    <div v-if="$slots.action" class="shrink-0">
      <slot name="action" />
    </div>
  </div>
</template>
