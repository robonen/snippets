<script setup lang="ts">
import { computed } from 'vue';
import { SegmentedControl } from '@brain/ui';
import type { Segment } from '@brain/ui';
import { PROJECT_STATUSES, STATUS_HINTS, STATUS_LABELS, STATUS_PROMPTS, statusColor, withStatus } from '../../entities/project';
import type { Project, ProjectStatus } from '../../entities/project';

/**
 * Статус проекта и пояснение к нему — то, что в файле было врезкой под
 * заголовком («::: warning Проект приостановлен…»).
 *
 * Пояснение живёт ПРЯМО под переключателем и окрашено в цвет статуса: это одна
 * мысль — «на паузе, потому что…», — и разносить её по разным карточкам значит
 * терять «потому что». Вопрос в подсказке у каждого статуса свой.
 */
const { project, today } = defineProps<{
  project: Project;
  today: string;
}>();

const emit = defineEmits<{ update: [project: Project] }>();

const SEGMENTS: Array<Segment<ProjectStatus>> = PROJECT_STATUSES.map(item => ({
  value: item,
  label: STATUS_LABELS[item],
}));

const status = computed({
  get: () => project.status,
  set: (next) => {
    emit('update', withStatus(project, next, today, Date.now()));
  },
});

const note = computed({
  get: () => project.statusNote,
  set: (next) => {
    emit('update', { ...project, statusNote: next });
  },
});
</script>

<template>
  <div class="flex flex-col gap-2">
    <SegmentedControl v-model="status" label="Статус" :segments="SEGMENTS" />

    <div
      class="rounded-card border-l-2 bg-sunken px-3.5 py-3"
      :style="{ borderLeftColor: statusColor(project.status) }"
    >
      <p class="text-xs text-text-faint">{{ STATUS_HINTS[project.status] }}</p>
      <!-- Поле растёт по тексту: пояснение — от одной строки до абзаца, и
           фиксированные три строки либо режут, либо зияют. -->
      <textarea
        v-model="note"
        rows="1"
        :aria-label="`Пояснение к статусу «${STATUS_LABELS[project.status]}»`"
        :placeholder="STATUS_PROMPTS[project.status]"
        class="field-sizing-content mt-1 w-full resize-none bg-transparent text-sm leading-relaxed text-text
               outline-none placeholder:text-text-faint"
      />
    </div>
  </div>
</template>
