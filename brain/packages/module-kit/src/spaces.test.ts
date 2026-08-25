import { expect, test } from 'vitest';
import { Link, atom, fixedClock, memoryStore, mintSecret, model, secretKey, t } from '@sync/core';
import type { SecretRing, SubtleKey, UnitStore } from '@sync/core';
import { defineComponent } from 'vue';
import { openSpaces } from './spaces';
import { defineModule } from './module';
import { landId } from './land';
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

/**
 * Связка на один общий ключ: секреты по лендам проверяет `@brain/auth`, здесь
 * важна сама граница «в памяти открыто, на носителе шифртекст».
 */
async function ring(): Promise<SecretRing> {
  const key: SubtleKey = await secretKey(mintSecret());
  return { secretOf: () => key };
}

/** Сборка на памяти: без IndexedDB, без канала вкладок, с неподвижными часами. */
function build(modules: readonly BrainModule[], store: UnitStore = memoryStore()): Spaces {
  return openSpaces({
    modules,
    store,
    tabs: false,
    peer: PEER,
    clock: fixedClock(1000),
  });
}

async function open(modules: readonly BrainModule[]): Promise<Spaces> {
  const spaces = build(modules);
  await spaces.unseal(await ring());
  return spaces;
}

test('Each module has its own space on its own land', async () => {
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

  await spaces.close();
});

test('Module space opens a neighboring land — [[…]] links rest on this', async () => {
  const spaces = await open([notes(), kcal()]);
  spaces.space('kcal').root(Foods).food('гречка');

  // Модуль заметок дошёл до чужой сущности, зная только её адрес.
  const neighbour = spaces.space('notes').of(landId('kcal'));
  expect(neighbour.root(Foods).food()).toBe('гречка');
  expect(neighbour).toBe(spaces.space('kcal'));

  await spaces.close();
});

test('A forward link works like a backward one: the neighbor is looked up at call time', async () => {
  const spaces = await open([notes(), kcal()]);
  expect(() => spaces.space('notes').of(landId('kcal'))).not.toThrow();
  await spaces.close();
});

test('A link into an unassembled module fails loudly', async () => {
  const spaces = await open([notes()]);
  expect(() => spaces.space('notes').of(landId('tasks'))).toThrow(/not open/);
  await spaces.close();
});

test('Seeding is called after hydration and exactly once', async () => {
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
  await spaces.close();
});

test('The lock removes decrypted data, and the keyring puts it back', async () => {
  const store = memoryStore();
  const keys = await ring();
  const spaces = build([notes()], store);

  expect(spaces.open).toBeFalsy();
  expect(() => spaces.space('notes')).toThrow(/locked/);

  await spaces.unseal(keys);
  spaces.space('notes').edit(() => {
    spaces.space('notes').root(Notes).note('до замка');
  });

  await spaces.seal();
  // Заперто — расшифрованного в этой вкладке нет вовсе, а не спрятано за `v-if`.
  expect(spaces.open).toBeFalsy();
  expect(() => spaces.space('notes')).toThrow(/locked/);

  await spaces.unseal(keys);
  expect(spaces.space('notes').root(Notes).note()).toBe('до замка');
  await spaces.close();
});

test('Ciphertext on the medium: internal storage holds no plaintext', async () => {
  const store = memoryStore();
  const keys = await ring();
  const spaces = build([notes()], store);
  await spaces.unseal(keys);

  spaces.space('notes').edit(() => {
    spaces.space('notes').root(Notes).note('сугубо личная запись');
  });
  await spaces.seal();

  const raw = await store.load(landId('notes'));
  const needle = new TextEncoder().encode('личная').join(',');
  expect(raw.join(',').includes(needle)).toBeFalsy();
});

test('Unknown module is a typo: space throws', async () => {
  const spaces = await open([notes()]);
  expect(() => spaces.space('tasks')).toThrow(/not assembled/);
  expect(spaces.ownerOf(landId('notes'))).toBe('notes');
  expect(spaces.ownerOf(landId('tasks'))).toBeUndefined();
  await spaces.close();
});
