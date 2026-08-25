import { Land, Link, atom, createSpace, fixedClock, model, openVault, randomSession, t } from '@sync/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDek,
  createSalt,
  encodeBytes,
  kekFromPassphrase,
  openWith,
  packWrap,
  unlock as unlockVault,
} from '@brain/auth';
import { landId, memoryChest, sealedStore } from '@brain/module-kit';
import { armLock, currentVault, unlockByPhrase } from './lock';
import { saveWrap } from './keys';
import { completeJoin, revokeAccess, unwrapViaPasskey, unwrapViaPhrase } from './account';
import type { LoginOutcome } from './account';
import type { OpenVault, WrappedDek } from '@brain/auth';
import type { Chest, SealedStore } from '@brain/module-kit';
import type { LandId, Space, UnitStore } from '@sync/core';

/** Тестовая модель — ровно затем, чтобы `sealedStore` было ЧТО перепечатывать
 * настоящей пачкой `@sync/core`, а не произвольными байтами (`save`/`load`
 * гоняют пачки CRDT, а не текст — попытка сохранить сырые байты роняет
 * `PackImage.merge` на «пакет не кратен 8»). */
const Note = model('account-test/note', { text: atom(t.string) });

declare module '@sync/core' {
  interface Models {
    'account-test/note': typeof Note;
  }
}

async function writeLand(store: UnitStore, id: LandId, text: string): Promise<void> {
  const peer = Link.peer(new Uint8Array(8).fill(0x22));
  const land = new Land(peer, fixedClock(1000), { session: randomSession() });
  const vault = openVault({ store, id, land });
  const space = createSpace({ land, id, ready: vault.ready });
  await vault.opened();
  space.edit(() => {
    space.root(Note).text(text);
  });
  vault.save();
  if ('settled' in store) await (store as SealedStore).settled();
  vault.close();
}

async function readLand(store: UnitStore, id: LandId): Promise<string> {
  const peer = Link.peer(new Uint8Array(8).fill(0x22));
  const land = new Land(peer, fixedClock(1000), { session: randomSession() });
  const vault = openVault({ store, id, land });
  const space = createSpace({ land, id, ready: vault.ready });
  await vault.opened();
  const text = space.root(Note).text();
  vault.close();
  return text;
}

/**
 * Проверяются ИМЕННО сценарии из плана — выбор пути к DEK, присоединение (со
 * свежим устройством и с локальными данными), отзыв, — а не проводка вокруг
 * них: `bindAccount`/`joinLogin` зовут настоящий WebAuthn (`register`/`authenticate`
 * из `@brain/auth`) и в Node не запускаются («тонкий край над платформой»,
 * docs/01-security.md §9) — здесь их вход подаётся вручную, тем же путём, что
 * тестирует `sealed.test.ts` для крипто-хранилища.
 *
 * `localStorage` в этой среде (`vitest.config.ts`: `environment: 'node'`) не
 * существует как глобал вовсе — `saveSyncSettings`/`deviceMarks` внутри
 * `security/account.ts` берут его без инъекции (это код для браузера), поэтому
 * здесь заводится минимальная замена на объекте `globalThis`.
 */

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: key => void map.delete(key),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  } as Storage;
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const META_LAND = landId('meta-test');
const LAND_A = landId('land-a');
const LAND_B = landId('land-b');

function metaSpace(): Space {
  const peer = Link.peer(new Uint8Array(8).fill(0x11));
  const land = new Land(peer, fixedClock(1000), { session: randomSession() });
  // `ready` не передаётся: он гейтит чтение, пока ленд едет из хранилища
  // (ADR-002), а этот `Land` ни с каким `UnitStore` не связан — он живёт
  // только в памяти теста, гидрировать нечего.
  return createSpace({ land, id: META_LAND });
}

/**
 * Устройство «арендует» замок настоящим путём: фраза → `armLock` (видит
 * обёртку, остаётся `locked`) → `unlockByPhrase` (реально открывает,
 * `vault.value` становится ИЗВЕСТНЫМ вольтом). Так `currentVault()`/`currentMeta()`/
 * `currentChest()` в `security/account.ts` видят то же, что видело бы настоящее
 * приложение, — не сконструированное в обход состояние.
 */
async function armed(chest: Chest = memoryChest()): Promise<{ meta: Space; chest: Chest; phrase: string; wrap: WrappedDek }> {
  const meta = metaSpace();
  const dek = createDek();
  const opened = openWith(dek);
  const salt = createSalt();
  const phrase = 'акула алмаз амбар ангар апрель арбуз аромат астра бархат башня берег бисер';
  const kek = await kekFromPassphrase(phrase, salt);
  const wrap = await opened.wrapFor(kek, { kind: 'passphrase', label: 'фраза', salt });
  saveWrap(meta, wrap);

  await armLock({
    meta,
    chest,
    reveal: async () => {},
    conceal: async () => {},
  });
  await unlockByPhrase(phrase);

  return { meta, chest, phrase, wrap };
}

/**
 * Свежий, ЕЩЁ НЕ залоченный вольт со СТАРЫМ DEK — заново снят с обёртки,
 * сохранённой в `armed()`. Нужен потому, что `completeJoin`/`revokeAccess`
 * зовут `swapVault`, а та вызывает `.lock()` у ПРЕЖНЕГО `currentVault()`:
 * проверять «старый ключ не читает» на уже залоченном объекте значило бы
 * проверить не перепечатку, а сам факт `lock()` — тот бросил бы всегда,
 * независимо от того, изменились ли байты на диске.
 */
async function staleDeviceVault(wrap: WrappedDek, phrase: string): Promise<OpenVault> {
  const kek = await kekFromPassphrase(phrase, wrap.salt);
  return unlockVault(wrap, kek);
}

// ── Выбор пути к DEK ──────────────────────────────────────────────────────

describe(unwrapViaPasskey, () => {
  it('совпавший credential_id и рабочий PRF — раскрывает обёртку', async () => {
    const dek = createDek();
    const opened = openWith(dek);
    const credentialId = new Uint8Array([1, 2, 3, 4]);
    const salt = createSalt();
    const prfOutput = new Uint8Array(32).fill(7);
    // KEK выводится из PRF ровно так же, как это сделает `kekFromAssertion`
    // внутри `unwrapViaPasskey` — иначе обёртка не совпадёт по конструкции.
    const { kekFromPrf } = await import('@brain/auth');
    const kek = await kekFromPrf(prfOutput, salt);
    const wrapped = await opened.wrapFor(kek, { kind: 'passkey', label: encodeBytes(credentialId), salt });

    const login: LoginOutcome = {
      assertion: { credentialId, response: {} as never, prfOutput },
      salt,
      remote: [{ label: encodeBytes(credentialId), kind: 'passkey', blob: encodeBytes(packWrap(wrapped)) }],
    };

    const vault = await unwrapViaPasskey(login);
    expect(vault).not.toBeNull();
    expect(await vault!.sealPack('x', new TextEncoder().encode('ok'))).toBeDefined();
  });

  it('нет обёртки под этим credential_id — null, не отказ', async () => {
    const login: LoginOutcome = {
      assertion: { credentialId: new Uint8Array([9, 9]), response: {} as never, prfOutput: new Uint8Array(32) },
      salt: createSalt(),
      remote: [],
    };
    expect(await unwrapViaPasskey(login)).toBeNull();
  });

  it('обёртка нашлась, но авторизатор не отдал PRF — null', async () => {
    const credentialId = new Uint8Array([5, 5]);
    const login: LoginOutcome = {
      assertion: { credentialId, response: {} as never, prfOutput: null },
      salt: createSalt(),
      remote: [{ label: encodeBytes(credentialId), kind: 'passkey', blob: 'AAAAAAAAAAAAAAAAAAAAAA' }],
    };
    expect(await unwrapViaPasskey(login)).toBeNull();
  });

  it('обёртка совпала, но KEK чужой — это уже отказ, а не null', async () => {
    const dek = createDek();
    const opened = openWith(dek);
    const credentialId = new Uint8Array([3, 3]);
    const salt = createSalt();
    const { kekFromPrf } = await import('@brain/auth');
    const realKek = await kekFromPrf(new Uint8Array(32).fill(1), salt);
    const wrapped = await opened.wrapFor(realKek, { kind: 'passkey', label: encodeBytes(credentialId), salt });

    const login: LoginOutcome = {
      // ДРУГОЙ prfOutput — другой KEK на расшифровке.
      assertion: { credentialId, response: {} as never, prfOutput: new Uint8Array(32).fill(2) },
      salt,
      remote: [{ label: encodeBytes(credentialId), kind: 'passkey', blob: encodeBytes(packWrap(wrapped)) }],
    };
    await expect(unwrapViaPasskey(login)).rejects.toThrow();
  });
});

describe(unwrapViaPhrase, () => {
  it('верная фраза раскрывает обёртку фразы', async () => {
    const dek = createDek();
    const opened = openWith(dek);
    const phrase = 'акула алмаз амбар ангар апрель арбуз аромат астра бархат башня берег бисер';
    const salt = createSalt();
    const kek = await kekFromPassphrase(phrase, salt);
    const wrapped = await opened.wrapFor(kek, { kind: 'passphrase', label: 'фраза', salt });

    const login: LoginOutcome = {
      assertion: { credentialId: new Uint8Array(0), response: {} as never, prfOutput: null },
      salt: createSalt(),
      remote: [{ label: 'фраза', kind: 'passphrase', blob: encodeBytes(packWrap(wrapped)) }],
    };
    const vault = await unwrapViaPhrase(phrase, login);
    expect(await vault.sealPack('x', new TextEncoder().encode('ok'))).toBeDefined();
  });

  it('неверная фраза (но из словаря) — бросает', async () => {
    const dek = createDek();
    const opened = openWith(dek);
    const salt = createSalt();
    const right = 'акула алмаз амбар ангар апрель арбуз аромат астра бархат башня берег бисер';
    const wrong = 'болото бревно бронза буква булка бумага буран вагон валун ванна вафля ведро';
    const kek = await kekFromPassphrase(right, salt);
    const wrapped = await opened.wrapFor(kek, { kind: 'passphrase', label: 'фраза', salt });

    const login: LoginOutcome = {
      assertion: { credentialId: new Uint8Array(0), response: {} as never, prfOutput: null },
      salt: createSalt(),
      remote: [{ label: 'фраза', kind: 'passphrase', blob: encodeBytes(packWrap(wrapped)) }],
    };
    await expect(unwrapViaPhrase(wrong, login)).rejects.toThrow();
  });

  it('слово не из словаря — бросает ДО дорогого KDF', async () => {
    const login: LoginOutcome = {
      assertion: { credentialId: new Uint8Array(0), response: {} as never, prfOutput: null },
      salt: createSalt(),
      remote: [],
    };
    await expect(unwrapViaPhrase('это не фраза восстановления а случайный текст точка', login)).rejects.toThrow();
  });

  it('на сервере нет обёртки фразы — бросает', async () => {
    const login: LoginOutcome = {
      assertion: { credentialId: new Uint8Array(0), response: {} as never, prfOutput: null },
      salt: createSalt(),
      remote: [{ label: 'x', kind: 'passkey', blob: 'AAAAAAAAAAAAAAAAAAAAAA' }],
    };
    await expect(unwrapViaPhrase('акула алмаз амбар ангар апрель арбуз аромат астра бархат башня берег бисер', login))
      .rejects.toThrow();
  });
});

// ── Присоединение ─────────────────────────────────────────────────────────

describe(completeJoin, () => {
  it('свежее устройство (пустой сундук) — просто подставляет новый DEK', async () => {
    const chest = memoryChest();
    await armed(chest);

    const accountDek = createDek();
    const accountVault = openWith(accountDek);
    await completeJoin('', accountVault);

    expect(currentVault()).toBe(accountVault);
    expect(await chest.lands()).toEqual([]);
  });

  it('присоединение с локальными данными: перепечатывает их под аккаунтным DEK', async () => {
    const chest = memoryChest();
    const { phrase, wrap } = await armed(chest);
    const deviceVault = currentVault()!;

    // На устройстве УЖЕ есть данные, запечатанные ЕГО локальным ключом —
    // ситуация «был local-first, теперь присоединяется к аккаунту».
    await writeLand(sealedStore({ vault: deviceVault, chest }), LAND_A, 'locally-sealed');

    const accountDek = createDek();
    const accountVault = openWith(accountDek);
    await completeJoin('', accountVault);

    expect(currentVault()).toBe(accountVault);
    // Новый ключ читает то, что перепечатал `reseal`.
    expect(await readLand(sealedStore({ vault: accountVault, chest }), LAND_A)).toBe('locally-sealed');

    // А СТАРЫЙ ключ устройства эти же байты на диске больше не открывает —
    // это и есть смысл перепечатки, не просто копирование. Снят ЗАНОВО с
    // сохранённой обёртки (а не переиспользован `deviceVault`): тот уже
    // залочен `swapVault`'ом изнутри `completeJoin`, и проверка на нём
    // доказала бы только «залоченный вольт не читает», не «старый ключ не
    // подходит к перепечатанным байтам».
    const stale = await staleDeviceVault(wrap, phrase);
    await expect(readLand(sealedStore({ vault: stale, chest }), LAND_A)).rejects.toThrow();
  });

  it('присоединение с данными убирает СТАРЫЕ локальные обёртки (passkey/фраза) — они больше не открывают ничего', async () => {
    const chest = memoryChest();
    const { meta } = await armed(chest);
    const deviceVault = currentVault()!;
    await writeLand(sealedStore({ vault: deviceVault, chest }), LAND_A, 'x');

    const { listWraps } = await import('./keys');
    expect(listWraps(meta).some(w => w.kind === 'passphrase')).toBeTruthy();

    await completeJoin('', openWith(createDek()));

    // Старая фраза (созданная в `armed()`) была под ленды, которых больше нет
    // под этим ключом, — `completeJoin` обязан была её убрать.
    expect(listWraps(meta).some(w => w.kind === 'passphrase')).toBeFalsy();
  });
});

// ── Отзыв ─────────────────────────────────────────────────────────────────

describe(revokeAccess, () => {
  it('счастливый путь: новый DEK, старые обёртки не подходят, сервер подтвердил замену КАЖДОГО ленда', async () => {
    const chest = memoryChest();
    const { phrase, wrap } = await armed(chest);
    const oldVault = currentVault()!;
    await writeLand(sealedStore({ vault: oldVault, chest }), LAND_A, 'раз');
    await writeLand(sealedStore({ vault: oldVault, chest }), LAND_B, 'два');

    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      calls.push(String(input));
      return Promise.resolve(new Response(JSON.stringify({ head: 1 }), { status: 200 }));
    }));

    // Свежий KEK для фразы, оставшейся способом доступа (тот же вывод, что
    // даст повторный ввод человеком в SecurityScreen).
    const remainingKek = await kekFromPassphrase(phrase, wrap.salt);

    await revokeAccess('', 'отзываемая-метка', [{ wrap, kek: remainingKek }]);

    expect(calls.some(url => url.includes(`/sync/${LAND_A.str}/replace`))).toBeTruthy();
    expect(calls.some(url => url.includes(`/sync/${LAND_B.str}/replace`))).toBeTruthy();

    const newVault = currentVault()!;
    expect(newVault).not.toBe(oldVault);
    // Старый ключ больше не читает — снят ЗАНОВО с обёртки (см. комментарий у
    // `staleDeviceVault`): `oldVault` уже залочен `swapVault`'ом изнутри
    // `revokeAccess`, и это доказало бы не то.
    const stale = await staleDeviceVault(wrap, phrase);
    await expect(readLand(sealedStore({ vault: stale, chest }), LAND_A)).rejects.toThrow();
    expect(await readLand(sealedStore({ vault: newVault, chest }), LAND_A)).toBe('раз');
  });

  it('сервер не подтвердил замену (не online/не догнан) — честный отказ, вольт НЕ переключается', async () => {
    const chest = memoryChest();
    const { phrase, wrap } = await armed(chest);
    const oldVault = currentVault()!;
    await writeLand(sealedStore({ vault: oldVault, chest }), LAND_A, 'раз');

    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ head: 3 }), { status: 409 }))));

    const remainingKek = await kekFromPassphrase(phrase, wrap.salt);

    await expect(revokeAccess('', 'x', [{ wrap, kek: remainingKek }])).rejects.toThrow();
    // Отказ ДО переключения вольта: приложение остаётся на старом ключе, а не
    // в подвешенном состоянии со свежим DEK, но без подтверждённого сервера.
    expect(currentVault()).toBe(oldVault);
  });

  it('нечего отзывать (пустой сундук) — честный отказ', async () => {
    await armed(memoryChest());
    await expect(revokeAccess('', 'x', [])).rejects.toThrow();
  });
});
