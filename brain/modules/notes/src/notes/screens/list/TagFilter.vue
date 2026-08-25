<script setup lang="ts">
import { Search } from 'lucide-vue-next';
import { Badge, Button, Checkbox, Popover } from '@brain/ui';
import type { TagCount } from '../../entities/tags';
import { fmtNotes } from '../../lib/format';
import { toggleTag } from '../../lib/tags';

/**
 * Фильтр по тегам — мультивыбор в поповере.
 *
 * Поповер, а не выпадающее меню: внутри флажки, и человек ставит несколько
 * подряд. Меню закрылось бы на первом же выборе, и каждый следующий тег стоил
 * бы ещё одного открытия.
 *
 * Счётчик у тега — не украшение: он отвечает на «что тут вообще есть» до
 * нажатия, и тег, у которого ноль в текущем срезе, видно сразу.
 */
const { counts } = defineProps<{ counts: readonly TagCount[] }>();

const selected = defineModel<readonly string[]>({ required: true });

function toggle(tag: string): void {
  selected.value = toggleTag(selected.value, tag);
}

function clear(): void {
  selected.value = [];
}
</script>

<template>
  <Popover align="end">
    <template #trigger>
      <Search class="size-4 text-text-faint" />
      Теги
      <Badge v-if="selected.length > 0" tone="accent" :sr-label="`выбрано тегов: ${selected.length}`">
        {{ selected.length }}
      </Badge>
    </template>

    <p v-if="counts.length === 0" class="px-1 py-2 text-[0.8125rem] text-text-faint">
      Тегов пока нет. Теги ставятся на экране заметки.
    </p>

    <template v-else>
      <div class="-my-1 max-h-64 overflow-y-auto">
        <Checkbox
          v-for="item in counts"
          :key="item.tag"
          :label="`#${item.tag}`"
          :description="fmtNotes(item.count)"
          :model-value="selected.includes(item.tag)"
          @update:model-value="toggle(item.tag)"
        />
      </div>

      <Button
        v-if="selected.length > 0"
        size="sm"
        tone="ghost"
        block
        class="mt-2"
        @click="clear()"
      >
        Сбросить
      </Button>
    </template>
  </Popover>
</template>
