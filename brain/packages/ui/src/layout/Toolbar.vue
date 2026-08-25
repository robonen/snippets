<script setup lang="ts">
import { ToolbarButton, ToolbarRoot, ToolbarSeparator } from '@robonen/primitives';

/**
 * Панель действий над списком: фильтр, сортировка, вид, «добавить».
 *
 * Действия приходят данными, а не слотом, не из любви к массивам: roving
 * tabindex примитива работает только для зарегистрированных `ToolbarButton`, а
 * произвольная разметка в слоте в его коллекцию не попадёт. Ради этого и берётся
 * примитив — панель занимает ОДНУ остановку Tab, внутри ходят стрелками;
 * шесть кнопок иначе означали бы шесть нажатий Tab до самого списка.
 *
 * Слот `end` намеренно живёт вне коллекции: главное действие экрана («Добавить»)
 * должно быть своей остановкой Tab, а не последним пунктом перебора стрелками.
 */
export interface ToolbarAction {
  readonly id: string;
  readonly title: string;
  readonly icon?: unknown;
  /** Нажатое состояние — для переключателей вида и активных фильтров. */
  readonly active?: boolean;
  readonly disabled?: boolean;
  /** Показывать только иконку, а заголовок отдать скринридеру. */
  readonly iconOnly?: boolean;
  readonly onSelect: () => void;
}

defineProps<{
  /** Чем панель управляет: «Действия над записями». */
  label: string;
  actions: readonly ToolbarAction[];
}>();
</script>

<template>
  <ToolbarRoot
    :aria-label="label"
    class="flex items-center gap-1 rounded-control border border-line bg-surface p-1"
  >
    <ToolbarButton
      v-for="action in actions"
      :key="action.id"
      :disabled="action.disabled"
      :aria-pressed="action.active"
      :aria-label="action.iconOnly ? action.title : undefined"
      :title="action.iconOnly ? action.title : undefined"
      class="pressable inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[0.5rem] px-2 text-[0.8125rem]
             disabled:pointer-events-none disabled:opacity-45"
      :class="action.active ? 'bg-sunken text-text' : 'text-text-soft hover:bg-sunken hover:text-text'"
      @click="action.onSelect()"
    >
      <component :is="action.icon" v-if="action.icon" class="size-4" />
      <span v-if="!action.iconOnly">{{ action.title }}</span>
    </ToolbarButton>

    <template v-if="$slots.end">
      <ToolbarSeparator class="mx-0.5 h-5 w-px shrink-0 bg-line" />
      <slot name="end" />
    </template>
  </ToolbarRoot>
</template>
