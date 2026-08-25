<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useRegistry } from '@brain/module-kit';
import { Logo, Tooltip, Wordmark } from '@brain/ui';
import { Inbox, Search, Settings, Sun } from 'lucide-vue-next';

/**
 * Боковая навигация — форма для мыши и большого экрана.
 *
 * Нижние вкладки остаются мобильной формой и не превращаются в «то же самое,
 * но сбоку»: на десктопе у навигации есть место для подписей и постоянного
 * доступа к захвату, на телефоне — только для большого пальца.
 */
const emit = defineEmits<{ palette: [] }>();

const registry = useRegistry();
const route = useRoute();

const items = computed(() => [
  { id: 'start', to: '/start', title: 'Старт', icon: Sun },
  { id: 'inbox', to: '/inbox', title: 'Инбокс', icon: Inbox },
  ...registry.modules.map(module => ({
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
</script>

<template>
  <aside
    class="hidden h-dvh w-60 shrink-0 flex-col gap-1 border-r border-line bg-surface px-3 py-4 lg:flex"
    aria-label="Разделы"
  >
    <div class="mb-3 flex items-center gap-2 px-2">
      <Logo :size="26" />
      <Wordmark />
    </div>

    <Tooltip text="Палитра команд — ⌘K">
      <button
        type="button"
        class="pressable mb-2 flex h-9 items-center gap-2 rounded-control border border-line bg-canvas px-3
               text-sm text-text-faint transition-colors hover:text-text-soft"
        @click="emit('palette')"
      >
        <Search class="size-4" />
        <span class="flex-1 text-left">Поиск</span>
        <kbd class="rounded border border-line px-1.5 py-0.5 font-mono text-[0.6875rem]">⌘K</kbd>
      </button>
    </Tooltip>

    <nav class="flex flex-col gap-0.5">
      <RouterLink
        v-for="item in items"
        :key="item.id"
        :to="item.to"
        :aria-current="active === item.id ? 'page' : undefined"
        class="pressable flex items-center gap-2.5 rounded-control px-2.5 py-2 text-sm transition-colors"
        :class="active === item.id
          ? 'bg-accent-soft font-medium text-accent'
          : 'text-text-soft hoverable hover:text-text'"
      >
        <component :is="item.icon" v-if="item.icon" class="size-4 shrink-0" />
        {{ item.title }}
      </RouterLink>
    </nav>

    <RouterLink
      to="/settings"
      class="pressable mt-auto flex items-center gap-2.5 rounded-control px-2.5 py-2 text-sm
             text-text-faint transition-colors hoverable hover:text-text"
    >
      <Settings class="size-4 shrink-0" />
      Настройки
    </RouterLink>
  </aside>
</template>
