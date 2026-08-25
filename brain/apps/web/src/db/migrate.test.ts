import { expect, test } from 'vitest';
import { Land, Link, createSpace, fixedClock, memoryStore, openVault, randomSession } from '@sync/core';
import type { LandId, MemoryStore, Space } from '@sync/core';
import { MetaModel, readInbox, writeInbox } from './meta';
import { moveInbox } from './migrate';

/**
 * Переезд инбокса из открытого мета-ленда в шифрованный.
 *
 * Проверяется не «функция вызвалась», а обещание: после переезда в мета-ленде,
 * который лежит на диске ОТКРЫТЫМ, пойманного текста больше нет ни в записях,
 * ни в байтах.
 */

const PEER = Link.peer(new Uint8Array(8).fill(0x31));
const META: LandId = Link.land(Link.peer(new Uint8Array(8).fill(0x6D)), new Uint8Array(8));
const INBOX: LandId = Link.land(Link.peer(new Uint8Array(8).fill(0x69)), new Uint8Array(8));

const SECRET = 'записка про то, где лежит запасной ключ';

async function landOn(store: MemoryStore, id: LandId): Promise<{ space: Space; flush: () => void }> {
  const land = new Land(PEER, fixedClock(1000), { session: randomSession() });
  const vault = openVault({ store, id, land });
  const space = createSpace({ land, id, ready: vault.ready });
  await vault.opened();
  return {
    space,
    flush: () => {
      vault.save();
    },
  };
}

function items(space: Space): Array<ReturnType<typeof readInbox>> {
  const root = space.root(MetaModel);
  return root.inbox.keys().map(id => readInbox(id, root.inbox(id)));
}

/** Есть ли эти байты в образе ленда — то есть лежит ли текст на диске. */
function carries(bin: Uint8Array, text: string): boolean {
  const needle = new TextEncoder().encode(text);
  outer: for (let at = 0; at + needle.length <= bin.length; at++) {
    for (let i = 0; i < needle.length; i++) {
      if (bin[at + i] !== needle[i]) continue outer;
    }
    return true;
  }
  return false;
}

async function legacy(): Promise<{ store: MemoryStore; meta: Space; inbox: Space; flush: () => void }> {
  const store = memoryStore();
  const one = await landOn(store, META);
  const two = await landOn(store, INBOX);

  const root = one.space.root(MetaModel);
  one.space.edit(() => {
    writeInbox(root.inbox('a'), { id: 'a', text: SECRET, source: 'вручную', createdAt: 10 });
    writeInbox(root.inbox('b'), {
      id: 'b',
      text: 'ссылка',
      url: 'https://example.com',
      source: 'поделились',
      createdAt: 20,
    });
  });
  one.flush();

  return {
    store,
    meta: one.space,
    inbox: two.space,
    flush: () => {
      one.flush();
      two.flush();
    },
  };
}

test('записи уезжают в свой ленд целиком', async () => {
  const { meta, inbox } = await legacy();

  expect(moveInbox(meta, inbox)).toBe(2);

  const moved = items(inbox).sort((a, b) => a.createdAt - b.createdAt);
  expect(moved).toHaveLength(2);
  expect(moved[0]!.text).toBe(SECRET);
  expect(moved[0]!.source).toBe('вручную');
  expect(moved[1]!.url).toBe('https://example.com');
});

test('в открытом мета-ленде не остаётся ни записей, ни их текста', async () => {
  const { store, meta, inbox, flush } = await legacy();

  // До переезда текст в открытом ленде ЕСТЬ — иначе проверка ниже ничего не
  // значила бы.
  expect(carries(store.load(META), SECRET)).toBeTruthy();

  moveInbox(meta, inbox);
  flush();

  expect(items(meta)).toHaveLength(0);
  // Удаления мало: `delete` кладёт надгробие на ключ, а атомы с текстом
  // остаются в ленде. Поэтому переезд их затирает — и вот это проверяется.
  expect(carries(store.load(META), SECRET)).toBeFalsy();
});

test('повторный переезд не плодит дублей', async () => {
  const { meta, inbox } = await legacy();

  // Обрыв между «перенесли» и «очистили»: записи уже в новом ленде, но в старом
  // ещё лежат. Так выглядит вкладка, закрытая посреди переезда, — и следующий
  // запуск обязан доделать, а не удвоить.
  const root = inbox.root(MetaModel);
  inbox.edit(() => {
    writeInbox(root.inbox('a'), { id: 'a', text: SECRET, source: 'вручную', createdAt: 10 });
  });

  expect(moveInbox(meta, inbox)).toBe(2);
  expect(items(inbox)).toHaveLength(2);
  expect(moveInbox(meta, inbox)).toBe(0);
});
