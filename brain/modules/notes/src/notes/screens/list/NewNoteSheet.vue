<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useSpace } from '@sync/vue';
import { todayISO } from '@brain/std';
import { Button, RadioCards, Sheet } from '@brain/ui';
import type { RadioCard } from '@brain/ui';
import { createNoteAt, dailyId, newNoteId, noteExists } from '../../db/actions';
import { NOTE_TEMPLATES, templateDraft } from '../../entities/templates';
import type { TemplateId } from '../../entities/templates';

/**
 * Выбор заготовки для новой заметки.
 *
 * Карточки, а не выпадающий список: у шаблонов есть пояснение, и читать его
 * надо ДО выбора, а не после — строка «Встреча» сама по себе не говорит, что
 * внутри окажется повестка и список задач.
 *
 * Заметка заводится здесь, а не на экране заметки: адрес чеканится до перехода,
 * поэтому запись и переход попадают в один и тот же адрес. Пустая заготовка —
 * исключение: по ней не пишется ничего, и заметка появится от первой же буквы.
 */
const open = defineModel<boolean>('open', { default: false });

const router = useRouter();
const space = useSpace();

const choice = ref<TemplateId | undefined>('blank');

const cards: ReadonlyArray<RadioCard<TemplateId>> = NOTE_TEMPLATES.map(template => ({
  value: template.id,
  title: template.title,
  description: template.description,
}));

// Лист переживает закрытие, поэтому выбор сбрасывается вручную: иначе следующее
// «Новая» начиналось бы с шаблона, выбранного неделю назад.
watch(open, (isOpen) => {
  if (!isOpen) choice.value = 'blank';
});

function create(): void {
  const template = choice.value ?? 'blank';
  const date = todayISO();
  // У заметки дня адрес чеканится из даты — заготовка обязана лечь именно туда,
  // иначе рядом с дневником появится его двойник под случайным ключом.
  const id = template === 'daily' ? dailyId(date) : newNoteId();

  if (template !== 'blank' && !noteExists(space, id)) {
    createNoteAt(space, id, templateDraft(template, date));
  }

  open.value = false;
  void router.push({ name: 'notes:note', params: { id } });
}
</script>

<template>
  <Sheet
    v-model:open="open"
    title="Новая заметка"
    description="С чего начать. Заготовку потом можно стереть — это обычный текст."
  >
    <RadioCards v-model="choice" label="Заготовка заметки" :cards="cards" />

    <template #footer>
      <div class="flex justify-end gap-2">
        <Button tone="quiet" @click="open = false">Отмена</Button>
        <Button tone="primary" @click="create()">Создать</Button>
      </div>
    </template>
  </Sheet>
</template>
