<script setup lang="ts">
import { computed } from 'vue';
import { Meter } from '@brain/ui';
import { dayProgress } from '../../entities/overview';
import { isOverdue } from '../../entities/task';
import type { Task } from '../../entities/task';
import { plural } from '@brain/std';
import { dayHeading } from '../../lib/format';

/**
 * Опора экрана: сегодняшний день одним крупным числом.
 *
 * Первый блок намеренно НЕ похож на остальные — он дышит, а список под ним
 * плотный. Ряд одинаковых карточек читается как список настроек; «крупное →
 * плотное» читается как композиция, и взгляд получает точку входа.
 *
 * Число здесь одно, крупное: сколько дел на сегодня ещё не закрыто. Просроченные
 * и закрытые стоят рядом мелко — это контекст к главному числу, а не три
 * равнозначные плитки, между которыми пришлось бы выбирать глазами.
 *
 * `today` приходит пропом, как и строкам списка: шапка и список обязаны считать
 * день одинаково, иначе после полуночи полоса и корзина разойдутся.
 */
const { tasks, today } = defineProps<{
  tasks: readonly Task[];
  today: string;
}>();

const emit = defineEmits<{ open: [] }>();

const day = computed(() => dayProgress(tasks, today));
const left = computed(() => day.value.total - day.value.done);

const overdue = computed(() => tasks.reduce(
  (count, task) => count + (isOverdue(task, today) ? 1 : 0),
  0,
));

/**
 * У пустого дня «0 дел осталось» звучит как отчёт о работе, которой не было.
 * Слово меняется вместе со смыслом числа, а не только со склонением.
 */
const label = computed(() => (day.value.total === 0
  ? 'дел на сегодня'
  : `${plural(left.value, 'дело', 'дела', 'дел')} осталось`));

/** Курсор двигает пятно света по опоре — глубина без теней, которых в тёмной теме не видно. */
function spot(event: PointerEvent): void {
  const target = event.currentTarget as HTMLElement;
  const box = target.getBoundingClientRect();
  target.style.setProperty('--spot-x', `${event.clientX - box.left}px`);
  target.style.setProperty('--spot-y', `${event.clientY - box.top}px`);
}
</script>

<template>
  <section class="spotlight rounded-card border border-line bg-surface px-5 py-6" @pointermove="spot">
    <div class="flex items-baseline justify-between gap-3">
      <h2 class="text-xs font-medium tracking-wide text-text-faint uppercase">Сегодня</h2>
      <p class="truncate text-xs text-text-faint first-letter:uppercase">{{ dayHeading(today) }}</p>
    </div>

    <div class="mt-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <p class="flex items-baseline gap-2.5">
        <span class="text-display text-6xl leading-[0.8] text-text">{{ left }}</span>
        <span class="text-sm text-text-soft">{{ label }}</span>
      </p>

      <div class="flex items-end gap-5">
        <!-- Просроченное — единственное красное на экране, и оно же единственное,
             ради чего сюда нажимают: кнопка ведёт в корзину «Сегодня». -->
        <button
          v-if="overdue > 0"
          type="button"
          class="pressable rounded-control text-left"
          @click="emit('open')"
        >
          <span class="text-display block text-2xl leading-none text-danger">{{ overdue }}</span>
          <span class="mt-1 block text-xs text-text-faint">просрочено</span>
          <!-- Цифра с подписью — хорошее имя для глаза, но не для слуха: без
               этого кнопка называется «1 просрочено» и молчит о том, куда ведёт. -->
          <span class="sr-only">— открыть корзину «Сегодня»</span>
        </button>

        <!-- В пустой день «0 сделано» — отчёт о работе, которой не было: счётчик
             появляется вместе с самим днём. -->
        <p v-if="day.total > 0">
          <span class="text-display block text-2xl leading-none text-text-soft">{{ day.done }}</span>
          <span class="mt-1 block text-xs text-text-faint">сделано</span>
        </p>
      </div>
    </div>

    <!-- Полоса без данных — не полоса: у дня, на который ничего не назначено,
         вместо пустой шкалы стоит подсказка, что с этим делать. -->
    <Meter
      v-if="day.total > 0"
      class="mt-5"
      :value="day.done"
      :max="day.total"
      :color="left === 0 ? 'var(--positive)' : 'var(--accent)'"
      :caption="`${day.done} из ${day.total}`"
    />
    <p v-else class="mt-5 text-xs text-text-faint">
      На сегодня ничего не назначено — разберите инбокс или поставьте делу срок.
    </p>
  </section>
</template>
