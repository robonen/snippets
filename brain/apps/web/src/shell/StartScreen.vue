<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue';
import { useRouter } from 'vue-router';
import { useDateFormat, useFocus, useNow } from '@robonen/vue';
import { WidgetHost, useRegistry, useSpaces } from '@brain/module-kit';
import type { CaptureMatch } from '@brain/module-kit';
import { CornerDownLeft, Inbox, Search, Settings } from 'lucide-vue-next';
import { useInboxActions } from '../db/inbox';
import { usePalette } from './palette';

/**
 * Стартовая страница — та, что ставится домашней в браузере.
 *
 * Хрома нет намеренно: ни боковой панели, ни нижних вкладок. Это не экран
 * приложения, а место, куда попадаешь по новой вкладке, и навигация здесь
 * отбирала бы внимание у единственного, ради чего страница открыта, — у поля
 * захвата. Разделы достаются клавишей и тремя ссылками в углу.
 *
 * Enter без совпадений кладёт строку в инбокс: решение «чем это станет»
 * откладывается, а не требуется прямо сейчас. Если модуль узнал свой синтаксис,
 * он предлагает создать сущность сразу — знание синтаксиса живёт в модуле
 * (контракт, `capture`).
 */
const registry = useRegistry();
const spaces = useSpaces();
const inbox = useInboxActions();
const router = useRouter();
const palette = usePalette();

const draft = ref('');
const field = useTemplateRef<HTMLInputElement>('field');
useFocus(field, { initialValue: true });

// Раз в минуту: секундная стрелка на странице, открытой фоном на весь день, —
// это перерисовка раз в секунду ради никого.
const now = useNow({ interval: 60_000 });
const clock = useDateFormat(now, 'HH:mm');
const weekday = useDateFormat(now, 'dddd', { locales: 'ru-RU' });
const date = useDateFormat(now, 'D MMMM', { locales: 'ru-RU' });

const widgets = computed(() => registry.widgets());

const matches = computed<Array<{ module: string; title: string; match: CaptureMatch }>>(() => {
  const text = draft.value.trim();
  if (text.length < 2) return [];

  return registry.modules.flatMap((module) => {
    if (module.capture === undefined) return [];
    try {
      const match = module.capture({ id: module.id, space: spaces.space(module.id) }, text);
      return match === null ? [] : [{ module: module.id, title: module.title, match }];
    }
    catch {
      // Сломанный разбор одного модуля не должен гасить поле ввода.
      return [];
    }
  });
});

function run(match: CaptureMatch): void {
  const to = match.run();
  draft.value = '';
  if (to !== undefined) void router.push(to);
}

function capture(): void {
  // Совпадение единственное — Enter выполняет его: «250 кофе» почти наверняка
  // трата, и лишний шаг тут только раздражает.
  if (matches.value.length === 1) {
    run(matches.value[0]!.match);
    return;
  }
  if (inbox.capture({ text: draft.value, source: 'старт' }) !== null) draft.value = '';
}

/** Курсор двигает пятно света на карточке — глубина без теней. */
function spot(event: PointerEvent): void {
  const target = event.currentTarget as HTMLElement;
  const box = target.getBoundingClientRect();
  target.style.setProperty('--spot-x', `${event.clientX - box.left}px`);
  target.style.setProperty('--spot-y', `${event.clientY - box.top}px`);
}
</script>

<template>
  <div class="ambient min-h-dvh">
    <!-- Инбокс, поиск и настройки вместо навигации: попасть внутрь можно, но
         взгляд они не забирают. Поиск открывает палитру — остальное по ⌘K. -->
    <nav class="absolute top-4 right-4 flex items-center gap-1" aria-label="Разделы">
      <RouterLink
        to="/inbox"
        aria-label="Инбокс"
        title="Инбокс"
        class="pressable grid size-9 place-items-center rounded-control text-text-faint
               transition-colors hoverable hover:text-text"
      >
        <Inbox class="size-4" />
      </RouterLink>
      <button
        type="button"
        aria-label="Поиск"
        title="Поиск — ⌘K"
        aria-keyshortcuts="Meta+K Control+K"
        class="pressable grid size-9 place-items-center rounded-control text-text-faint
               transition-colors hoverable hover:text-text"
        @click="palette.show()"
      >
        <Search class="size-4" />
      </button>
      <RouterLink
        to="/settings"
        aria-label="Настройки"
        title="Настройки"
        class="pressable grid size-9 place-items-center rounded-control text-text-faint
               transition-colors hoverable hover:text-text"
      >
        <Settings class="size-4" />
      </RouterLink>
    </nav>

    <div class="mx-auto flex w-full max-w-5xl flex-col gap-10 px-5 pt-[14vh] pb-16 sm:px-8">
      <header class="flex flex-col items-center gap-2">
        <p class="text-display text-[clamp(4rem,14vw,8.5rem)] leading-[0.85] font-light text-text">
          {{ clock }}
        </p>
        <p class="flex items-center gap-2 text-sm text-text-faint">
          <span class="first-letter:uppercase">{{ weekday }}</span>
          <span class="size-1 rounded-full bg-line-strong" />
          <span>{{ date }}</span>
        </p>
      </header>

      <section class="mx-auto w-full max-w-2xl">
        <form class="relative" @submit.prevent="capture">
          <input
            ref="field"
            v-model="draft"
            type="text"
            placeholder="Что на уме?"
            aria-label="Быстрый захват"
            autocomplete="off"
            class="glass h-16 w-full rounded-sheet border pr-14 pl-6 text-lg text-text shadow-float
                   transition-[border-color,box-shadow] placeholder:text-text-faint
                   focus:border-accent focus:outline-none"
          >
          <kbd
            v-if="draft.trim() !== ''"
            class="pointer-events-none absolute top-1/2 right-5 grid size-8 -translate-y-1/2
                   place-items-center rounded-control bg-sunken text-text-faint"
          >
            <CornerDownLeft class="size-4" />
          </kbd>
        </form>

        <ul v-if="matches.length > 0" class="mt-2 flex flex-col gap-1">
          <li
            v-for="(entry, index) in matches"
            :key="entry.module"
            class="stagger"
            :style="{ '--stagger-index': index }"
          >
            <button
              type="button"
              class="glass pressable flex w-full items-center gap-3 rounded-control border px-4 py-3
                     text-left text-sm"
              @click="run(entry.match)"
            >
              <span class="min-w-0 flex-1 truncate text-text">{{ entry.match.title }}</span>
              <span v-if="entry.match.hint" class="shrink-0 text-xs text-text-faint">
                {{ entry.match.hint }}
              </span>
              <span class="shrink-0 rounded-pill bg-accent-soft px-2 py-0.5 text-xs text-accent">
                {{ entry.title }}
              </span>
            </button>
          </li>
        </ul>
      </section>

      <!--
        Бенто: плитки РАЗНОГО размера, а не ряд одинаковых прямоугольников.
        Первая занимает две колонки и задаёт композиции опору; дальше идут
        обычные. Сетка на `auto-fit` без брейкпоинтов — число колонок считает
        браузер, а `@container` внутри плитки даёт её содержимому перестроиться
        по СВОЕЙ ширине, а не по ширине окна.
      -->
      <section
        v-if="widgets.length > 0"
        class="grid gap-3 grid-cols-[repeat(auto-fit,minmax(min(18rem,100%),1fr))]"
      >
        <article
          v-for="(entry, index) in widgets"
          :key="`${entry.module.id}:${entry.widget.id}`"
          class="spotlight stagger @container rounded-card border border-line bg-surface/70 p-4
                 backdrop-blur-sm"
          :class="index === 0 && 'sm:col-span-2'"
          :style="{ '--stagger-index': index + 1 }"
          @pointermove="spot"
        >
          <h2 class="mb-3 text-xs font-medium tracking-wide text-text-faint uppercase">
            {{ entry.widget.title }}
          </h2>
          <WidgetHost :module="entry.module.id" :component="entry.widget.component" />
        </article>
      </section>
    </div>
  </div>
</template>
