import { expect, test } from 'vitest';
import { createDek, createSalt, kekFromPrf, randomBytes, wrapDek } from './crypto';
import { openWith, unlock } from './vault';

const text = (value: string): Uint8Array => new TextEncoder().encode(value);

async function someKek(): Promise<Uint8Array> {
  return kekFromPrf(randomBytes(32), createSalt());
}

test('открытое хранилище шифрует и расшифровывает пачку ленда', async () => {
  const vault = openWith(createDek());
  const pack = text('пачка ленда');

  const sealed = await vault.sealPack('kcal', pack);
  expect(sealed.cipher).not.toEqual(pack);
  expect(await vault.openPack('kcal', sealed)).toEqual(pack);
});

test('пачку одного ленда не подсунуть под видом другого', async () => {
  // Адрес ленда идёт в AAD именно ради этого случая.
  const vault = openWith(createDek());
  const sealed = await vault.sealPack('kcal', text('дневник питания'));

  await expect(vault.openPack('notes', sealed)).rejects.toThrow();
});

test('замок забывает ключ: после него хранилище бесполезно', async () => {
  const vault = openWith(createDek());
  const sealed = await vault.sealPack('kcal', text('данные'));

  vault.lock();

  await expect(vault.openPack('kcal', sealed)).rejects.toThrow(/заперто/);
  await expect(vault.sealPack('kcal', text('ещё'))).rejects.toThrow(/заперто/);
});

test('повторный замок не падает', () => {
  const vault = openWith(createDek());
  vault.lock();
  expect(() => {
    vault.lock();
  }).not.toThrow();
});

test('хранилище держит СВОЮ копию ключа: затирание исходного массива его не ломает', async () => {
  const dek = createDek();
  const vault = openWith(dek);
  dek.fill(0);

  const sealed = await vault.sealPack('kcal', text('жив'));
  expect(await vault.openPack('kcal', sealed)).toEqual(text('жив'));
});

test('открытие обёртки своим ключом даёт то же хранилище', async () => {
  const dek = createDek();
  const kek = await someKek();
  const wrapped = await wrapDek(dek, kek, { kind: 'passkey', label: 'телефон', salt: createSalt() });

  const first = openWith(dek);
  const sealed = await first.sealPack('notes', text('заметка'));

  const second = await unlock(wrapped, kek);
  expect(await second.openPack('notes', sealed)).toEqual(text('заметка'));
});

test('открытие чужим ключом отказывает, а не отдаёт мусор', async () => {
  const wrapped = await wrapDek(createDek(), await someKek(), {
    kind: 'passkey',
    label: 'телефон',
    salt: createSalt(),
  });

  await expect(unlock(wrapped, await someKek())).rejects.toThrow();
});

test('второе устройство получает доступ через свою обёртку, данные не перешифровываются', async () => {
  const dek = createDek();
  const phone = openWith(dek);
  const sealed = await phone.sealPack('notes', text('старая заметка'));

  // Телефон заворачивает DEK для ноутбука — это добавление обёртки, а не
  // перешифрование данных (docs/01-security.md §7).
  const laptopKek = await someKek();
  const forLaptop = await phone.wrapFor(laptopKek, {
    kind: 'passkey',
    label: 'ноутбук',
    salt: createSalt(),
  });

  const laptop = await unlock(forLaptop, laptopKek);
  expect(await laptop.openPack('notes', sealed)).toEqual(text('старая заметка'));
});
