import { expect, test } from 'vitest';
import {
  LAND_ROOT,
  Land,
  Link,
  atom,
  createSpace,
  fixedClock,
  memoryStore,
  model,
  openVault,
  parts,
  randomSession,
  t,
} from '@sync/core';
import { createDek, openWith, unlock } from '@brain/auth';
import type { LandId, SandUnit, Space, UnitStore } from '@sync/core';
import type { Sealed } from '@brain/auth';
import { isOpenPack, memoryChest, reseal, sealExisting, sealedStore } from './sealed';
import type { Chest, SealedStore } from './sealed';

/**
 * Обещания запечатанного хранилища.
 *
 * Проверяется не «функции вызываются», а то, ради чего слой заведён: на носителе
 * лежит шифртекст, чужой ключ его не открывает, порча байта не проходит мимо, а
 * данные переживают перезапуск и переезд.
 */

const Notes = model('seal/notes', {
  note: atom(t.string),
  items: parts(t.string, 'seal/notes'),
});

declare module '@sync/core' {
  interface Models {
    'seal/notes': typeof Notes;
  }
}

/** Сундук со счётчиками: чем платит хранилище, видно только по вызовам. */
function counted(inner: Chest): Chest & { appends: number; replaces: number } {
  const out = {
    ...inner,
    appends: 0,
    replaces: 0,
    append: async (land: LandId, chunk: Sealed) => {
      out.appends += 1;
      await inner.append(land, chunk);
    },
    replace: async (land: LandId, chunk: Sealed) => {
      out.replaces += 1;
      await inner.replace(land, chunk);
    },
  };
  return out;
}

const PEER = Link.peer(new Uint8Array(8).fill(0x31));
const LAND: LandId = Link.land(Link.peer(new Uint8Array(8).fill(0xa1)), new Uint8Array(8));
const OTHER: LandId = Link.land(Link.peer(new Uint8Array(8).fill(0xb2)), new Uint8Array(8));

/** Ленд поверх хранилища — тот же путь, которым его поднимает приложение. */
async function landOn(store: UnitStore, id: LandId = LAND): Promise<{
  space: Space;
  /** Дописать несохранённое и дождаться, пока оно уедет в хранилище. */
  flush: () => Promise<void>;
}> {
  const land = new Land(PEER, fixedClock(1000), { session: randomSession() });
  const vault = openVault({ store, id, land });
  const space = createSpace({ land, id, ready: vault.ready });
  await vault.opened();
  return {
    space,
    flush: async () => {
      vault.save();
      if ('settled' in store) await (store as SealedStore).settled();
    },
  };
}

async function write(store: UnitStore, note: string, id: LandId = LAND): Promise<void> {
  const { space, flush } = await landOn(store, id);
  space.edit(() => {
    space.root(Notes).note(note);
  });
  await flush();
}

async function read(store: UnitStore, id: LandId = LAND): Promise<string> {
  const { space } = await landOn(store, id);
  return space.root(Notes).note();
}

/** Есть ли эти байты где-нибудь в куске. Проверка «данные лежат текстом». */
function carries(chunk: Sealed, text: string): boolean {
  const needle = new TextEncoder().encode(text);
  const hay = chunk.cipher;
  outer: for (let at = 0; at + needle.length <= hay.length; at++) {
    for (let i = 0; i < needle.length; i++) {
      if (hay[at + i] !== needle[i]) continue outer;
    }
    return true;
  }
  return false;
}

test('на носителе лежит шифртекст, а не текст', async () => {
  const chest = memoryChest();
  const store = sealedStore({ vault: openWith(createDek()), chest });

  await write(store, 'пароль от сейфа');

  const chunks = await chest.read(LAND);
  expect(chunks.length).toBeGreaterThan(0);
  for (const chunk of chunks) {
    expect(carries(chunk, 'пароль от сейфа')).toBeFalsy();
    // И заголовка пачки там тоже нет: запечатано целиком, а не «поля вокруг».
    expect(isOpenPack(chunk.cipher)).toBeFalsy();
  }
});

test('после перезапуска с тем же ключом данные те же', async () => {
  const chest = memoryChest();
  const dek = createDek();

  await write(sealedStore({ vault: openWith(dek), chest }), 'до перезапуска');

  // Новое хранилище над тем же сундуком — модель следующего запуска вкладки.
  expect(await read(sealedStore({ vault: openWith(dek), chest }), LAND)).toBe('до перезапуска');
});

test('чужой ключ ленд не открывает', async () => {
  const chest = memoryChest();
  await write(sealedStore({ vault: openWith(createDek()), chest }), 'секрет');

  const stranger = sealedStore({ vault: openWith(createDek()), chest });
  await expect(stranger.load(LAND)).rejects.toThrow();
});

test('порча байта ловится, а не проезжает молча', async () => {
  const chest = memoryChest();
  const dek = createDek();
  await write(sealedStore({ vault: openWith(dek), chest }), 'целое');

  const [chunk] = await chest.read(LAND);
  const broken = chunk!.cipher.slice();
  broken[0] = broken[0]! ^ 0x01;
  await chest.replace(LAND, { nonce: chunk!.nonce, cipher: broken });

  // GCM обязан поймать: «расшифровалось во что-то похожее» здесь невозможно.
  await expect(sealedStore({ vault: openWith(dek), chest }).load(LAND)).rejects.toThrow();
});

test('шифртекст чужого ленда не подставить под видом своего', async () => {
  const chest = memoryChest();
  const dek = createDek();
  const store = sealedStore({ vault: openWith(dek), chest });

  await write(store, 'из первого ленда', LAND);
  await write(store, 'из второго ленда', OTHER);

  // Адрес ленда лежит в AAD, поэтому подмена целого куска не проходит — хотя
  // ключ тот же самый.
  const [stolen] = await chest.read(LAND);
  await chest.replace(OTHER, stolen!);

  await expect(sealedStore({ vault: openWith(dek), chest }).load(OTHER)).rejects.toThrow();
});

test('журнал не растёт без предела: компакция держит носитель в пределах двойки', async () => {
  const chest = memoryChest();
  const dek = createDek();
  const store = sealedStore({ vault: openWith(dek), chest });

  const { space, flush } = await landOn(store);
  for (let i = 0; i < 200; i++) {
    space.edit(() => {
      space.root(Notes).note(`правка ${i}`);
    });
    await flush();
  }

  // Двести правок одного поля — это по-прежнему один живой юнит. Без компакции
  // в журнале лежало бы двести кусков, то есть каждый следующий запуск платил
  // бы двести расшифровок за ленд размером в одну строку.
  const chunks = await chest.read(LAND);
  const stored = chunks.reduce((sum, chunk) => sum + chunk.cipher.length, 0);
  expect(chunks.length).toBeLessThanOrEqual(4);
  expect(stored).toBeLessThan(4096);
  expect(await read(sealedStore({ vault: openWith(dek), chest }))).toBe('правка 199');
});

test('растущий ленд не переписывается целиком на каждое сохранение', async () => {
  const chest = counted(memoryChest());
  const store = sealedStore({ vault: openWith(createDek()), chest });

  const { space, flush } = await landOn(store);
  const root = space.root(Notes);
  for (let i = 0; i < 200; i++) {
    space.edit(() => {
      root.items(`n${i}`).note(`запись ${i}`);
    });
    await flush();
  }

  // Обратная сторона компакции, и её легко потерять: если перепечатывать ленд
  // при первом же превышении, то сразу ПОСЛЕ перепечатки журнал снова весит с
  // образ — и следующее сохранение переписывает всё заново. Двести сохранений
  // превратились бы в двести полных перезаписей, то есть ровно в то, от чего
  // журнал заводился. Поймано живой проверкой, а не рассуждением.
  expect(chest.replaces).toBeLessThan(20);
  expect(chest.appends).toBeGreaterThan(150);
});

test('вынесенное значение достаётся по shot', async () => {
  const chest = memoryChest();
  const store = sealedStore({ vault: openWith(createDek()), chest });

  // Низкоуровневый путь: значение длиннее окна санда уезжает в ball, и только
  // такое значение вообще спрашивают у `store.ball`.
  const land = new Land(PEER, fixedClock(1000), { session: randomSession() });
  land.track();
  land.post(LAND_ROOT, LAND_ROOT, 'я'.repeat(400));
  const unit = land.part().units[0] as SandUnit;
  expect(unit.big()).toBeTruthy();
  await store.save(LAND, land.flush(LAND));

  const ball = await store.ball(LAND, unit.shot());
  expect(ball).toBeDefined();
  expect(ball!.length).toBeGreaterThan(0);
  expect(await store.ball(LAND, new Uint8Array(12).fill(7))).toBeUndefined();
});

test('второй способ доступа открывает ТЕ ЖЕ данные', async () => {
  const chest = memoryChest();
  const first = openWith(createDek());
  await write(sealedStore({ vault: first, chest }), 'заведено первым ключом');

  // Так добавляется passkey или фраза: заворачивается ТЕКУЩИЙ ключ данных.
  // Прежняя редакция экрана «Доступ» звала здесь `createDek()`, и второй способ
  // открывал пустоту вместо данных — проверка стоит ровно на этом.
  const kek = createDek();
  const wrapped = await first.wrapFor(kek, {
    kind: 'passphrase',
    label: 'фраза',
    salt: new Uint8Array(0),
  });

  const second = await unlock(wrapped, kek);
  expect(await read(sealedStore({ vault: second, chest }))).toBe('заведено первым ключом');
});

test('drop забывает ленд и на носителе, и в перечислении', async () => {
  const chest = memoryChest();
  const dek = createDek();
  const store = sealedStore({ vault: openWith(dek), chest });

  await write(store, 'временное');
  expect((await store.lands()).map(land => land.str)).toEqual([LAND.str]);

  await store.drop(LAND);
  expect(await store.lands()).toEqual([]);
  expect(await chest.read(LAND)).toEqual([]);
});

test('переезд открытого ленда в запечатанный обратим по данным', async () => {
  const plain = memoryStore();
  await write(plain, 'жил открытым');

  // Ленд опознаётся по МЕСТУ: он лежит в открытом хранилище.
  expect(isOpenPack(plain.load(LAND))).toBeTruthy();

  const chest = memoryChest();
  const dek = createDek();
  const moved = await sealExisting({ plain, chest, vault: openWith(dek) });

  expect(moved.map(land => land.str)).toEqual([LAND.str]);
  // Открытая копия убрана: иначе два источника истины разъехались бы первой же
  // правкой.
  expect(plain.lands()).toEqual([]);
  for (const chunk of await chest.read(LAND)) {
    expect(carries(chunk, 'жил открытым')).toBeFalsy();
  }
  expect(await read(sealedStore({ vault: openWith(dek), chest }))).toBe('жил открытым');
});

test('переезд не трогает ленды, которые обязаны остаться открытыми', async () => {
  const plain = memoryStore();
  await write(plain, 'обёртки ключа', LAND);
  await write(plain, 'данные модуля', OTHER);

  const chest = memoryChest();
  await sealExisting({ plain, chest, vault: openWith(createDek()), keep: [LAND] });

  expect(plain.lands().map(land => land.str)).toEqual([LAND.str]);
  expect((await chest.lands()).map(land => land.str)).toEqual([OTHER.str]);
});

test('повторный переезд перезаписывает, а не накапливает', async () => {
  const plain = memoryStore();
  await write(plain, 'один раз');

  const chest: Chest = memoryChest();
  const dek = createDek();
  await sealExisting({ plain, chest, vault: openWith(dek) });

  // Второй прогон — модель обрыва между «запечатали» и «забыли открытое»:
  // открытая копия ещё на месте, и следующий запуск встретит её снова. Ленд
  // обязан ЗАМЕСТИТЬСЯ целиком: дописывание копило бы образ на каждый обрыв.
  await write(plain, 'один раз');
  await sealExisting({ plain, chest, vault: openWith(dek) });

  expect(await chest.read(LAND)).toHaveLength(1);
  expect(await read(sealedStore({ vault: openWith(dek), chest }))).toBe('один раз');
});

/**
 * Перевыпуск под новым ключом (docs/01-security.md §7): присоединение с уже
 * имеющимися локальными данными и отзыв способа доступа оба меняют DEK у
 * данных, которые уже лежат на диске, — `reseal` это тот самый шаг.
 */

test('reseal перепечатывает ленд: данные читаются НОВЫМ ключом и лежат шифртекстом', async () => {
  const chest = memoryChest();
  const oldDek = createDek();
  await write(sealedStore({ vault: openWith(oldDek), chest }), 'до перевыпуска');

  const newDek = createDek();
  await reseal({ chest, from: openWith(oldDek), to: openWith(newDek), lands: [LAND] });

  expect(await read(sealedStore({ vault: openWith(newDek), chest }))).toBe('до перевыпуска');
  for (const chunk of await chest.read(LAND)) {
    expect(carries(chunk, 'до перевыпуска')).toBeFalsy();
  }
});

test('после reseal старый ключ ленд больше НЕ открывает', async () => {
  const chest = memoryChest();
  const oldDek = createDek();
  await write(sealedStore({ vault: openWith(oldDek), chest }), 'секрет');

  await reseal({ chest, from: openWith(oldDek), to: openWith(createDek()), lands: [LAND] });

  // Новый `sealedStore` — модель следующего запуска: образ в памяти прежнего
  // стора не подглядывается, читается заново из сундука.
  await expect(read(sealedStore({ vault: openWith(oldDek), chest }))).rejects.toThrow();
});

test('reseal нескольких лендов — каждый перепечатан своим путём', async () => {
  const chest = memoryChest();
  const oldDek = createDek();
  await write(sealedStore({ vault: openWith(oldDek), chest }), 'ленд раз', LAND);
  await write(sealedStore({ vault: openWith(oldDek), chest }), 'ленд два', OTHER);

  const newDek = createDek();
  await reseal({ chest, from: openWith(oldDek), to: openWith(newDek), lands: [LAND, OTHER] });

  const store = sealedStore({ vault: openWith(newDek), chest });
  expect(await read(store, LAND)).toBe('ленд раз');
  expect(await read(store, OTHER)).toBe('ленд два');
});

test('reseal не трогает ленды вне списка — они остаются под старым ключом', async () => {
  const chest = memoryChest();
  const oldDek = createDek();
  await write(sealedStore({ vault: openWith(oldDek), chest }), 'перевыпущенный', LAND);
  await write(sealedStore({ vault: openWith(oldDek), chest }), 'нетронутый', OTHER);

  const newDek = createDek();
  // OTHER сознательно не передан в `lands`.
  await reseal({ chest, from: openWith(oldDek), to: openWith(newDek), lands: [LAND] });

  expect(await read(sealedStore({ vault: openWith(newDek), chest }), LAND)).toBe('перевыпущенный');
  expect(await read(sealedStore({ vault: openWith(oldDek), chest }), OTHER)).toBe('нетронутый');
});

test('reseal складывает журнал ОДНИМ куском, как компакция', async () => {
  const chest = memoryChest();
  const oldDek = createDek();
  const store = sealedStore({ vault: openWith(oldDek), chest });
  // Несколько сохранений — несколько кусков в журнале ДО перевыпуска.
  await write(store, 'раз');
  await write(store, 'раз-два');
  expect((await chest.read(LAND)).length).toBeGreaterThan(1);

  await reseal({ chest, from: openWith(oldDek), to: openWith(createDek()), lands: [LAND] });

  expect(await chest.read(LAND)).toHaveLength(1);
});
