<script setup lang="ts">
import { computed } from 'vue';
import { Meter } from '@brain/ui';
import type { Bookmark } from '../../entities/link';
import { formatMinutes, totalMinutes } from '../../lib/reading';

/**
 * Опора экрана: очередь чтения крупным числом.
 *
 * Каталог закладок отвечает не на «сколько ссылок сохранено», а на «сколько мне
 * ещё читать»: число непрочитанных и время, которое они просят, — это и есть
 * состояние дел. «24 ссылки» в подписи шапки на этот вопрос не отвечало.
 *
 * Полоса под числами показывает ту же правду с другой стороны — долю
 * прочитанного, — и держит цвет статуса «прочитано»: цвет здесь означает
 * смысл, а не украшает блок.
 */
const { links } = defineProps<{ links: readonly Bookmark[] }>();

const unread = computed(() => links.filter(link => link.status === 'unread'));
const done = computed(() => links.filter(link => link.status === 'done').length);
const queue = computed(() => formatMinutes(totalMinutes(unread.value)));

/** Курсор двигает пятно света: глубина без теней, которых в тёмной теме не видно. */
function spot(event: PointerEvent): void {
  const target = event.currentTarget as HTMLElement;
  const box = target.getBoundingClientRect();
  target.style.setProperty('--spot-x', `${event.clientX - box.left}px`);
  target.style.setProperty('--spot-y', `${event.clientY - box.top}px`);
}
</script>

<template>
  <section
    aria-label="Очередь чтения"
    class="spotlight flex flex-col gap-5 rounded-card border border-line bg-surface p-5"
    @pointermove="spot"
  >
    <div class="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div>
        <p class="text-display text-5xl leading-none text-text">{{ unread.length }}</p>
        <p class="mt-2 text-xs text-text-faint">непрочитанных</p>
      </div>

      <div class="text-right">
        <p class="text-display text-2xl leading-none text-text-soft">{{ queue }}</p>
        <p class="mt-2 text-xs text-text-faint">чтения в очереди</p>
      </div>
    </div>

    <Meter
      :value="done"
      :max="links.length"
      color="var(--status-done)"
      label="Прочитано"
      :caption="`${done} из ${links.length}`"
    />
  </section>
</template>
