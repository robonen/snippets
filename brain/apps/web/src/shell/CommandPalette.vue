<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useRegistry, useSpaces } from '@brain/module-kit';
import { Palette } from '@brain/ui';
import type { PaletteGroup } from '@brain/ui';
import type { RouteLocationRaw } from 'vue-router';
import { useInboxActions } from '../db/inbox';

/**
 * Наполнение палитры: поиск по модулям, их команды, переходы и захват.
 *
 * Поиск идёт ПО МОДУЛЯМ через контрактный `search`, а не по общему индексу.
 * Общий индекс пришлось бы поддерживать в актуальном состоянии при каждой
 * записи в любом ленде; модуль и так знает свои данные и ищет по ним дешевле,
 * чем стоило бы поддержание индекса.
 */
const open = defineModel<boolean>('open', { default: false });

const router = useRouter();
const registry = useRegistry();
const spaces = useSpaces();
const inbox = useInboxActions();

const query = ref('');

watch(open, (value) => {
  if (!value) query.value = '';
});

function close<T>(action: () => T): void {
  open.value = false;
  action();
}

/**
 * Выполнить команду модуля и увести туда, куда она указала.
 *
 * Переход — не украшение, а условие того, что команда вообще что-то делает.
 * Задачи, закладки и финансы поднимают заявку, которую забирает их собственный
 * экран при монтировании; позванные с чужого экрана, они раньше просто уходили
 * в пустоту. А команды заметок молча заводили запись там, где её не видно.
 *
 * `await` обязателен: у контракта `run` может быть асинхронным, и без
 * ожидания адрес созданного пришёл бы уже после того, как решать поздно.
 */
async function runCommand(run: () => RouteLocationRaw | void | Promise<RouteLocationRaw | void>): Promise<void> {
  open.value = false;
  const to = await run();
  if (to !== undefined) await router.push(to);
}

/**
 * Результаты модулей. Короткий запрос не ищем: `search` каждого модуля — проход
 * по его коллекции, и гонять их все на каждое нажатие клавиши значило бы
 * платить за то, чего никто не спрашивал.
 */
const hits = computed<PaletteGroup[]>(() => {
  const text = query.value.trim();
  if (text.length < 2) return [];

  const items = registry.modules.flatMap((module) => {
    if (module.search === undefined) return [];
    try {
      const ctx = { id: module.id, space: spaces.space(module.id) };
      return module.search(ctx, text).map(hit => ({
        id: `${module.id}:${hit.id}`,
        title: hit.title,
        hint: module.title,
        ...(hit.subtitle !== undefined && { keywords: hit.subtitle }),
        onSelect: () => {
          close(() => router.push(hit.to));
        },
      }));
    }
    catch {
      // Сломанный поиск одного модуля не должен гасить палитру целиком.
      return [];
    }
  });

  return items.length > 0 ? [{ id: 'hits', title: 'Найдено', items }] : [];
});

const actions = computed<PaletteGroup[]>(() => {
  const items = registry.commands().map(({ module, command }) => ({
    id: `${module.id}:${command.id}`,
    title: command.title,
    hint: module.title,
    ...(command.keywords !== undefined && { keywords: command.keywords.join(' ') }),
    onSelect: () => {
      void runCommand(() => command.run({ id: module.id, space: spaces.space(module.id) }));
    },
  }));
  return items.length > 0 ? [{ id: 'actions', title: 'Действия', items }] : [];
});

const navigation = computed<PaletteGroup>(() => ({
  id: 'nav',
  title: 'Переходы',
  items: [
    { id: 'nav:today', title: 'Сегодня', to: '/' },
    { id: 'nav:inbox', title: 'Инбокс', to: '/inbox' },
    { id: 'nav:settings', title: 'Настройки', to: '/settings' },
    ...registry.modules.map(module => ({
      id: `nav:${module.id}`,
      title: module.title,
      to: `/${module.id}`,
    })),
  ].map(entry => ({
    id: entry.id,
    title: entry.title,
    onSelect: () => {
      close(() => router.push(entry.to));
    },
  })),
}));

// Запрос, не совпавший ни с чем, — это чаще всего мысль, а не промах по кнопке.
const capture = computed<PaletteGroup[]>(() => {
  const text = query.value.trim();
  if (text.length < 3) return [];
  return [{
    id: 'capture',
    items: [{
      id: 'capture:inbox',
      title: `Захватить в инбокс: «${text}»`,
      accent: true,
      onSelect: () => {
        close(() => inbox.capture({ text, source: 'палитра' }));
      },
    }],
  }];
});

const groups = computed<PaletteGroup[]>(() => [
  ...hits.value,
  ...actions.value,
  navigation.value,
  ...capture.value,
]);
</script>

<template>
  <Palette v-model:open="open" v-model:query="query" :groups="groups" />
</template>
