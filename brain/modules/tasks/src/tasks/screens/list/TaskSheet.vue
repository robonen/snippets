<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue';
import {
  Button,
  Combobox,
  ConfirmDialog,
  Disclosure,
  NumberField,
  RadioCards,
  Select,
  Sheet,
  SwitchField,
  TextField,
} from '@brain/ui';
import type { ComboboxOption, RadioCard, SelectOption } from '@brain/ui';
import { useToday } from '@brain/module-kit';
import { useActions } from '../../db/composables';
import { DEFAULT_PRIORITY, PRIORITIES, PRIORITY_HINTS, PRIORITY_LABELS } from '../../entities/priority';
import type { Priority } from '../../entities/priority';
import { REPEAT_UNITS, normalizeRepeat, repeatLabel } from '../../entities/repeat';
import type { RepeatUnit } from '../../entities/repeat';
import { progressOf } from '../../entities/step';
import type { Step } from '../../entities/step';
import { sameTask } from '../../entities/task';
import type { Project } from '../../entities/project';
import type { Task } from '../../entities/task';
import { stepsLabel } from '../../lib/format';
import DuePopover from './DuePopover.vue';
import StepList from './StepList.vue';

/**
 * Правка задачи в нижнем листе.
 *
 * Форма — местные рефы, а не прямая запись в каналы на каждое нажатие клавиши.
 * Разница не в стоимости записи (она дёшева), а в смысле: пока лист открыт,
 * правка ещё не сделана, и половина набранного заголовка не должна уезжать в
 * другую вкладку. Сохранение — одно, при закрытии листа ЛЮБЫМ способом: Esc и
 * клик мимо в местном приложении означают «готово», а не «отменить» — отменять
 * нечего, а терять набранное обидно.
 *
 * Компонент монтируется под конкретную задачу (`v-if` + `:key` у родителя),
 * поэтому начальные значения читаются один раз и наблюдателя за пропом нет.
 *
 * Редко нужное свёрнуто в {@link Disclosure}: повтор настраивают однажды и
 * больше не трогают, а место под ним занимает столько же, сколько заголовок с
 * заметкой вместе.
 */
const { task, projects } = defineProps<{
  task: Task;
  projects: readonly Project[];
}>();

/**
 * Удаление уходит НАВЕРХ, а не делается здесь: «Отменить» живёт в тосте, тост
 * переживает закрытие листа, а лист — нет. Компонент, который умирает раньше,
 * чем его сообщение, отменять уже нечем.
 */
const emit = defineEmits<{ close: []; remove: [] }>();

const actions = useActions();

const today = useToday();

const open = shallowRef(true);
const confirming = shallowRef(false);
const title = shallowRef(task.title);
const note = shallowRef(task.note ?? '');
const dueAt = shallowRef(task.dueAt ?? '');
const project = shallowRef<string | undefined>(task.project);
const priority = shallowRef<Priority | undefined>(task.priority ?? DEFAULT_PRIORITY);
const steps = shallowRef<Step[]>(task.steps ?? []);
const someday = shallowRef(task.status === 'someday');
const repeatOn = shallowRef(task.repeat?.enabled === true);
const repeatUnit = shallowRef<string | undefined>(task.repeat?.unit ?? 'day');
const repeatEvery = shallowRef<number | null>(task.repeat?.every ?? 1);
// Свёрнутые секции открыты, если внутри уже что-то есть: прятать чек-лист от
// того, кто его завёл, — значит прятать половину задачи.
const repeatOpen = shallowRef(task.repeat !== undefined);
const stepsOpen = shallowRef(task.steps !== undefined);

const UNIT_LABELS: Record<RepeatUnit, string> = {
  day: 'дня',
  week: 'недели',
  month: 'месяца',
};

const PRIORITY_CARDS: ReadonlyArray<RadioCard<Priority>> = PRIORITIES.map(value => ({
  value,
  title: PRIORITY_LABELS[value],
  description: PRIORITY_HINTS[value],
}));

const projectOptions = computed<ComboboxOption[]>(() => projects.map(item => ({
  value: item.id,
  label: item.name,
})));

const unitOptions = computed<SelectOption[]>(() => REPEAT_UNITS.map(unit => ({
  value: unit,
  label: UNIT_LABELS[unit],
})));

const rule = computed(() => ({
  unit: (repeatUnit.value ?? 'day') as RepeatUnit,
  every: repeatEvery.value ?? 1,
  enabled: repeatOn.value,
}));

const repeatHint = computed(() => (repeatOn.value
  ? `Следующая задача появится ${repeatLabel({ ...rule.value, enabled: true })}`
  : 'При выполнении создастся следующая задача'));

const stepsHint = computed(() => {
  const progress = progressOf(steps.value);
  return progress.total === 0 ? 'нет' : stepsLabel(progress.done, progress.total);
});

watch(open, (value) => {
  if (value) return;
  save();
  emit('close');
});

function save(): void {
  const clean = title.value.trim();
  const next: Task = {
    ...task,
    // Пустой заголовок — это опечатка, а не переименование в «ничто».
    title: clean === '' ? task.title : clean,
    note: note.value.trim() === '' ? undefined : note.value.trim(),
    status: someday.value ? 'someday' : 'active',
    project: project.value === undefined || project.value === '' ? undefined : project.value,
    dueAt: dueAt.value === '' ? undefined : dueAt.value,
    priority: priority.value ?? DEFAULT_PRIORITY,
    steps: steps.value.length === 0 ? undefined : steps.value,
    repeat: normalizeRepeat(rule.value),
  };
  // Лист закрывают и не тронув форму: без этой проверки каждое открытие
  // оставляло бы в ленде юнит с новым `updatedAt`.
  if (sameTask(next, task)) return;
  actions.save({ ...next, updatedAt: Date.now() });
}

/**
 * Удаление НЕ трогает `open`: иначе сработал бы наблюдатель закрытия и сохранил
 * форму — то есть воскресил только что удалённую задачу. Лист снимает родитель,
 * размонтированием, а размонтирование наблюдателей не будит.
 */
function drop(): void {
  confirming.value = false;
  emit('remove');
}

function createProject(name: string): void {
  const created = actions.addProject(name);
  if (created === null) return;
  project.value = created.id;
}
</script>

<template>
  <Sheet v-model:open="open" title="Задача" description="Изменения сохраняются при закрытии">
    <div class="flex flex-col gap-4 pt-1">
      <TextField v-model="title" label="Название" />

      <label class="flex flex-col gap-1.5">
        <span class="text-[0.8125rem] font-medium text-text-soft">Заметка</span>
        <textarea
          v-model="note"
          rows="3"
          class="w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-text
                 transition-colors placeholder:text-text-faint hover:border-line-strong"
          placeholder="Детали, ссылки, следующий шаг"
        ></textarea>
      </label>

      <DuePopover v-model="dueAt" :today="today" />

      <Combobox
        v-model="project"
        label="Проект"
        :options="projectOptions"
        placeholder="Без проекта"
        empty-text="Проектов пока нет"
        allow-create
        @create="createProject"
      />

      <Disclosure v-model:open="stepsOpen" title="Подзадачи" :hint="stepsHint">
        <StepList v-model="steps" />
      </Disclosure>

      <!-- Заголовок — обычный текст, а не `<legend>`: имя группе даёт сам
           `RadioCards` через `aria-label`, и второе имя рядом скринридер
           прочитал бы дважды. -->
      <div class="flex flex-col gap-1.5">
        <span class="text-[0.8125rem] font-medium text-text-soft">Приоритет</span>
        <RadioCards v-model="priority" label="Приоритет" :cards="PRIORITY_CARDS" />
      </div>

      <SwitchField
        v-model="someday"
        label="Когда-нибудь"
        description="Дело без срока, до которого руки дойдут не сейчас"
      />

      <Disclosure
        v-model:open="repeatOpen"
        title="Повтор"
        :hint="repeatOn ? repeatLabel({ ...rule, enabled: true }) : 'выключен'"
      >
        <div class="flex flex-col gap-3">
          <SwitchField v-model="repeatOn" label="Повторять" :description="repeatHint" />

          <div v-if="repeatOn" class="grid grid-cols-2 items-end gap-2">
            <NumberField v-model="repeatEvery" label="Каждые" :min="1" :step="1" />
            <Select v-model="repeatUnit" label="Единица" :options="unitOptions" />
          </div>
        </div>
      </Disclosure>
    </div>

    <template #footer>
      <div class="flex items-center justify-between gap-2">
        <Button tone="danger" @click="confirming = true">Удалить</Button>
        <Button tone="primary" @click="open = false">Готово</Button>
      </div>
    </template>
  </Sheet>

  <ConfirmDialog
    v-model:open="confirming"
    :title="`Удалить «${task.title}»?`"
    description="Задача и её подзадачи исчезнут. Отменить можно будет сразу после удаления."
    confirm-label="Удалить"
    @confirm="drop"
  />
</template>
