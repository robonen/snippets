<script setup lang="ts">
import { useRoute } from 'vue-router';
import { SECTIONS, SECTION_ROUTE, useSectionRequests } from './section';

/**
 * Переключатель разделов дневника — общий для всех его экранов.
 *
 * Нижняя навигация оболочки ведёт в модуль целиком и про его устройство не
 * знает; внутренние разделы обязан показывать сам модуль, иначе на них
 * невозможно попасть пальцем — только адресом.
 *
 * Ссылки, а не сегменты из кита: `SegmentedControl` меняет ЗНАЧЕНИЕ, а здесь
 * переход по маршруту — такой элемент обязан открываться в новой вкладке и
 * попадать в историю. Оформление взято у сегментов, чтобы на одном экране с
 * ними (окно графика в статистике) полоски читались как одна семья.
 */
useSectionRequests(true);

const route = useRoute();
</script>

<template>
  <!-- Отступ снизу задаёт экран: у дневника разделы стоят в общей колонке с
       gap, у остальных — над своей шапкой. -->
  <nav aria-label="Разделы дневника">
    <!-- Ширина переключателя ограничена: на статистике экран уходит в 84 rem, и
         полоска из четырёх ссылок по 320 px читалась бы как навигация сайта, а
         не как переключатель разделов. На телефоне предел не достигается. -->
    <ul class="flex max-w-md overflow-x-auto rounded-control border border-line bg-surface p-0.5">
      <li v-for="section in SECTIONS" :key="section.id" class="flex-1">
        <RouterLink
          :to="{ name: SECTION_ROUTE[section.id] }"
          :aria-current="route.name === SECTION_ROUTE[section.id] ? 'page' : undefined"
          class="flex h-8 items-center justify-center rounded-md px-3 text-[0.8125rem] font-medium
                 whitespace-nowrap transition-colors"
          :class="route.name === SECTION_ROUTE[section.id]
            ? 'bg-sunken text-text'
            : 'text-text-faint hover:text-text'"
        >
          {{ section.title }}
        </RouterLink>
      </li>
    </ul>
  </nav>
</template>
