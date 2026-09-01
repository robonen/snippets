<script setup lang="ts">
import { computed } from 'vue';
import { Menu } from '@brain/ui';
import type { MenuAction } from '@brain/ui';
import {
  PROJECT_STATUSES,
  STATUS_LABELS,
  UNTITLED,
  myTotal,
  statusColor,
} from '../../entities/project';
import type { Project, ProjectStatus } from '../../entities/project';
import { fmtMoney, fmtPeople, fmtPeriod } from '../../lib/format';

/**
 * Строка списка проектов.
 *
 * Строка — ССЫЛКА на экран проекта: открыть в новой вкладке и скопировать адрес
 * важнее, чем что-либо ещё. Статус несёт полоска слева и слово рядом с
 * периодом: цвет усиливает слово, а не заменяет его.
 *
 * Справа — моя часть полученного: по списку проектов чаще всего ищут «сколько
 * принёс», а не «сколько прошло через проект». Нули не показываются: у половины
 * проектов денег нет вовсе, и столбик из «0 ₽» только шумит.
 */
const STACK_PREVIEW = 4;

const { project } = defineProps<{ project: Project }>();

const emit = defineEmits<{
  status: [status: ProjectStatus];
  remove: [];
}>();

const mine = computed(() => myTotal(project));
const stack = computed(() => project.stack.slice(0, STACK_PREVIEW));
const rest = computed(() => project.stack.length - stack.value.length);

const menu = computed<MenuAction[]>(() => [
  ...PROJECT_STATUSES.filter(status => status !== project.status).map(status => ({
    id: `status:${status}`,
    title: `Отметить: ${STATUS_LABELS[status]}`,
    onSelect: () => emit('status', status),
  })),
  { id: 'remove', title: 'Удалить', danger: true, onSelect: () => emit('remove') },
]);
</script>

<template>
  <li class="border-l-2" :style="{ borderLeftColor: statusColor(project.status) }">
    <div class="flex items-center gap-1 pr-2">
      <RouterLink
        :to="{ name: 'projects:project', params: { id: project.id } }"
        class="pressable hoverable flex min-w-0 flex-1 flex-col gap-1 px-3 py-2.5
               focus-visible:outline-offset-[-2px]"
      >
        <span class="flex items-baseline gap-3">
          <span class="min-w-0 flex-1 truncate text-sm text-text">{{ project.title || UNTITLED }}</span>
          <span v-if="mine > 0" class="tnum shrink-0 text-sm text-text-soft">{{ fmtMoney(mine) }}</span>
        </span>

        <span class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-text-faint">
          <span class="font-medium" :style="{ color: statusColor(project.status) }">{{ STATUS_LABELS[project.status] }}</span>
          <span aria-hidden="true" class="size-1 shrink-0 rounded-full bg-line-strong" />
          <span>{{ fmtPeriod(project.startedAt, project.endedAt) }}</span>
          <template v-if="project.members.length > 0">
            <span aria-hidden="true" class="size-1 shrink-0 rounded-full bg-line-strong" />
            <span>{{ fmtPeople(project.members.length) }}</span>
          </template>
          <template v-if="stack.length > 0">
            <span aria-hidden="true" class="size-1 shrink-0 rounded-full bg-line-strong" />
            <span class="truncate">
              {{ stack.join(' · ') }}<span v-if="rest > 0">{{ ` +${rest}` }}</span>
            </span>
          </template>
        </span>

        <span v-if="project.statusNote" class="line-clamp-1 text-xs text-text-soft">{{ project.statusNote }}</span>
      </RouterLink>

      <Menu :items="menu" :label="`Действия: ${project.title || UNTITLED}`" />
    </div>
  </li>
</template>
