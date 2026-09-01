<script setup lang="ts">
import { computed } from 'vue';
import { UNTITLED, countByStatus, lastEntry, statusColor } from '../entities/project';
import { useProjects } from '../db/composables';
import { fmtPeriod, fmtProjects } from '../lib/format';

/**
 * Карточка «Проекты» на экране «Сегодня»: сколько в работе и три последних
 * тронутых из них — с последней записью журнала, если она есть.
 *
 * Три, а не все: виджет соседствует с чужими карточками, и список на двадцать
 * проектов вытеснил бы их за экран. «В работе» — потому что на «Сегодня»
 * смотрят ради того, что делать сегодня, а не ради архива.
 */
const PREVIEW = 3;

const { list } = useProjects();
const counts = computed(() => countByStatus(list.value));
const active = computed(() => list.value.filter(project => project.status === 'active'));
const preview = computed(() => active.value.slice(0, PREVIEW));
const rest = computed(() => active.value.length - preview.value.length);
</script>

<template>
  <div v-if="list.length === 0" class="text-[0.8125rem] text-text-faint">
    Проектов пока нет.
  </div>

  <div v-else class="flex flex-col gap-2">
    <div class="flex items-baseline gap-2">
      <span class="text-display text-3xl leading-none text-text">{{ counts.active }}</span>
      <span class="text-xs text-text-faint">
        {{ counts.paused > 0 ? `в работе · ${counts.paused} на паузе` : 'в работе' }}
      </span>
    </div>

    <ul v-if="preview.length > 0" class="flex flex-col gap-1.5">
      <li v-for="project in preview" :key="project.id" class="flex min-w-0 items-start gap-2">
        <span aria-hidden="true" class="mt-1.5 size-1.5 shrink-0 rounded-full" :style="{ backgroundColor: statusColor(project.status) }" />
        <span class="min-w-0 flex-1">
          <RouterLink
            :to="{ name: 'projects:project', params: { id: project.id } }"
            class="block truncate text-[0.8125rem] text-text-soft hover:text-accent hover:underline"
          >
            {{ project.title || UNTITLED }}
          </RouterLink>
          <span class="block truncate text-xs text-text-faint">
            {{ lastEntry(project)?.text ?? fmtPeriod(project.startedAt, project.endedAt) }}
          </span>
        </span>
      </li>
    </ul>

    <RouterLink :to="{ name: 'projects:list' }" class="text-xs text-accent hover:underline">
      {{ rest > 0 ? `ещё ${fmtProjects(rest)} — открыть проекты` : 'открыть проекты' }}
    </RouterLink>
  </div>
</template>
