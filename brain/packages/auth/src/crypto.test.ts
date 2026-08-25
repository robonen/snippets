import { describe, expect, test } from 'vitest';
import {
  createDek,
  createDeviceKek,
  createSalt,
  kekFromPassphrase,
  kekFromPrf,
  open,
  randomBytes,
  seal,
  unwrapDek,
  wrapDek,
} from './crypto';

/**
 * Гейт корректности конверта (docs/01-security.md §9).
 *
 * Проверяется не «шифрует и расшифровывает», а то, ради чего шифрование
 * заводилось: чужой ключ не подходит, испорченный байт ловится, а метка и
 * адрес ленда нельзя подменить.
 */

const PASSPHRASE_TEST_ITERATIONS = 1000;

const text = (value: string): Uint8Array => new TextEncoder().encode(value);

describe('AES-GCM', () => {
  test('что зашифровали — то и расшифровали', async () => {
    const key = createDek();
    const plain = text('лечу в отпуск 12 сентября');

    const sealed = await seal(key, plain);
    expect(await open(key, sealed)).toEqual(plain);
  });

  test('nonce свой у каждой операции — иначе GCM теряет и ключ аутентификации', async () => {
    const key = createDek();
    const plain = text('одно и то же');

    const a = await seal(key, plain);
    const b = await seal(key, plain);

    expect(a.nonce).not.toEqual(b.nonce);
    // Одинаковый открытый текст под одним ключом даёт разный шифртекст.
    expect(a.cipher).not.toEqual(b.cipher);
  });

  test('чужой ключ не открывает', async () => {
    const sealed = await seal(createDek(), text('секрет'));
    await expect(open(createDek(), sealed)).rejects.toThrow();
  });

  test('порча любого байта шифртекста ловится', async () => {
    const key = createDek();
    const sealed = await seal(key, text('целостность важнее секретности'));

    for (let i = 0; i < sealed.cipher.length; i++) {
      const damaged = sealed.cipher.slice();
      damaged[i]! ^= 0x01;
      await expect(open(key, { nonce: sealed.nonce, cipher: damaged })).rejects.toThrow();
    }
  });

  test('порча nonce ловится', async () => {
    const key = createDek();
    const sealed = await seal(key, text('данные'));
    const nonce = sealed.nonce.slice();
    nonce[0]! ^= 0x01;

    await expect(open(key, { nonce, cipher: sealed.cipher })).rejects.toThrow();
  });

  test('AAD подписан: с другим адресом ленда не открывается', async () => {
    const key = createDek();
    const sealed = await seal(key, text('дневник'), text('land:kcal'));

    expect(await open(key, sealed, text('land:kcal'))).toEqual(text('дневник'));
    await expect(open(key, sealed, text('land:notes'))).rejects.toThrow();
    await expect(open(key, sealed)).rejects.toThrow();
  });

  test('пустые данные шифруются и переживают цикл', async () => {
    const key = createDek();
    const sealed = await seal(key, new Uint8Array(0));
    expect(await open(key, sealed)).toEqual(new Uint8Array(0));
  });

  test('вид на кусок буфера шифруется как самостоятельные данные', async () => {
    const key = createDek();
    const backing = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const view = backing.subarray(2, 6);

    const sealed = await seal(key, view);
    expect(await open(key, sealed)).toEqual(new Uint8Array([3, 4, 5, 6]));
  });
});

describe('вывод KEK', () => {
  test('PRF: тот же вывод и та же соль дают тот же ключ', async () => {
    const prf = randomBytes(32);
    const salt = createSalt();

    expect(await kekFromPrf(prf, salt)).toEqual(await kekFromPrf(prf, salt));
  });

  test('PRF: другая соль или другой вывод — другой ключ', async () => {
    const prf = randomBytes(32);
    const salt = createSalt();
    const kek = await kekFromPrf(prf, salt);

    expect(await kekFromPrf(prf, createSalt())).not.toEqual(kek);
    expect(await kekFromPrf(randomBytes(32), salt)).not.toEqual(kek);
  });

  test('фраза: тот же ввод даёт тот же ключ, опечатка — другой', async () => {
    const salt = createSalt();
    const phrase = 'астра берег вилка гроза';

    const kek = await kekFromPassphrase(phrase, salt, PASSPHRASE_TEST_ITERATIONS);
    expect(await kekFromPassphrase(phrase, salt, PASSPHRASE_TEST_ITERATIONS)).toEqual(kek);
    expect(await kekFromPassphrase('астра берег вилка гроз', salt, PASSPHRASE_TEST_ITERATIONS))
      .not.toEqual(kek);
  });

  test('фраза нормализуется по NFKD: составной и готовый символ — один ключ', async () => {
    const salt = createSalt();
    // «й» одним кодом против «и» + U+0306. Пользователь видит одно и то же,
    // и разные ключи здесь были бы невоспроизводимой потерей данных.
    const composed = 'чайник';
    const decomposed = 'чайник';

    expect(composed).not.toBe(decomposed);
    expect(await kekFromPassphrase(composed, salt, PASSPHRASE_TEST_ITERATIONS))
      .toEqual(await kekFromPassphrase(decomposed, salt, PASSPHRASE_TEST_ITERATIONS));
  });

  test('PRF и фраза с одинаковым входом дают РАЗНЫЕ ключи', async () => {
    // Разделение назначений: один и тот же материал не должен связывать
    // два способа доступа между собой.
    const salt = createSalt();
    const shared = text('одинаковый материал'.padEnd(32, ' '));

    const viaPrf = await kekFromPrf(shared, salt);
    const viaPhrase = await kekFromPassphrase('одинаковый материал', salt, PASSPHRASE_TEST_ITERATIONS);
    expect(viaPrf).not.toEqual(viaPhrase);
  });
});

describe('конверт DEK', () => {
  test('обёртка снимается своим ключом', async () => {
    const dek = createDek();
    const kek = await kekFromPrf(randomBytes(32), createSalt());

    const wrapped = await wrapDek(dek, kek, { kind: 'passkey', label: 'телефон', salt: createSalt() });
    expect(await unwrapDek(wrapped, kek)).toEqual(dek);
  });

  test('обёртка не снимается чужим ключом', async () => {
    const kek = await kekFromPrf(randomBytes(32), createSalt());
    const other = await kekFromPrf(randomBytes(32), createSalt());

    const wrapped = await wrapDek(createDek(), kek, { kind: 'passkey', label: 'телефон', salt: createSalt() });
    await expect(unwrapDek(wrapped, other)).rejects.toThrow();
  });

  test('один DEK под N способами доступа: каждый открывает тот же ключ', async () => {
    const dek = createDek();
    const phone = await kekFromPrf(randomBytes(32), createSalt());
    const laptop = await kekFromPrf(randomBytes(32), createSalt());
    const phraseSalt = createSalt();
    const phrase = await kekFromPassphrase('астра берег вилка', phraseSalt, PASSPHRASE_TEST_ITERATIONS);

    const wraps = [
      await wrapDek(dek, phone, { kind: 'passkey', label: 'телефон', salt: createSalt() }),
      await wrapDek(dek, laptop, { kind: 'passkey', label: 'ноутбук', salt: createSalt() }),
      await wrapDek(dek, phrase, { kind: 'passphrase', label: 'фраза', salt: phraseSalt }),
    ];

    expect(await unwrapDek(wraps[0]!, phone)).toEqual(dek);
    expect(await unwrapDek(wraps[1]!, laptop)).toEqual(dek);
    expect(await unwrapDek(wraps[2]!, phrase)).toEqual(dek);
    // Добавление устройства не трогает чужие обёртки и сами данные.
    expect(wraps[0]!.cipher).not.toEqual(wraps[1]!.cipher);
  });

  test('подмена метки обёртки ломает снятие', async () => {
    const kek = await kekFromPrf(randomBytes(32), createSalt());
    const wrapped = await wrapDek(createDek(), kek, {
      kind: 'passkey',
      label: 'телефон',
      salt: createSalt(),
    });

    await expect(unwrapDek({ ...wrapped, label: 'ноутбук' }, kek)).rejects.toThrow();
    await expect(unwrapDek({ ...wrapped, kind: 'passphrase' }, kek)).rejects.toThrow();
  });
});

describe('ключ устройства', () => {
  test('ключ неизвлекаемый: байт из него не достать', async () => {
    const kek = await createDeviceKek();

    // Ровно то, ради чего он существует: экспорт обязан быть невозможен, иначе
    // ключ ничем не отличается от строки в localStorage.
    expect(kek.extractable).toBeFalsy();
    await expect(crypto.subtle.exportKey('raw', kek)).rejects.toThrow();
  });

  test('обёртка под ключом устройства снимается им и только им', async () => {
    const dek = createDek();
    const mine = await createDeviceKek();
    const stranger = await createDeviceKek();
    const wrapped = await wrapDek(dek, mine, {
      kind: 'device',
      label: 'это устройство',
      salt: new Uint8Array(0),
    });

    expect(await unwrapDek(wrapped, mine)).toEqual(dek);
    await expect(unwrapDek(wrapped, stranger)).rejects.toThrow();
  });
});
