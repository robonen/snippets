<script setup lang="ts">
import { computed } from 'vue';
import { Badge, Menu, Tooltip } from '@brain/ui';
import type { MenuAction } from '@brain/ui';
import { dayTitle, toISODate } from '@brain/std';
import { LINK_STATUSES, STATUS_LABELS, STATUS_SHORT, domainOf, nextStatus } from '../../entities/link';
import type { Bookmark, LinkStatus } from '../../entities/link';
import { readingLabel } from '../../lib/reading';

/**
 * Строка списка закладок.
 *
 * Сама строка — ССЫЛКА, а не кнопка: закладку сохраняют, чтобы однажды по ней
 * перейти, и это действие обязано уметь всё, что умеет ссылка, — среднюю
 * кнопку мыши, «копировать адрес» из системного меню, предпросмотр. Остальные
 * действия живут справа, вне зоны нажатия: кнопка внутри ссылки — это ловушка
 * для случайного перехода.
 *
 * Статус несёт ПОЛОСКА СЛЕВА, а не заливка строки: заливка кричит на весь
 * список и делает из полки светофор, полоска сообщает то же самое краем глаза.
 * Подпись статуса остаётся рядом — цвет усиливает слово, а не заменяет его.
 *
 * Фавикон не загружается: он потребовал бы запроса к чужому хосту на каждую
 * строку — ровно того, чего модуль не делает (см. `lib/url`). Первая буква
 * домена различает сайты не хуже и рисуется без сети; моноширинная — потому что
 * в моноширинной все буквы одной ширины, и плитки не пляшут от «i» к «m».
 */
const COLORS: Record<LinkStatus, string> = {
  unread: 'var(--status-unread)',
  reading: 'var(--status-reading)',
  done: 'var(--status-done)',
};

const { link, showDomain = true } = defineProps<{
  link: Bookmark;
  /** Под заголовком сайта домен не повторяется: он уже написан над строкой. */
  showDomain?: boolean;
}>();

const emit = defineEmits<{
  status: [status: LinkStatus];
  edit: [];
  copy: [];
  remove: [];
  tag: [tag: string];
}>();

const domain = computed(() => domainOf(link));
/** Заглушка фавикона. Пустой домен бывает у адреса, который перестал разбираться. */
const initial = computed(() => domain.value.charAt(0) || '?');
const added = computed(() => dayTitle(toISODate(new Date(link.addedAt))));
const next = computed(() => nextStatus(link.status));

const menu = computed<MenuAction[]>(() => [
  ...LINK_STATUSES.filter(status => status !== link.status).map(status => ({
    id: `status:${status}`,
    title: `Отметить: ${STATUS_LABELS[status]}`,
    onSelect: () => emit('status', status),
  })),
  { id: 'edit', title: 'Править', onSelect: () => emit('edit') },
  { id: 'copy', title: 'Копировать ссылку', onSelect: () => emit('copy') },
  { id: 'remove', title: 'Удалить', danger: true, onSelect: () => emit('remove') },
]);
</script>

<template>
  <li class="border-l-2" :style="{ borderLeftColor: COLORS[link.status] }">
    <div class="flex items-center gap-1 pr-2">
      <!-- Обводка фокуса уходит ВНУТРЬ строки: полка обрезает всё, что выходит
           за её скруглённый край, и обводка снаружи была бы срезана. -->
      <a
        :href="link.url"
        class="pressable hoverable flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5
               focus-visible:outline-offset-[-2px]"
      >
        <span
          aria-hidden="true"
          class="grid size-9 shrink-0 place-items-center rounded-control bg-sunken font-mono text-sm
                 font-medium text-text-soft uppercase"
        >
          {{ initial }}
        </span>

        <span class="min-w-0 flex-1">
          <span class="block truncate text-sm text-text">{{ link.title }}</span>
          <span class="mt-0.5 flex items-center gap-1.5 text-xs text-text-faint">
            <template v-if="showDomain">
              <span class="truncate">{{ domain }}</span>
              <span aria-hidden="true" class="size-1 shrink-0 rounded-full bg-line-strong" />
            </template>
            <span class="tnum shrink-0">{{ added }}</span>
          </span>
        </span>

        <span class="tnum shrink-0 text-xs text-text-faint">{{ readingLabel(link) }}</span>
      </a>

      <div class="flex shrink-0 items-center gap-0.5">
        <!-- Перебор по кругу одним нажатием: статусов три, и выпадающий список
             ради «прочитал» — на два действия больше нужного. Полный набор всё
             равно есть в меню, для перехода через один. -->
        <Tooltip :text="`Отметить: ${STATUS_LABELS[next]}`">
          <button
            type="button"
            :aria-label="`Статус: ${STATUS_LABELS[link.status]}. Отметить: ${STATUS_LABELS[next]}`"
            class="pressable shrink-0 rounded-control px-2 py-1 text-[0.6875rem] text-text-faint
                   hover:bg-sunken hover:text-text"
            @click="emit('status', next)"
          >
            {{ STATUS_SHORT[link.status] }}
          </button>
        </Tooltip>

        <Menu :items="menu" :label="`Действия: ${link.title}`" />
      </div>
    </div>

    <div v-if="link.tags.length > 0 || link.note" class="flex flex-col gap-1 pr-3 pb-2.5 pl-15">
      <p v-if="link.note" class="line-clamp-2 text-xs leading-relaxed text-text-soft">{{ link.note }}</p>

      <div v-if="link.tags.length > 0" class="flex flex-wrap gap-1">
        <button
          v-for="tag in link.tags"
          :key="tag"
          type="button"
          :aria-label="`Отобрать по тегу ${tag}`"
          class="pressable rounded-full"
          @click="emit('tag', tag)"
        >
          <Badge>{{ `#${tag}` }}</Badge>
        </button>
      </div>
    </div>
  </li>
</template>
