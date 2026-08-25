<script setup lang="ts" generic="T extends string">
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from '@robonen/primitives';
import Badge from '../data/Badge.vue';

/**
 * Вкладки: одна панель видна, остальные ждут.
 *
 * Панели приходят именованными слотами — по одному на значение вкладки. Так
 * `aria-controls` и `role="tabpanel"` расставляет примитив, а не вызывающий: без
 * этой связи скринридер объявит вкладку и не найдёт, что она показала.
 *
 * `activationMode` оставлен автоматическим: стрелка сразу открывает панель.
 * Ручной режим (стрелка выделяет, Enter открывает) правильнее там, где переход
 * дорог — загрузка данных на каждой вкладке; кит по умолчанию считает, что
 * панели уже в памяти.
 */
export interface Tab<Value extends string = string> {
  readonly value: Value;
  readonly label: string;
  /** Счётчик у подписи: непрочитанные, найденные, просроченные. */
  readonly badge?: string | number;
  readonly disabled?: boolean;
}

defineProps<{
  items: ReadonlyArray<Tab<T>>;
  /** Чем управляют вкладки: «Разделы дня». */
  label?: string;
}>();

defineSlots<Record<string, () => unknown>>();

const value = defineModel<T>({ required: true });

function onChange(next: unknown): void {
  if (typeof next === 'string' && next !== '') value.value = next as T;
}
</script>

<template>
  <TabsRoot :model-value="value" class="flex min-h-0 flex-col" @update:model-value="onChange">
    <TabsList
      :aria-label="label"
      class="flex shrink-0 gap-1 overflow-x-auto overflow-y-hidden border-b border-line
             [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <TabsTrigger
        v-for="item in items"
        :key="item.value"
        :value="item.value"
        :disabled="item.disabled"
        class="pressable inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm
               disabled:pointer-events-none disabled:opacity-45
               data-[state=active]:border-accent data-[state=active]:font-medium data-[state=active]:text-text
               data-[state=inactive]:border-transparent data-[state=inactive]:text-text-faint
               data-[state=inactive]:hover:text-text"
      >
        {{ item.label }}
        <Badge v-if="item.badge !== undefined">{{ item.badge }}</Badge>
      </TabsTrigger>
    </TabsList>

    <TabsContent
      v-for="item in items"
      :key="item.value"
      :value="item.value"
      class="min-h-0 flex-1 pt-4 focus-visible:outline-none"
    >
      <slot :name="item.value" />
    </TabsContent>
  </TabsRoot>
</template>
