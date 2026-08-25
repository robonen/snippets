<script setup lang="ts">
import { noteLabel } from '../../entities/note';
import type { Note } from '../../entities/note';

/**
 * Кто ссылается на открытую заметку.
 *
 * Панель стоит СБОКУ от текста, а не под ним, и не сворачивается: связи — это
 * контекст чтения, и за ними не должны тянуться нажатие и прокрутка. Место ей
 * даёт рельс `Page` — он появляется с `xl`, а там, где ширины на третью колонку
 * нет, панель честно уезжает под текст, а не сжимается в нечитаемую полоску.
 *
 * Показывается и пустой: «никто не ссылается» — такой же ответ, как список, а
 * исчезающая панель научила бы искать связи глазами по тексту.
 *
 * Ссылки остаются ссылками (`RouterLink`), а не кнопками: упоминание — это
 * переход по адресу, и «открыть в новой вкладке» на нём обязано работать.
 */
const { notes } = defineProps<{ notes: readonly Note[] }>();
</script>

<template>
  <section class="flex flex-col gap-2">
    <h2 class="flex items-baseline gap-2 text-xs font-medium tracking-wide text-text-faint uppercase">
      <span class="min-w-0 flex-1">Упоминания</span>
      <span class="tnum">{{ notes.length }}</span>
    </h2>

    <p v-if="notes.length === 0" class="text-xs leading-relaxed text-text-faint">
      Пока никто не ссылается. Напишите в другой заметке [[её заголовок]] — обратная связь появится
      здесь сама, даже если самой заметки ещё нет.
    </p>

    <!-- Список ограничен по высоте ровно там, где рама поднимает его в липкий
         рельс (с `xl`): залипшая колонка не прокручивается вместе со страницей,
         и сорок упоминаний уехали бы за нижний край без возможности докрутить.
         Ниже `xl` панель лежит под текстом обычным блоком, и обрезать её там
         значило бы прятать связи в собственной прокрутке без причины. -->
    <ul
      v-else
      class="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface
             @[58rem]:max-h-[calc(100dvh-12rem)] @[58rem]:overflow-y-auto"
    >
      <li v-for="item in notes" :key="item.id">
        <RouterLink
          :to="{ name: 'notes:note', params: { id: item.id } }"
          class="pressable hoverable block truncate px-3 py-2 text-[0.8125rem] text-text
                 focus-visible:outline-offset-[-2px]"
        >
          {{ noteLabel(item) }}
        </RouterLink>
      </li>
    </ul>
  </section>
</template>
