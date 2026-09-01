<script setup lang="ts">
import { computed } from 'vue';
import { SwitchField } from '@brain/ui';
import type { Project } from '../../entities/project';
import { fmtDuration, monthsBetween, parseMonth } from '../../lib/format';
import MonthField from '../MonthField.vue';

/**
 * Период проекта: месяц начала, «идёт до сих пор», месяц окончания.
 *
 * Окончание — не дата, а факт: у идущего проекта его нет вовсе, и поле для
 * него не показывается. Переключатель честнее пустого поля с подписью «если
 * закончился»: пустое поле выглядит незаполненным, а не осмысленно пустым.
 */
const { project, today } = defineProps<{
  project: Project;
  today: string;
}>();

const emit = defineEmits<{ update: [project: Project] }>();

const currentMonth = computed(() => today.slice(0, 7));
const currentYear = computed(() => parseMonth(currentMonth.value)?.year ?? new Date().getFullYear());
const firstYear = computed(() => Math.min(parseMonth(project.startedAt)?.year ?? currentYear.value, currentYear.value - 10));

const startedAt = computed({
  get: () => project.startedAt,
  set: (next) => {
    // Начало уехало за окончание — окончание подтягивается: период задом
    // наперёд бессмыслен, а ошибка под полем заставила бы чинить это руками.
    const endedAt = project.endedAt !== undefined && project.endedAt < next ? next : project.endedAt;
    emit('update', { ...project, startedAt: next, ...(endedAt !== undefined && { endedAt }) });
  },
});

const ongoing = computed({
  get: () => project.endedAt === undefined,
  set: (isOngoing) => {
    if (isOngoing) {
      const { endedAt: _dropped, ...rest } = project;
      emit('update', rest);
      return;
    }
    const proposal = currentMonth.value < project.startedAt ? project.startedAt : currentMonth.value;
    emit('update', { ...project, endedAt: proposal });
  },
});

const endedAt = computed({
  get: () => project.endedAt ?? currentMonth.value,
  set: (next) => {
    const startedAtNext = next < project.startedAt ? next : project.startedAt;
    emit('update', { ...project, startedAt: startedAtNext, endedAt: next });
  },
});

const duration = computed(() => fmtDuration(monthsBetween(project.startedAt, project.endedAt ?? currentMonth.value)));
</script>

<template>
  <div class="grid gap-3 sm:grid-cols-2">
    <MonthField v-model="startedAt" label="Начало" :from-year="firstYear" :to-year="currentYear + 1" />

    <MonthField
      v-if="!ongoing"
      v-model="endedAt"
      label="Окончание"
      :from-year="firstYear"
      :to-year="currentYear + 1"
    />
    <div v-else class="flex items-end">
      <p class="pb-2.5 text-sm text-text-faint">{{ `Идёт ${duration}` }}</p>
    </div>

    <div class="sm:col-span-2">
      <SwitchField
        v-model="ongoing"
        label="Проект идёт"
        :description="ongoing ? 'Окончание появится, когда проект закроется.' : `Длился ${duration}`"
      />
    </div>
  </div>
</template>
