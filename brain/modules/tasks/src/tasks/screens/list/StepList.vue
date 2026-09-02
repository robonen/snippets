<script setup lang="ts">
import { computed, shallowRef } from 'vue';
import { Plus, X } from 'lucide-vue-next';
import { Button, Checkbox, Meter } from '@brain/ui';
import { addStep, progressOf, removeStep, setStepDone, sortSteps } from '../../entities/step';
import type { Step } from '../../entities/step';
import { newId } from '@brain/module-kit';
import { stepsLabel } from '../../lib/format';

/**
 * Чек-лист внутри формы правки.
 *
 * Список приходит и уходит ЦЕЛИКОМ (`v-model`), а не отдельными событиями на
 * пункт: форма правки сохраняется одной записью при закрытии, и половина
 * чек-листа, уехавшая в ленд раньше заголовка, означала бы, что «отменить»
 * отменяет не всё.
 *
 * Вся арифметика — в `entities/step.ts`: здесь только разметка и ввод.
 */
const steps = defineModel<Step[]>({ required: true });

const draft = shallowRef('');

const ordered = computed(() => sortSteps(steps.value));
const progress = computed(() => progressOf(steps.value));

function submit(): void {
  const next = addStep(steps.value, draft.value, { id: newId(), at: Date.now() });
  if (next.length === steps.value.length) return;
  steps.value = next;
  draft.value = '';
}

/**
 * Отметка идёт через модель, а не правкой объекта на месте: `Step` в снимке
 * общий с родительской задачей, и правка по ссылке обошла бы сравнение
 * `sameTask` — форма считала бы, что ничего не менялось.
 */
function toggle(step: Step, done: boolean): void {
  steps.value = setStepDone(steps.value, step.id, done, Date.now());
}

function drop(step: Step): void {
  steps.value = removeStep(steps.value, step.id);
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <Meter
      v-if="progress.total > 0"
      :value="progress.done"
      :max="progress.total"
      label="Подзадачи"
      :caption="stepsLabel(progress.done, progress.total)"
    />

    <ul v-if="ordered.length > 0" class="flex flex-col">
      <li
        v-for="step in ordered"
        :key="step.id"
        class="flex items-center gap-1 border-b border-line last:border-b-0"
      >
        <div class="min-w-0 flex-1 [&_label]:line-clamp-2">
          <Checkbox
            :model-value="step.doneAt !== undefined"
            :label="step.title"
            @update:model-value="value => toggle(step, value === true)"
          />
        </div>

        <button
          type="button"
          :aria-label="`Удалить пункт: ${step.title}`"
          class="shrink-0 rounded-control p-1.5 text-text-faint transition-colors
                 hover:bg-danger-soft hover:text-danger"
          @click="drop(step)"
        >
          <X class="size-4" />
        </button>
      </li>
    </ul>

    <form class="flex items-center gap-2" @submit.prevent="submit">
      <input
        v-model="draft"
        type="text"
        aria-label="Новый пункт"
        placeholder="Добавить пункт"
        class="h-9 min-w-0 flex-1 rounded-control border border-line bg-surface px-3 text-sm text-text
               transition-colors placeholder:text-text-faint hover:border-line-strong"
      >
      <Button type="submit" size="sm" :disabled="draft.trim() === ''" aria-label="Добавить пункт">
        <Plus class="size-4" />
      </Button>
    </form>
  </div>
</template>
