<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useEventListener, useIdle, useMagicKeys, whenever } from '@robonen/vue';
import { useRegistry } from '@brain/module-kit';
import { Toast, TooltipProvider } from '@brain/ui';
import { Inbox, Plus, Sun } from 'lucide-vue-next';
import CommandPalette from './CommandPalette.vue';
import LockScreen from './LockScreen.vue';
import AppSidebar from './AppSidebar.vue';
import { lock, lockedByAway, useLock } from '../security/lock';
import { usePalette } from './palette';

/**
 * Каркас приложения.
 *
 * Раскладка переключается по ВЬЮПОРТУ, а не контейнером, и это осознанно:
 * решение «панель сбоку или вкладки снизу» зависит от устройства, а не от
 * ширины какого-то блока. Контейнерные запросы — инструмент для карточек,
 * которые обязаны переживать любую колонку; они работают на старте и в
 * виджетах, где это правда.
 *
 * Оболочка не перечисляет модули по именам ни здесь, ни где-либо ещё — иначе
 * добавление модуля правило бы N файлов вместо одной строки в `modules.ts`.
 */
const registry = useRegistry();
const route = useRoute();

const { open: palette, toggle: togglePalette } = usePalette();

/**
 * Стартовая страница живёт без хрома: ни панели, ни вкладок. Это не экран
 * приложения, а новая вкладка браузера, и навигация там отбирала бы внимание
 * у единственного, ради чего страница открыта.
 */
const bare = computed(() => route.meta['bare'] === true);
const { state: lockState } = useLock();

// Внизу помещается пять целей; остальное живёт в палитре и боковой панели.
const tabs = computed(() => [
  { id: 'start', to: '/start', title: 'Старт', icon: Sun },
  ...registry.modules.slice(0, 4).map(module => ({
    id: module.id,
    to: `/${module.id}`,
    title: module.title,
    icon: module.icon,
  })),
]);

const active = computed<string | null>(() => {
  const module = route.meta['module'] as string | undefined;
  if (module !== undefined) return module;
  return typeof route.name === 'string' ? route.name : null;
});

/**
 * Cmd/Ctrl+K — общесистемная привычка; ломать её незачем.
 *
 * `useMagicKeys` снимает слушателей сам и знает про раскладку с модификаторами
 * лучше, чем сравнение `event.key` вручную.
 */
const keys = useMagicKeys();

whenever(keys['Meta+k']!, togglePalette);
whenever(keys['Control+k']!, togglePalette);

/**
 * Замок по бездействию — на `useIdle`: он считает бездействием отсутствие
 * мыши, клавиш, скролла и касаний разом, а не только то, что вспомнили бы мы.
 */
const IDLE_MS = 15 * 60 * 1000;
const { idle } = useIdle(IDLE_MS);
whenever(idle, lock);

/**
 * Второй случай из docs/01-security.md §5 — вкладка, пролежавшая в фоне дольше
 * таймаута — одним `useIdle` НЕ закрывается, и это стоит объяснить, потому что
 * выглядит как дубль.
 *
 * У него `listenForVisibilityChange` включён по умолчанию: возвращение на
 * вкладку сбрасывает счётчик. Значит вся надежда на то, что таймер успел
 * сработать в фоне, — а он не срабатывает, когда машина спала: во сне таймеры
 * не идут вовсе, и на пробуждении просроченный `setTimeout` и сброс по
 * видимости приходят в неопределённом порядке.
 *
 * Поэтому считаются НАСТЕННЫЕ часы, а не таймер (правило и его проверки — в
 * `security/lock.ts`). Своя отметка, а не `lastActive` из `useIdle`: тот
 * сбрасывается его же обработчиком видимости, зарегистрированным раньше
 * нашего, и к моменту проверки был бы уже свежим.
 */
let hiddenAt = 0;

useEventListener(document, 'visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    hiddenAt = Date.now();
    return;
  }
  if (lockedByAway(hiddenAt, Date.now(), IDLE_MS)) lock();
});
</script>

<template>
  <!-- Заперто — содержимое не рисуется вовсе, см. LockScreen. -->
  <LockScreen v-if="lockState === 'locked'" />

  <TooltipProvider v-else>
    <div
      class="grid min-h-dvh"
      :class="bare ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-[auto_1fr]'"
    >
      <AppSidebar v-if="!bare" @palette="palette = true" />

      <main class="min-w-0" :class="!bare && 'pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-0'">
        <RouterView />
      </main>

      <CommandPalette v-model:open="palette" />

      <!-- Плавающий захват — только на телефоне: на десктопе для этого есть
           боковая панель и клавиша, и кнопка поверх контента лишняя. -->
      <RouterLink
        v-if="!bare"
        to="/inbox"
        aria-label="Инбокс"
        class="pressable glass fixed right-4 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-30 grid
               size-12 place-items-center rounded-pill border text-text-soft shadow-float lg:hidden"
      >
        <Inbox class="size-5" />
      </RouterLink>

      <nav
        v-if="!bare"
        aria-label="Разделы"
        class="glass fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        <ul class="mx-auto flex w-full max-w-2xl">
          <li v-for="tab in tabs" :key="tab.id" class="min-w-0 flex-1">
            <RouterLink
              :to="tab.to"
              :aria-current="active === tab.id ? 'page' : undefined"
              class="pressable flex flex-col items-center gap-1 py-2.5 text-[0.6875rem] transition-colors"
              :class="active === tab.id ? 'text-accent' : 'text-text-faint'"
            >
              <component :is="tab.icon" v-if="tab.icon" class="size-5" />
              <span class="truncate px-1">{{ tab.title }}</span>
            </RouterLink>
          </li>
          <li class="min-w-0 flex-1">
            <button
              type="button"
              aria-label="Палитра команд"
              aria-keyshortcuts="Meta+K Control+K"
              class="pressable flex w-full flex-col items-center gap-1 py-2.5 text-[0.6875rem] text-text-faint"
              @click="palette = true"
            >
              <Plus class="size-5" />
              <span>Ещё</span>
            </button>
          </li>
        </ul>
      </nav>

      <Toast />
    </div>
  </TooltipProvider>
</template>
