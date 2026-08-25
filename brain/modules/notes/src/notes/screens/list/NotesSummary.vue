<script setup lang="ts">
import { computed } from 'vue';
import { countTags } from '../../entities/tags';
import type { Note } from '../../entities/note';

/**
 * Опора экрана списка: три числа крупно.
 *
 * Первый блок намеренно НЕ похож на строки под ним. Ритм «крупное → плотное»
 * читается как композиция; ритм «одинаковое → одинаковое» — как список
 * настроек, и ровно этим список заметок и выглядел.
 *
 * Считается по активным заметкам, а не по всей коллекции: «за неделю» и
 * «тегов», посчитанные вместе с архивом, отвечали бы на другой вопрос, чем тот,
 * ради которого на сводку смотрят.
 */
const { notes } = defineProps<{ notes: readonly Note[] }>();

/** Окно «свежего»: за сколько прошлое ещё помнят без напоминания. */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const tiles = computed(() => {
  const active = notes.filter(note => !note.archived);
  const since = Date.now() - WEEK_MS;

  return [
    { id: 'total', value: active.length, label: 'заметок' },
    { id: 'week', value: active.filter(note => note.updatedAt >= since).length, label: 'за неделю' },
    { id: 'tags', value: countTags(active).length, label: 'тегов' },
  ];
});

/** Курсор двигает пятно света: глубина без теней, которых в тёмной теме не видно. */
function spot(event: PointerEvent): void {
  const target = event.currentTarget as HTMLElement;
  const box = target.getBoundingClientRect();
  target.style.setProperty('--spot-x', `${event.clientX - box.left}px`);
  target.style.setProperty('--spot-y', `${event.clientY - box.top}px`);
}
</script>

<template>
  <section
    aria-label="Сводка по заметкам"
    class="spotlight grid grid-cols-3 divide-x divide-line overflow-hidden rounded-card border
           border-line bg-surface"
    @pointermove="spot"
  >
    <div v-for="tile in tiles" :key="tile.id" class="px-4 py-4 sm:px-5 sm:py-5">
      <p class="text-display text-3xl leading-none text-text sm:text-4xl">{{ tile.value }}</p>
      <p class="mt-2 text-xs text-text-faint">{{ tile.label }}</p>
    </div>
  </section>
</template>
