<script setup lang="ts">
import { X } from 'lucide-vue-next';
import { Badge } from '@brain/ui';

/**
 * Тег как снимаемая фишка — и в фильтре списка, и в форме заметки.
 *
 * Крестик живёт ВНУТРИ метки, а не рядом: иначе цель нажатия отрывается от
 * того, что она убирает, и в ряду из шести тегов человек снимает соседний.
 * Подпись крестика называет тег — скринридер читает кнопку вне ряда, и шесть
 * одинаковых «Убрать» ничего ему не говорят.
 */
const { tone = 'neutral' } = defineProps<{
  tag: string;
  tone?: 'neutral' | 'accent';
}>();

const emit = defineEmits<{ remove: [] }>();
</script>

<template>
  <Badge :tone="tone">
    {{ `#${tag}` }}
    <button
      type="button"
      :aria-label="`Убрать тег ${tag}`"
      class="pressable -mr-1 grid size-4 shrink-0 place-items-center rounded-full text-text-faint
             hover:text-text"
      @click="emit('remove')"
    >
      <X class="size-3.5" />
    </button>
  </Badge>
</template>
