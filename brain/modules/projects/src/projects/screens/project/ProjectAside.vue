<script setup lang="ts">
import { computed } from 'vue';
import { Card } from '@brain/ui';
import { STATUS_LABELS, lastEntry, myTotal, paidTotal, remainderOf, statusColor } from '../../entities/project';
import type { Project } from '../../entities/project';
import { fmtDay, fmtDuration, fmtMoney, fmtPeriod, monthsBetween } from '../../lib/format';

/**
 * Рельс проекта: главное одним взглядом — статус, период, люди, деньги.
 *
 * Это ЧТЕНИЕ, не правка: всё то же есть в форме слева, но форма длинная, а
 * ответ на «сколько осталось получить» нужен без прокрутки.
 */
const { project, today } = defineProps<{
  project: Project;
  today: string;
}>();

const period = computed(() => fmtPeriod(project.startedAt, project.endedAt));
const duration = computed(() => fmtDuration(monthsBetween(project.startedAt, project.endedAt ?? today.slice(0, 7))));
const paid = computed(() => paidTotal(project));
const mine = computed(() => myTotal(project));
const remainder = computed(() => remainderOf(project));
const last = computed(() => lastEntry(project));
const team = computed(() => project.members.map(member => member.name).join(', '));
const created = computed(() => fmtDay(new Date(project.createdAt).toISOString().slice(0, 10)));
</script>

<template>
  <Card title="Коротко" compact>
    <dl class="flex flex-col gap-2.5 text-sm">
      <div class="flex items-baseline justify-between gap-3">
        <dt class="text-xs text-text-faint">Статус</dt>
        <dd class="flex items-center gap-1.5 font-medium" :style="{ color: statusColor(project.status) }">
          <span aria-hidden="true" class="size-2 rounded-full bg-current" />
          {{ STATUS_LABELS[project.status] }}
        </dd>
      </div>
      <div class="flex items-baseline justify-between gap-3">
        <dt class="text-xs text-text-faint">Период</dt>
        <dd class="text-right text-text">
          {{ period }}
          <span class="block text-xs text-text-faint">{{ duration }}</span>
        </dd>
      </div>
      <div v-if="team" class="flex items-baseline justify-between gap-3">
        <dt class="shrink-0 text-xs text-text-faint">Команда</dt>
        <dd class="text-right text-text">{{ team }}</dd>
      </div>
      <div v-if="paid > 0 || project.budget !== undefined" class="flex flex-col gap-1 border-t border-line pt-2.5">
        <div class="flex items-baseline justify-between gap-3">
          <dt class="text-xs text-text-faint">Получено</dt>
          <dd class="tnum text-text">{{ fmtMoney(paid) }}</dd>
        </div>
        <div v-if="mine !== paid" class="flex items-baseline justify-between gap-3">
          <dt class="text-xs text-text-faint">Моя доля</dt>
          <dd class="tnum text-text">{{ fmtMoney(mine) }}</dd>
        </div>
        <div v-if="remainder !== undefined" class="flex items-baseline justify-between gap-3">
          <dt class="text-xs text-text-faint">Остаток</dt>
          <dd class="tnum font-medium" :class="remainder > 0 ? 'text-text' : 'text-text-faint'">{{ fmtMoney(remainder) }}</dd>
        </div>
      </div>
      <div v-if="last" class="border-t border-line pt-2.5">
        <dt class="text-xs text-text-faint">{{ `Последнее · ${fmtDay(last.date)}` }}</dt>
        <dd class="mt-0.5 line-clamp-3 text-text-soft">{{ last.text }}</dd>
      </div>
      <div class="border-t border-line pt-2.5 text-xs text-text-faint">
        {{ `Заведён ${created}` }}
      </div>
    </dl>
  </Card>
</template>
