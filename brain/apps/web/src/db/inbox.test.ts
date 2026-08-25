import { expect, test } from 'vitest';
import { Land, Link, createSpace, fixedClock, memoryStore, openVault } from '@sync/core';
import type { Space } from '@sync/core';
import { MetaModel, readInbox } from './meta';
import { inboxActions } from './inbox';

/**
 * Инбокс — единственное место, куда пишут ДО того, как решено, чьи это данные.
 * Поэтому проверяется не «функция работает», а его обещания: захват не теряется,
 * пустое не создаётся, разбор обратим.
 */

async function metaSpace(): Promise<Space> {
  const land = new Land(Link.peer(new Uint8Array(8).fill(0x31)), fixedClock(1000));
  const id = Link.land(Link.peer(new Uint8Array(8).fill(0x6D)), new Uint8Array(8));
  const vault = openVault({ store: memoryStore(), id, land });
  const space = createSpace({ land, id, ready: vault.ready });
  await vault.opened();
  return space;
}

function all(space: Space) {
  const root = space.root(MetaModel);
  return root.inbox.keys().map(id => readInbox(id, root.inbox(id)));
}

test('захват сохраняет текст и источник', async () => {
  const space = await metaSpace();
  const actions = inboxActions(space);

  const id = actions.capture({ text: '  прочитать про Peritext  ' });
  expect(id).not.toBeNull();

  const items = all(space);
  expect(items).toHaveLength(1);
  expect(items[0]!.text).toBe('прочитать про Peritext');
  expect(items[0]!.source).toBe('вручную');
  expect(items[0]!.filedAt).toBeUndefined();
});

test('пустой захват не создаёт запись', async () => {
  const space = await metaSpace();
  const actions = inboxActions(space);

  // Промах по кнопке не должен оставлять мусор: удалять его в CRDT дороже,
  // чем не создавать.
  expect(actions.capture({ text: '   ' })).toBeNull();
  expect(all(space)).toHaveLength(0);
});

test('ссылка без текста — законный захват', async () => {
  const space = await metaSpace();
  const actions = inboxActions(space);

  expect(actions.capture({ text: '', url: 'https://example.com', source: 'поделились' })).not.toBeNull();
  const items = all(space);
  expect(items[0]!.url).toBe('https://example.com');
  expect(items[0]!.source).toBe('поделились');
});

test('разбор помечает модуль и обратим', async () => {
  const space = await metaSpace();
  const actions = inboxActions(space);
  const id = actions.capture({ text: 'купить молока' })!;

  actions.file(id, 'tasks');
  const filed = all(space)[0]!;
  expect(filed.filedTo).toBe('tasks');
  expect(filed.filedAt).toBeGreaterThan(0);

  // Разобранное не удаляется: связь с тем, во что оно превратилось, нужна в
  // ревью недели, а удаление в CRDT необратимо.
  actions.unfile(id);
  expect(all(space)[0]!.filedAt).toBeUndefined();
});

test('разбор несуществующей записи молчит, а не падает', async () => {
  const space = await metaSpace();
  const actions = inboxActions(space);

  expect(() => {
    actions.file('нет такого', 'notes');
  }).not.toThrow();
  expect(all(space)).toHaveLength(0);
});

test('удаление убирает запись', async () => {
  const space = await metaSpace();
  const actions = inboxActions(space);
  const id = actions.capture({ text: 'временное' })!;

  actions.remove(id);
  expect(all(space)).toHaveLength(0);
});
