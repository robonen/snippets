<script setup lang="ts">
import { computed } from 'vue';
import { Meter } from '@brain/ui';
import { useSpaces, useToday } from '@brain/module-kit';
import { useTasks } from '../../db/composables';
import { MODULE_ID } from '../../db/models';
import { dayProgress } from '../../entities/overview';
import { progressOf } from '../../entities/step';
import { bucketOf, isOverdue, sortTasks } from '../../entities/task';
import { plural } from '@brain/std';
import { dueLabel } from '../../lib/format';
import { priorityStripe } from '../stripe';

/**
 * Карточка «Задачи на сегодня» для экрана «Сегодня».
 *
 * Тот же язык, что и у списка: крупное число сверху, полоса дня, плотные строки
 * с полоской приоритета слева. Виджет, оформленный иначе, чем экран, к которому
 * он ведёт, читается как чужой — а он и есть его сжатая версия.
 *
 * Пространство берётся у кита ЯВНО: виджет рисует оболочка, вне хоста модуля, и
 * инъекции `@sync/vue` там нет — она появляется только под маршрутом модуля.
 *
 * Карточка только показывает: ссылок внутри нет намеренно. Роутером владеет
 * оболочка, а `<a href>` в SPA — это перезагрузка приложения ради перехода на
 * соседний экран.
 */
const PREVIEW = 3;

const space = useSpaces().space(MODULE_ID);
const today = useToday();

const tasks = useTasks(space);
const list = computed(() => sortTasks(
  tasks.value.filter(task => bucketOf(task, today.value) === 'today'),
  'today',
));
const overdue = computed(() => list.value.filter(task => isOverdue(task, today.value)).length);
const rest = computed(() => Math.max(0, list.value.length - PREVIEW));
const progress = computed(() => dayProgress(tasks.value, today.value));

/**
 * Производные строки считаются здесь, а не в шаблоне: `progressOf` в разметке
 * звался бы по разу на каждое обращение — четыре раза на строку и заново на
 * каждый кадр.
 */
const preview = computed(() => list.value.slice(0, PREVIEW).map(task => ({
  task,
  steps: progressOf(task.steps),
  overdue: isOverdue(task, today.value),
  stripe: priorityStripe(task.priority),
})));
</script>

<template>
  <!-- Пустой день и закрытый день — разные новости. «Ничего не назначено» тому,
       кто с утра закрыл все пять дел, стирает сделанное. -->
  <p v-if="list.length === 0 && progress.done === 0" class="text-sm text-text-faint">
    На сегодня ничего не назначено.
  </p>

  <div v-else class="flex flex-col gap-3">
    <div class="flex items-baseline gap-2">
      <span class="text-display text-3xl leading-none text-text">{{ list.length }}</span>
      <span class="text-xs text-text-soft">
        {{ `${plural(list.length, 'дело', 'дела', 'дел')} осталось` }}
      </span>
      <span v-if="overdue > 0" class="tnum ml-auto text-xs text-danger">
        {{ `${overdue} ${plural(overdue, 'просрочена', 'просрочены', 'просрочено')}` }}
      </span>
    </div>

    <Meter
      v-if="progress.total > 0"
      :value="progress.done"
      :max="progress.total"
      :color="list.length === 0 ? 'var(--positive)' : 'var(--accent)'"
      :caption="`${progress.done} из ${progress.total}`"
    />

    <ul v-if="preview.length > 0" class="flex flex-col gap-1">
      <li
        v-for="row in preview"
        :key="row.task.id"
        class="flex items-center gap-2 border-l-2 py-0.5 pl-2"
        :class="row.stripe"
      >
        <span class="min-w-0 flex-1 truncate text-sm text-text-soft">{{ row.task.title }}</span>

        <span v-if="row.steps.total > 0" class="tnum shrink-0 text-xs text-text-faint">
          {{ `${row.steps.done}/${row.steps.total}` }}
        </span>

        <span
          v-if="row.task.dueAt !== undefined"
          class="tnum shrink-0 text-xs whitespace-nowrap"
          :class="row.overdue ? 'font-medium text-danger' : 'text-text-faint'"
        >{{ dueLabel(row.task.dueAt, today) }}</span>
      </li>
    </ul>

    <p v-if="rest > 0" class="text-xs text-text-faint">
      {{ `и ещё ${rest}` }}
    </p>
  </div>
</template>
