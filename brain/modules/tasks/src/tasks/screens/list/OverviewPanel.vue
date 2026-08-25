<script setup lang="ts">
import { computed } from 'vue';
import { ChartColumn } from 'lucide-vue-next';
import { Meter, StatTile } from '@brain/ui';
import { overviewOf } from '../../entities/overview';
import type { ProjectStat } from '../../entities/overview';
import type { Project } from '../../entities/project';
import type { Task } from '../../entities/task';
import { plural } from '../../lib/format';
import EmptyPanel from './EmptyPanel.vue';

/**
 * Обзор: бенто из плиток разного размера и разбивка по проектам под ним.
 *
 * Плитки РАЗНОГО веса намеренно. Три одинаковых прямоугольника в ряд — это и
 * есть та решётка, из-за которой экран читается как список настроек: глазу не за
 * что зацепиться, потому что всё одинаково важно. Главная плитка занимает две
 * колонки и несёт единственное по-настоящему крупное число.
 *
 * Считает `entities/overview.ts` — здесь ни одного `filter`. Причина та же, по
 * которой корзина не хранится: сводка обязана быть ФУНКЦИЕЙ от списка и
 * сегодняшнего дня, и вторая её реализация (в шаблоне, «по-быстрому») разошлась
 * бы с первой на первом же изменении правил.
 *
 * Нажатие на проект возвращает на список с включённым фильтром: сводка,
 * из которой нельзя перейти к делам, отвечает на вопрос «сколько» и молчит на
 * следующий за ним «какие именно».
 */
const { tasks, projects, today } = defineProps<{
  tasks: readonly Task[];
  projects: readonly Project[];
  today: string;
}>();

const emit = defineEmits<{ pick: [project: string | undefined]; compose: [] }>();

const overview = computed(() => overviewOf(tasks, today));
const names = computed(() => new Map(projects.map(item => [item.id, item.name])));

/** Всё, что двигалось за неделю: знаменатель полосы главной плитки. */
const moved = computed(() => overview.value.open + overview.value.doneWeek);

const empty = computed(() => tasks.length === 0);

function nameOf(stat: ProjectStat): string {
  if (stat.project === undefined) return 'Без проекта';
  // Проект мог уехать вместе с устройством, на котором его удалили, — но задачи
  // с его ключом уже приехали. Показать ключ честнее, чем спрятать строку.
  return names.value.get(stat.project) ?? 'Неизвестный проект';
}
</script>

<template>
  <EmptyPanel
    v-if="empty"
    :icon="ChartColumn"
    title="Сводке нечего показывать"
    description="Просроченное, сегодняшнее и закрытое за неделю считаются по списку задач. Заведите первое дело — сводка соберётся сама."
    action="Записать дело"
    @act="emit('compose')"
  />

  <div v-else class="flex flex-col gap-4">
    <!--
      Сетка на `auto-fit` без брейкпоинтов: число колонок считает браузер. Главная
      плитка занимает две — при одной колонке правило просто не срабатывает, и
      порядок остаётся тем же.
    -->
    <div class="grid gap-3 grid-cols-[repeat(auto-fit,minmax(min(18rem,100%),1fr))]">
      <article
        class="stagger flex flex-col gap-3 rounded-card border border-line bg-surface p-4 sm:col-span-2"
      >
        <h3 class="text-xs font-medium tracking-wide text-text-faint uppercase">В работе</h3>

        <p class="flex items-baseline gap-2.5">
          <span class="text-display text-5xl leading-[0.8] text-text">{{ overview.open }}</span>
          <span class="text-sm text-text-soft">
            {{ plural(overview.open, ['задача', 'задачи', 'задач']) }} открыто
          </span>
        </p>

        <!-- Полоса показывает долю ЗАКРЫТОГО за неделю от всего, что двигалось.
             У списка, где ничего не двигалось, полосы нет: пустая шкала читается
             как «ноль процентов», а верного ответа «данных нет» у неё нет. -->
        <Meter
          v-if="moved > 0"
          :value="overview.doneWeek"
          :max="moved"
          color="var(--positive)"
          label="Закрыто за неделю"
          :caption="`${overview.doneWeek} из ${moved}`"
        />
      </article>

      <StatTile
        class="stagger"
        style="--stagger-index: 1"
        :value="String(overview.overdue)"
        label="Просрочено"
        :delta-tone="overview.overdue > 0 ? 'negative' : 'neutral'"
        :delta="overview.overdue > 0 ? 'горит' : undefined"
      />

      <StatTile
        class="stagger"
        style="--stagger-index: 2"
        :value="String(overview.today)"
        label="На сегодня"
        :delta="overview.today > 0 ? 'по сроку' : undefined"
      />
    </div>

    <section v-if="overview.projects.length > 0" class="flex flex-col gap-2">
      <h3 class="text-xs font-medium tracking-wide text-text-faint uppercase">По проектам</h3>

      <!-- Одна поверхность с разделителями, а не набор карточек: строк здесь
           столько же, сколько проектов, и рамка вокруг каждой превратила бы
           разбивку в ту же решётку, от которой ушли плитки выше. -->
      <ul class="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
        <li v-for="stat in overview.projects" :key="stat.project ?? 'none'" class="px-3 py-3">
          <button
            type="button"
            class="pressable flex w-full items-baseline gap-2.5 text-left"
            @click="emit('pick', stat.project)"
          >
            <span class="min-w-0 flex-1 truncate text-sm text-text">{{ nameOf(stat) }}</span>

            <span v-if="stat.overdue > 0" class="tnum shrink-0 text-xs font-medium text-danger">
              {{ stat.overdue }}
              <span class="sr-only">просрочено</span>
            </span>

            <span class="tnum shrink-0 text-xs text-text-faint">
              {{ `${stat.done}/${stat.open + stat.done}` }}
              <span class="sr-only">закрыто за неделю</span>
            </span>
          </button>

          <Meter
            v-if="stat.open + stat.done > 0"
            class="mt-2"
            :value="stat.done"
            :max="stat.open + stat.done"
            color="var(--positive)"
          />
        </li>
      </ul>
    </section>
  </div>
</template>
