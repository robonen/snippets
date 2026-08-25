import { expect, test } from 'vitest';
import { createSSRApp, defineComponent, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { RouterView, createMemoryHistory, createRouter } from 'vue-router';
import { Link, atom, fixedClock, memoryStore, mintSecret, model, secretKey, t } from '@sync/core';
import { useDoc } from '@sync/vue';
import { createRegistry } from './registry';
import { openSpaces } from './spaces';
import { installBrain } from './context';
import { defineModule } from './module';
import type { Spaces } from './spaces';

/**
 * Смоук навигации — гейт корректности стадии Э0.
 *
 * Проверяется не «роутер работает», а стык, ради которого кит вообще
 * существует: экран модуля зовёт `useDoc()` как в одноленовом приложении, и
 * ему обязано достаться пространство ЕГО ленда — при первом заходе и после
 * перехода между модулями.
 */

const Notes = model('host/notes', { note: atom(t.string) });
const Foods = model('host/foods', { food: atom(t.string) });

declare module '@sync/core' {
  interface Models {
    'host/notes': typeof Notes;
    'host/foods': typeof Foods;
  }
}

/** Экран модуля: ничего не знает про мультиленд, просто читает свой корень. */
const NotesScreen = defineComponent({
  name: 'notes-screen',
  setup() {
    const doc = useDoc(Notes);
    return () => h('p', { id: 'screen' }, doc.note());
  },
});

const FoodsScreen = defineComponent({
  name: 'foods-screen',
  setup() {
    const doc = useDoc(Foods);
    return () => h('p', { id: 'screen' }, doc.food());
  },
});

const modules = [
  defineModule({
    id: 'notes',
    title: 'Заметки',
    land: { root: 'host/notes' },
    routes: [{ path: '', name: 'notes:index', component: NotesScreen }],
  }),
  defineModule({
    id: 'kcal',
    title: 'Ккал',
    land: { root: 'host/foods' },
    routes: [{ path: '', name: 'kcal:index', component: FoodsScreen }],
  }),
];

async function boot(): Promise<{ spaces: Spaces; visit: (path: string) => Promise<string> }> {
  const spaces = openSpaces({
    modules,
    store: memoryStore(),
    tabs: false,
    peer: Link.peer(new Uint8Array(8).fill(0x31)),
    clock: fixedClock(1000),
  });
  const key = await secretKey(mintSecret());
  await spaces.unseal({ secretOf: () => key });
  const registry = createRegistry(modules);

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'today', component: defineComponent({ setup: () => () => h('p', 'сегодня') }) },
      ...registry.routes(),
    ],
  });

  const visit = async (path: string): Promise<string> => {
    const app = createSSRApp({ setup: () => () => h(RouterView) });
    installBrain(app, { spaces, registry });
    app.use(router);
    await router.replace(path);
    await router.isReady();
    return renderToString(app);
  };

  return { spaces, visit };
}

test('экран модуля получает пространство своего ленда', async () => {
  const { spaces, visit } = await boot();
  spaces.space('notes').root(Notes).note('из заметок');
  spaces.space('kcal').root(Foods).food('из дневника');

  expect(await visit('/notes')).toContain('из заметок');
  expect(await visit('/kcal')).toContain('из дневника');

  spaces.close();
});

test('переход между модулями подменяет пространство, а не оставляет прежнее', async () => {
  const { spaces, visit } = await boot();
  spaces.space('notes').root(Notes).note('из заметок');
  spaces.space('kcal').root(Foods).food('из дневника');

  // Тот самый случай, ради которого хост — свой компонент на каждый модуль:
  // с общим компонентом Vue переиспользовал бы инстанс, `provide` не повторился
  // бы, и второй экран прочитал бы ленд первого.
  await visit('/notes');
  const second = await visit('/kcal');
  expect(second).toContain('из дневника');
  expect(second).not.toContain('из заметок');

  const back = await visit('/notes');
  expect(back).toContain('из заметок');
  expect(back).not.toContain('из дневника');

  spaces.close();
});

test('маршрут модуля помечен его именем — по этому navигация подсвечивает вкладку', async () => {
  const registry = createRegistry(modules);
  const router = createRouter({ history: createMemoryHistory(), routes: registry.routes() });

  await router.replace('/kcal');
  expect(router.currentRoute.value.meta['module']).toBe('kcal');
});
