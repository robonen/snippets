import { expect, test } from 'vitest';
import { Link, atom, fixedClock, memoryStore, model, t } from '@sync/core';
import { createDek, openWith } from '@brain/auth';
import { defineComponent } from 'vue';
import { openSpaces } from './spaces';
import { memoryChest } from './sealed';
import { defineModule } from './module';
import { landId } from './land';
import type { Chest } from './sealed';
import type { BrainModule } from './module';
import type { Spaces } from './spaces';

const Notes = model('kit/notes', { note: atom(t.string) });
const Foods = model('kit/foods', { food: atom(t.string) });

declare module '@sync/core' {
  interface Models {
    'kit/notes': typeof Notes;
    'kit/foods': typeof Foods;
  }
}

const Screen = defineComponent({ name: 'screen', setup: () => () => null });

function notes(seed?: BrainModule['land']['seed']): BrainModule {
  return defineModule({
    id: 'notes',
    title: 'Заметки',
    land: { root: 'kit/notes', ...(seed && { seed }) },
    routes: [{ path: '', component: Screen }],
  });
}

function kcal(seed?: BrainModule['land']['seed']): BrainModule {
  return defineModule({
    id: 'kcal',
    title: 'Ккал',
    land: { root: 'kit/foods', ...(seed && { seed }) },
    routes: [{ path: '', component: Screen }],
  });
}

const PEER = Link.peer(new Uint8Array(8).fill(0x31));

/** Свежее хранилище ключа. Настоящее, а не подделка: WebCrypto есть и в Node. */
function vault() {
  return openWith(createDek());
}

/**
 * Сборка на памяти: без IndexedDB, без канала вкладок, с неподвижными часами.
 *
 * Ленды поднимаются в два захода, как в приложении: `openSpaces` открывает
 * только мета-ленд, остальное приезжает по ключу.
 */
async function open(modules: readonly BrainModule[], chest: Chest = memoryChest()): Promise<Spaces> {
  const spaces = await openSpaces({
    modules,
    store: memoryStore(),
    chest,
    tabs: false,
    peer: PEER,
    clock: fixedClock(1000),
  });
  await spaces.unseal(vault());
  return spaces;
}

test('у каждого модуля своё пространство на своём ленде', async () => {
  const spaces = await open([notes(), kcal()]);

  const a = spaces.space('notes');
  const b = spaces.space('kcal');
  expect(a).not.toBe(b);
  expect(a.land.str).toBe(landId('notes').str);
  expect(b.land.str).toBe(landId('kcal').str);

  // Данные не перетекают: одинаковое имя поля в разных лендах — разные данные.
  a.root(Notes).note('своё');
  expect(a.root(Notes).note()).toBe('своё');
  expect(b.root(Foods).food()).toBe('');

  spaces.close();
});

test('пространство модуля открывает соседний ленд — на этом держатся ссылки [[…]]', async () => {
  const spaces = await open([notes(), kcal()]);
  spaces.space('kcal').root(Foods).food('гречка');

  // Модуль заметок дошёл до чужой сущности, зная только её адрес.
  const neighbour = spaces.space('notes').of(landId('kcal'));
  expect(neighbour.root(Foods).food()).toBe('гречка');
  expect(neighbour).toBe(spaces.space('kcal'));

  spaces.close();
});

test('ссылка вперёд работает так же, как назад: сосед ищется в момент вызова', async () => {
  // «notes» открывается ПЕРВЫМ и ссылается на «kcal», которого в этот момент
  // ещё нет в карте — поиск обязан быть ленивым.
  const spaces = await open([notes(), kcal()]);
  expect(() => spaces.space('notes').of(landId('kcal'))).not.toThrow();
  spaces.close();
});

test('ссылка в несобранный модуль отказывается громко', async () => {
  const spaces = await open([notes()]);
  expect(() => spaces.space('notes').of(landId('tasks'))).toThrow(/не открыт/);
  spaces.close();
});

test('посев зовётся после гидрации и ровно один раз', async () => {
  const calls: string[] = [];
  const spaces = await open([
    notes((space) => {
      calls.push('notes');
      // Ленд уже поднят, значит «пусто» здесь правда, а не «данные ещё едут».
      if (space.root(Notes).note() === '') space.root(Notes).note('посеяно');
    }),
    kcal(() => { calls.push('kcal'); }),
  ]);

  expect(calls).toEqual(['notes', 'kcal']);
  expect(spaces.space('notes').root(Notes).note()).toBe('посеяно');
  spaces.close();
});

test('системный ленд открывается рядом с модульными и живёт отдельно', async () => {
  const spaces = await openSpaces({
    modules: [notes()],
    system: { root: 'kit/foods' },
    store: memoryStore(),
    chest: memoryChest(),
    tabs: false,
    peer: PEER,
    clock: fixedClock(1000),
  });
  await spaces.unseal(vault());

  const meta = spaces.system();
  expect(meta.land.str).toBe(landId('meta').str);
  expect(meta).not.toBe(spaces.space('notes'));

  // Оболочка и модуль пишут в РАЗНЫЕ ленды: инбокс переживёт выключение модуля.
  meta.root(Foods).food('инбокс');
  spaces.space('notes').root(Notes).note('заметка');
  expect(meta.root(Foods).food()).toBe('инбокс');

  // Ленд оболочки виден модулю как сосед — ссылки ходят и туда.
  expect(spaces.space('notes').of(landId('meta'))).toBe(meta);

  spaces.close();
});

test('замок убирает расшифрованное, а ключ возвращает данные на место', async () => {
  const store = memoryStore();
  const chest = memoryChest();
  const dek = createDek();
  const spaces = await openSpaces({
    modules: [notes()],
    system: { root: 'kit/foods' },
    store,
    chest,
    tabs: false,
    peer: PEER,
    clock: fixedClock(1000),
  });

  await spaces.unseal(openWith(dek));
  spaces.space('notes').edit(() => {
    spaces.space('notes').root(Notes).note('до замка');
  });

  await spaces.seal();
  // Заперто — расшифрованного в этой вкладке нет вовсе, а не спрятано за `v-if`.
  expect(spaces.open).toBeFalsy();
  expect(() => spaces.space('notes')).toThrow(/запечатан/);
  // Мета-ленд при этом остаётся: из него читаются обёртки ключа.
  expect(() => spaces.system()).not.toThrow();

  await spaces.unseal(openWith(dek));
  expect(spaces.space('notes').root(Notes).note()).toBe('до замка');
  spaces.close();
});

test('без системного ленда обращение к нему отказывается громко', async () => {
  const spaces = await open([notes()]);
  expect(() => spaces.system()).toThrow(/не заказан/);
  spaces.close();
});

test('мета-ленд поднимается раньше модульных: он открыт, они ещё запечатаны', async () => {
  const order: string[] = [];
  const spaces = await openSpaces({
    modules: [notes(() => order.push('notes'))],
    system: { root: 'kit/foods', seed: () => order.push('meta') },
    shell: [{ id: 'inbox', seed: () => order.push('inbox') }],
    store: memoryStore(),
    chest: memoryChest(),
    tabs: false,
    peer: PEER,
    clock: fixedClock(1000),
  });

  // До ключа открыт ровно один ленд — тот, в котором лежат обёртки ключа.
  expect(order).toEqual(['meta']);
  expect(spaces.open).toBeFalsy();
  expect(() => spaces.space('notes')).toThrow(/запечатан/);

  await spaces.unseal(vault());
  expect(order).toEqual(['meta', 'inbox', 'notes']);
  expect(spaces.open).toBeTruthy();
  spaces.close();
});

test('незнакомый модуль — опечатка: space бросает', async () => {
  const spaces = await open([notes()]);
  expect(() => spaces.space('tasks')).toThrow(/не собран/);
  expect(spaces.ownerOf(landId('notes'))).toBe('notes');
  expect(spaces.ownerOf(landId('tasks'))).toBeUndefined();
  spaces.close();
});
