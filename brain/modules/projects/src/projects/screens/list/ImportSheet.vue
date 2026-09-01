<script setup lang="ts">
import { computed, ref, shallowRef, useId, watch } from 'vue';
import { useFileDialog } from '@robonen/vue';
import { Upload } from 'lucide-vue-next';
import { Button, Sheet } from '@brain/ui';
import { STATUS_LABELS } from '../../entities/project';
import { fmtPeriod, fmtProjects } from '../../lib/format';
import { importMarkdown } from '../../lib/markdown';
import type { ImportedProject } from '../../lib/markdown';

/**
 * Импорт из markdown-файла «Проекты 2023»: вставить текст или выбрать файл.
 *
 * Разбор идёт НА ЛЕТУ и показывает, что именно будет заведено, — до нажатия
 * кнопки. Импорт «вслепую» заканчивался бы удалением восьми проектов по одному,
 * если файл прочитался не так, как ожидалось.
 */
const { year } = defineProps<{
  /** Год для периодов без года — если в файле нет заголовка «# Проекты YYYY». */
  year: number;
}>();

const emit = defineEmits<{ import: [projects: ImportedProject[]] }>();

const open = defineModel<boolean>('open', { default: false });

const textId = useId();

const text = ref('');
const fileName = shallowRef('');

// Диалог выбора файла — composable: свой `<input type=file>` он держит сам,
// а `reset` даёт выбрать тот же файл повторно.
const { open: pickFile, onChange } = useFileDialog({
  accept: '.md,.markdown,.txt,text/markdown,text/plain',
  multiple: false,
  reset: true,
});

onChange((files) => {
  const file = files?.[0];
  if (file === undefined) return;
  fileName.value = file.name;
  void file.text().then((content) => {
    text.value = content;
  });
});

watch(open, (isOpen) => {
  if (!isOpen) return;
  text.value = '';
  fileName.value = '';
});

const parsed = computed(() => importMarkdown(text.value, year));
const PREVIEW = 6;
const preview = computed(() => parsed.value.slice(0, PREVIEW));
const rest = computed(() => parsed.value.length - preview.value.length);

function submit(): void {
  if (parsed.value.length === 0) return;
  emit('import', parsed.value);
  open.value = false;
}
</script>

<template>
  <Sheet
    v-model:open="open"
    title="Импорт из markdown"
    description="Формат файла «Проекты 2023»: заголовок проекта с периодом, врезка статуса, разделы «Что это?», «Стек», «Команда», «Оплата»."
  >
    <div class="flex flex-col gap-3.5">
      <div class="flex flex-col gap-1.5">
        <label :for="textId" class="text-xs font-medium text-text-soft">Текст файла</label>
        <textarea
          :id="textId"
          v-model="text"
          rows="8"
          placeholder="# Проекты 2023&#10;&#10;## Название (февраль - март)&#10;…"
          class="w-full resize-y rounded-control border border-line bg-surface px-3 py-2 font-mono text-xs leading-relaxed
                 text-text transition-colors placeholder:text-text-faint hover:border-line-strong
                 focus:border-line-strong focus:outline-none"
        />
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <Button tone="ghost" size="sm" @click="pickFile()">
          <Upload class="size-4" />
          Выбрать файл
        </Button>
        <span v-if="fileName" class="truncate text-xs text-text-faint">{{ fileName }}</span>
      </div>

      <div
        v-if="parsed.length > 0"
        class="rounded-card border border-line bg-sunken px-3 py-2.5"
        aria-live="polite"
      >
        <p class="text-xs font-medium text-text-soft">{{ `Найдено: ${fmtProjects(parsed.length)}` }}</p>
        <ul class="mt-1.5 flex flex-col gap-1">
          <li v-for="(project, at) in preview" :key="at" class="flex items-baseline gap-2 text-sm">
            <span class="min-w-0 flex-1 truncate text-text">{{ project.title }}</span>
            <span class="tnum shrink-0 text-xs text-text-faint">
              {{ `${STATUS_LABELS[project.status]} · ${fmtPeriod(project.startedAt, project.endedAt)}` }}
            </span>
          </li>
        </ul>
        <p v-if="rest > 0" class="mt-1 text-xs text-text-faint">{{ `и ещё ${fmtProjects(rest)}` }}</p>
      </div>
      <p v-else-if="text.trim() !== ''" class="text-xs text-warning" aria-live="polite">
        Проектов не найдено: заголовок проекта — строка «## Название (период)».
      </p>
    </div>

    <template #footer>
      <Button tone="primary" block :disabled="parsed.length === 0" @click="submit">
        {{ parsed.length === 0 ? 'Импортировать' : `Импортировать: ${fmtProjects(parsed.length)}` }}
      </Button>
    </template>
  </Sheet>
</template>
