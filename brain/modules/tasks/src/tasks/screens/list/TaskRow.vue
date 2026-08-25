<script setup lang="ts">
import { computed } from 'vue';
import { CalendarDays, Check, Settings, X } from 'lucide-vue-next';
import { Badge, Checkbox, Menu } from '@brain/ui';
import type { MenuAction } from '@brain/ui';
import { PRIORITY_LABELS, isNotable } from '../../entities/priority';
import { repeatLabel } from '../../entities/repeat';
import { scheduleOptions } from '../../entities/schedule';
import { progressOf } from '../../entities/step';
import { isDone, isOverdue } from '../../entities/task';
import type { Task } from '../../entities/task';
import { dueLabel } from '../../lib/format';
import { priorityStripe } from '../stripe';

/**
 * Строка списка: отметка, заголовок с подписью, данные справа и меню действий.
 *
 * Строка, а НЕ карточка: список — одна поверхность с разделителями, потому что
 * сорок карточек с одинаковой рамкой читаются как решётка, в которой нечего
 * искать. Разделители рисует родитель (`divide-y`), здесь остаётся только
 * полоска приоритета слева.
 *
 * Справа стоят ДАННЫЕ и только они: срок, прогресс чек-листа, проект. Приоритет
 * ушёл в полоску — он мнение о важности, и место рядом с датой ему не по чину
 * (см. `screens/stripe.ts`).
 *
 * Три зоны нажатия сохранены: `Checkbox` закрывает задачу, кнопка заголовка
 * открывает форму правки, `Menu` даёт остальное. Свести их к одной нажимаемой
 * строке нельзя: «закрыть» и «открыть» — противоположные намерения, и промах
 * между ними стоит либо потерянной правки, либо ложной галочки.
 *
 * Подпись у флажка визуально скрыта (`sr-only`), но существует: заголовок
 * задачи рядом видит глаз, а скринридеру нужно знать, ЧТО именно он отмечает —
 * иначе список звучит как «флажок, флажок, флажок».
 *
 * `today` приходит пропом, а не берётся здесь: у всех строк экрана он обязан
 * быть одним и тем же, иначе список, отрисованный в полночь, разъедется сам с
 * собой.
 */
const { task, today, projectName } = defineProps<{
  task: Task;
  today: string;
  projectName?: string;
}>();

const emit = defineEmits<{
  toggle: [];
  open: [];
  remove: [];
  schedule: [dueAt: string | null];
}>();

const done = computed(() => isDone(task));
const overdue = computed(() => isOverdue(task, today));
const progress = computed(() => progressOf(task.steps));

/**
 * У закрытой задачи приоритета больше нет: важность управляла очередью, а
 * очереди не осталось — красная полоска в «Выполнено» подсвечивала бы историю.
 */
const stripe = computed(() => priorityStripe(done.value ? undefined : task.priority));

/**
 * Подпись — только то, что не показано значением справа: повтор и заметка.
 * Срок, проект и прогресс стоят в своей колонке, и повторять их словами значило
 * бы писать одно и то же дважды в одной строке.
 */
const subtitle = computed(() => {
  const parts: string[] = [];
  if (task.repeat !== undefined) parts.push(repeatLabel(task.repeat));
  if (task.note !== undefined) parts.push(task.note);
  return parts.join(' · ');
});

const actions = computed<MenuAction[]>(() => {
  const items: MenuAction[] = [
    { id: 'open', title: 'Изменить', icon: Settings, onSelect: () => emit('open') },
    {
      id: 'toggle',
      title: done.value ? 'Вернуть в работу' : 'Выполнено',
      icon: Check,
      onSelect: () => emit('toggle'),
    },
  ];

  // Перенос срока — самое частое действие над строкой, и ради него открывать
  // форму правки незачем. В «Выполнено» его нет: у закрытого дела срока больше
  // не существует, а перенос молча вернул бы его в работу.
  if (!done.value) {
    for (const option of scheduleOptions(today, task.dueAt)) {
      items.push({
        id: option.id,
        title: option.dueAt === null ? 'Убрать срок' : `Перенести: ${option.label.toLocaleLowerCase('ru')}`,
        icon: CalendarDays,
        onSelect: () => emit('schedule', option.dueAt),
      });
    }
  }

  items.push({ id: 'remove', title: 'Удалить', icon: X, danger: true, onSelect: () => emit('remove') });
  return items;
});
</script>

<template>
  <!-- Полоска приоритета — рамка ВНУТРЕННЕГО блока, а не самого `li`:
       разделители списку рисует `divide-line` у родителя, а он красит рамку
       строки целиком и погасил бы цвет полоски. -->
  <li>
    <div class="hoverable flex items-center gap-1 border-l-2 px-1.5 transition-colors" :class="stripe">
      <!-- `[&_label]:sr-only` прячет подпись флажка ГЛАЗАМ, оставляя её
           скринридеру: тот же заголовок дважды на экране — шум, а флажок без
           имени в списке из двадцати строк неразличим на слух. -->
      <div class="shrink-0 [&_label]:sr-only">
        <Checkbox
          :model-value="done"
          :label="`Выполнено: ${task.title}`"
          @update:model-value="emit('toggle')"
        />
      </div>

      <button
        type="button"
        class="pressable min-w-0 flex-1 rounded-control px-1.5 py-2.5 text-left"
        @click="emit('open')"
      >
        <!-- Зачёркивание, а не только прозрачность: закрытая задача остаётся
             читаемой строкой журнала, и выцветший текст без черты выглядит
             сломанным контрастом, а не отметкой о выполнении. -->
        <span
          class="block truncate text-sm"
          :class="done ? 'text-text-faint line-through' : 'text-text'"
        >{{ task.title }}</span>

        <span
          v-if="subtitle !== ''"
          class="mt-0.5 block truncate text-xs text-text-faint"
        >{{ subtitle }}</span>

        <!-- Полоску слева скринридер не видит, поэтому важность приезжает
             словом внутрь имени кнопки. -->
        <span v-if="isNotable(task.priority) && !done" class="sr-only">
          {{ `Приоритет: ${PRIORITY_LABELS[task.priority ?? 'normal']}` }}
        </span>
      </button>

      <!-- Данные и меню — СОСЕДИ кнопки заголовка, а не её содержимое: иначе
           нажатие на меню открывало бы заодно форму правки, а кнопка внутри
           кнопки была бы невалидной разметкой. -->
      <div class="flex shrink-0 items-center gap-2">
        <Badge v-if="projectName !== undefined">
          <span class="block max-w-24 truncate">{{ projectName }}</span>
        </Badge>

        <span
          v-if="progress.total > 0"
          class="tnum text-xs"
          :class="progress.complete ? 'text-positive' : 'text-text-faint'"
        >
          {{ `${progress.done}/${progress.total}` }}
          <span class="sr-only">подзадач сделано</span>
        </span>

        <span
          v-if="task.dueAt !== undefined && !done"
          class="tnum text-xs whitespace-nowrap"
          :class="overdue ? 'font-medium text-danger' : 'text-text-faint'"
        >
          {{ dueLabel(task.dueAt, today) }}
          <!-- Цвет скринридеру не виден, и «22.08» звучит как обычная дата. -->
          <span v-if="overdue" class="sr-only">— срок просрочен</span>
        </span>

        <Menu :items="actions" :label="`Действия: ${task.title}`" />
      </div>
    </div>
  </li>
</template>
