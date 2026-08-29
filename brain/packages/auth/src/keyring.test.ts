import { describe, expect, test } from 'vitest';
import { createSalt, randomBytes } from './crypto';
import { createKeyring, decodeGrant, decodeSecrets, dropKeyring, keyringFromMaterial, openSpaceVault, unlockKeyring } from './keyring';
import type { RingStore } from './keyring';

/**
 * Гейт корректности связки (docs/01-security.md ревизия 3): мастер стабилен,
 * связка мутабельна, чужой KEK не подходит, замок затирает.
 */

function memoryStore(): RingStore {
  const map = new Map<string, string>();
  return {
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: key => void map.delete(key),
  };
}

const META = { kind: 'passphrase' as const, label: 'фраза', salt: createSalt() };

describe('Keyring', () => {
  test('Secret is created once and survives the wrap → unwrap cycle', async () => {
    const store = memoryStore();
    const ring = await createKeyring(store);
    const first = await ring.ensure('notes');
    expect(await ring.ensure('notes')).toBe(first);
    expect(ring.secretOf('notes')).toBe(first);
    expect(ring.secretOf('tasks')).toBeNull();

    const kek = randomBytes(32);
    const wrap = await ring.wrapFor(kek, META);
    const raw = ring.rawOf('notes');

    const reopened = await unlockKeyring(wrap, kek, store);
    expect(reopened.lands()).toEqual(['notes']);
    expect(reopened.rawOf('notes')).toEqual(raw);
  });

  test('New land after wrapping: the old wrap opens it too', async () => {
    const store = memoryStore();
    const ring = await createKeyring(store);
    const kek = randomBytes(32);
    const wrap = await ring.wrapFor(kek, META); // обёртка выдана ДО появления лендов

    await ring.ensure('notes');
    await ring.ensure('kcal');

    // Тот же wrap открывает связку с обоими секретами: мастер не менялся.
    const reopened = await unlockKeyring(wrap, kek, store);
    expect(new Set(reopened.lands())).toEqual(new Set(['notes', 'kcal']));
  });

  test('A foreign KEK does not open', async () => {
    const store = memoryStore();
    const ring = await createKeyring(store);
    await ring.ensure('notes');
    const wrap = await ring.wrapFor(randomBytes(32), META);
    await expect(unlockKeyring(wrap, randomBytes(32), store)).rejects.toThrow();
  });

  test('adopt accepts foreign secrets and disputes on divergence', async () => {
    const store = memoryStore();
    const ring = await createKeyring(store);
    await ring.ensure('notes');
    const mine = ring.rawOf('notes') as Uint8Array;

    const foreign = decodeSecrets((await (async () => {
      const other = await createKeyring(memoryStore());
      await other.ensure('tasks');
      return other.exportSecrets();
    })()));
    await ring.adopt(foreign);
    expect(new Set(ring.lands())).toEqual(new Set(['notes', 'tasks']));

    // Совпадающий секрет — не конфликт; другой секрет того же ленда — конфликт.
    await ring.adopt(new Map([['notes', mine]]));
    await expect(ring.adopt(new Map([['notes', randomBytes(16)]]))).rejects.toThrow(/diverges/);
  });

  test('rotate reissues secrets, the lock wipes them', async () => {
    const store = memoryStore();
    const ring = await createKeyring(store);
    await ring.ensure('notes');
    const before = ring.rawOf('notes');
    await ring.rotate(['notes']);
    expect(ring.rawOf('notes')).not.toEqual(before);

    ring.lock();
    expect(ring.secretOf('notes')).toBeNull();
    expect(() => ring.exportSecrets()).not.toThrow(); // пустая связка — не бросок
    await expect(ring.wrapFor(randomBytes(32), META)).rejects.toThrow(/locked/);

    dropKeyring(store);
    expect(store.getItem('brain.keys.ring')).toBeNull();
  });
});

test('Grant v2 carries the master: the receiver opens the published blob', async () => {
  const a = await createKeyring(memoryStore());
  await a.ensure('notes');
  const material = decodeGrant(a.exportForGrant());
  expect(material.master).not.toBeNull();

  const b = await keyringFromMaterial(
    { master: material.master as Uint8Array, secrets: material.secrets },
    memoryStore(),
  );
  // Один мастер: блоб, опубликованный одним, открывается другим.
  const blob = await a.sealedSecrets();
  const opened = await b.openBlob(blob);
  expect([...opened.keys()]).toEqual(['notes']);
  // Грант v1 (только секреты) разбирается тем же декодером.
  expect(decodeGrant(a.exportSecrets()).master).toBeNull();
});

test('The phrase vault opens the space without the granting device', async () => {
  const owner = await createKeyring(memoryStore());
  await owner.ensure('notes');
  await owner.ensure('kcal');

  const salt = createSalt();
  const kekPhrase = randomBytes(32); // KEK, выведенный из фразы, — вход по PBKDF2 проверяет crypto.test
  const wrapped = await owner.wrapFor(kekPhrase, { kind: 'passphrase', label: 'space', salt });
  const blob = await owner.sealedSecrets();

  const joined = await openSpaceVault(wrapped, kekPhrase, blob);
  expect(new Set(joined.secrets.keys())).toEqual(new Set(['notes', 'kcal']));
  expect(joined.master).toEqual((decodeGrant(owner.exportForGrant()).master));

  // Чужой KEK (не та фраза) — честный отказ GCM.
  await expect(openSpaceVault(wrapped, randomBytes(32), blob)).rejects.toThrow();
});

test('rotateMaster invalidates old wraps and old blobs', async () => {
  const store = memoryStore();
  const ring = await createKeyring(store);
  await ring.ensure('notes');
  const kek = randomBytes(32);
  const oldWrap = await ring.wrapFor(kek, META);
  const oldBlob = await ring.sealedSecrets();

  await ring.rotateMaster();

  // Старая обёртка открывает СТАРЫЙ мастер, которым новый блоб не открыть.
  await expect(unlockKeyring(oldWrap, kek, store)).rejects.toThrow();
  // Новый мастер не открывает блоб, запечатанный старым.
  await expect(ring.openBlob(oldBlob)).rejects.toThrow();
  // Новая обёртка + новый блоб — рабочая пара.
  const freshWrap = await ring.wrapFor(kek, META);
  const reopened = await unlockKeyring(freshWrap, kek, store);
  expect(reopened.lands()).toEqual(['notes']);
});
