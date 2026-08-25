<script setup lang="ts">
import { computed, shallowRef } from 'vue';
import { Disclosure, EmptyState } from '@brain/ui';
import { groupByDomain } from '../../entities/link';
import type { Bookmark, LinkStatus } from '../../entities/link';
import { formatMinutes, totalMinutes } from '../../lib/reading';
import LinkRow from './LinkRow.vue';

/**
 * Список закладок — одна полка или свёрнутые секции по сайтам.
 *
 * Отдельным компонентом, потому что панелей у вкладок четыре, а список в них
 * один и тот же: четыре копии разметки разошлись бы на первой же правке строки.
 *
 * Плоский вид — ОДНА поверхность с разделителями, а не набор карточек: карточка
 * вокруг каждой ссылки давала решётку одинаковых прямоугольников, в которой ни
 * одна ссылка не выделялась.
 *
 * Свёрнутые сайты хранятся МНОЖЕСТВОМ СВЁРНУТЫХ, а не открытых: новый сайт
 * появляется в списке раскрытым, и его содержимое видно сразу — иначе добавленная
 * ссылка пряталась бы за заголовком, которого раньше не было.
 */
const { links, grouped = false, emptyTitle, emptyDescription } = defineProps<{
  links: readonly Bookmark[];
  /** Свернуть ссылки одного сайта под общий заголовок. */
  grouped?: boolean;
  emptyTitle: string;
  emptyDescription?: string;
}>();

const emit = defineEmits<{
  status: [link: Bookmark, status: LinkStatus];
  edit: [link: Bookmark];
  copy: [link: Bookmark];
  remove: [link: Bookmark];
  tag: [tag: string];
}>();

const collapsed = shallowRef<ReadonlySet<string>>(new Set());

const groups = computed(() => (grouped ? groupByDomain(links) : []));

/** До скольких строк лесенка появления читается как изящество, а не как тормоз. */
const STAGGER_LIMIT = 12;

const animate = computed(() => links.length <= STAGGER_LIMIT);

function toggle(domain: string, open: boolean): void {
  const next = new Set(collapsed.value);
  if (open) next.delete(domain);
  else next.add(domain);
  collapsed.value = next;
}

/** Приписка в заголовке сайта: сколько ссылок и сколько это чтения. */
function hintOf(items: readonly Bookmark[]): string {
  return `${items.length} · ${formatMinutes(totalMinutes(items))}`;
}
</script>

<template>
  <EmptyState v-if="links.length === 0" :title="emptyTitle" :description="emptyDescription">
    <template v-if="$slots['empty-action']" #action>
      <slot name="empty-action" />
    </template>
  </EmptyState>

  <div v-else-if="grouped" class="flex flex-col gap-2">
    <Disclosure
      v-for="group in groups"
      :key="group.domain"
      :title="group.domain"
      :hint="hintOf(group.items)"
      :open="!collapsed.has(group.domain)"
      @update:open="open => toggle(group.domain, open)"
    >
      <ul class="-mx-2 divide-y divide-line">
        <LinkRow
          v-for="link in group.items"
          :key="link.id"
          :link="link"
          :show-domain="false"
          @status="status => emit('status', link, status)"
          @edit="emit('edit', link)"
          @copy="emit('copy', link)"
          @remove="emit('remove', link)"
          @tag="tag => emit('tag', tag)"
        />
      </ul>
    </Disclosure>
  </div>

  <ul v-else class="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
    <LinkRow
      v-for="(link, index) in links"
      :key="link.id"
      :link="link"
      :class="animate && 'stagger'"
      :style="{ '--stagger-index': index }"
      @status="status => emit('status', link, status)"
      @edit="emit('edit', link)"
      @copy="emit('copy', link)"
      @remove="emit('remove', link)"
      @tag="tag => emit('tag', tag)"
    />
  </ul>
</template>
