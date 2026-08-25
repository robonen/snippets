<script setup lang="ts">
import { computed } from 'vue';
import { domainOf } from '../entities/link';
import { useLinks } from '../db/composables';
import { formatMinutes, totalMinutes } from '../lib/reading';

/**
 * Карточка «К прочтению» на экране «Сегодня»: счётчик и первые несколько ссылок.
 *
 * Первые ТРИ, а не весь список: виджет соседствует с чужими карточками, и
 * очередь чтения на сорок строк вытеснила бы их за экран.
 *
 * `RouterLink` берётся глобальной регистрацией, а не импортом: `vue-router` —
 * зависимость ОБОЛОЧКИ, и модуль, притащивший свою копию роутера, получил бы
 * второй экземпляр с чужой историей.
 */
const PREVIEW = 3;

const links = useLinks();
const unread = computed(() => links.value.filter(link => link.status === 'unread'));
const preview = computed(() => unread.value.slice(0, PREVIEW));
const rest = computed(() => unread.value.length - preview.value.length);
/** Очередь во времени, а не только в штуках: «12 ссылок» не отвечает «успею ли». */
const queue = computed(() => formatMinutes(totalMinutes(unread.value)));
</script>

<template>
  <div v-if="unread.length === 0" class="text-[0.8125rem] text-text-faint">
    Очередь пуста — всё прочитано.
  </div>

  <div v-else class="flex flex-col gap-2">
    <div class="flex items-baseline gap-2">
      <!-- Число набрано второй гарнитурой: в плитке рядом с чужими виджетами оно
           единственное, что отличает её от строки списка. -->
      <span class="text-display text-3xl leading-none text-text">{{ unread.length }}</span>
      <span class="tnum text-xs text-text-faint">{{ `≈ ${queue} чтения` }}</span>
    </div>

    <ul class="flex flex-col gap-1.5">
      <li v-for="link in preview" :key="link.id" class="min-w-0">
        <a
          :href="link.url"
          target="_blank"
          rel="noreferrer noopener"
          class="block truncate text-[0.8125rem] text-text-soft hover:text-accent hover:underline"
        >
          {{ link.title }}
        </a>
        <span class="text-xs text-text-faint">{{ domainOf(link) }}</span>
      </li>
    </ul>

    <RouterLink to="/bookmarks" class="text-xs text-accent hover:underline">
      {{ rest > 0 ? `ещё ${rest} — открыть закладки` : 'открыть закладки' }}
    </RouterLink>
  </div>
</template>
