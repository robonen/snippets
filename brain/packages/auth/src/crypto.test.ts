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
  test('What was encrypted is what gets decrypted', async () => {
    const key = createDek();
    const plain = text('лечу в отпуск 12 сентября');

    const sealed = await seal(key, plain);
    expect(await open(key, sealed)).toEqual(plain);
  });

  test('Each operation gets its own nonce — otherwise GCM loses the authentication key too', async () => {
    const key = createDek();
    const plain = text('одно и то же');

    const a = await seal(key, plain);
    const b = await seal(key, plain);

    expect(a.nonce).not.toEqual(b.nonce);
    // Одинаковый открытый текст под одним ключом даёт разный шифртекст.
    expect(a.cipher).not.toEqual(b.cipher);
  });

  test('A foreign key does not open', async () => {
    const sealed = await seal(createDek(), text('секрет'));
    await expect(open(createDek(), sealed)).rejects.toThrow();
  });

  test('Corruption of any ciphertext byte is caught', async () => {
    const key = createDek();
    const sealed = await seal(key, text('целостность важнее секретности'));

    for (let i = 0; i < sealed.cipher.length; i++) {
      const damaged = sealed.cipher.slice();
      damaged[i]! ^= 0x01;
      await expect(open(key, { nonce: sealed.nonce, cipher: damaged })).rejects.toThrow();
    }
  });

  test('Nonce corruption is caught', async () => {
    const key = createDek();
    const sealed = await seal(key, text('данные'));
    const nonce = sealed.nonce.slice();
    nonce[0]! ^= 0x01;

    await expect(open(key, { nonce, cipher: sealed.cipher })).rejects.toThrow();
  });

  test('AAD is signed: does not open with a different land address', async () => {
    const key = createDek();
    const sealed = await seal(key, text('дневник'), text('land:kcal'));

    expect(await open(key, sealed, text('land:kcal'))).toEqual(text('дневник'));
    await expect(open(key, sealed, text('land:notes'))).rejects.toThrow();
    await expect(open(key, sealed)).rejects.toThrow();
  });

  test('Empty data encrypts and survives the round trip', async () => {
    const key = createDek();
    const sealed = await seal(key, new Uint8Array(0));
    expect(await open(key, sealed)).toEqual(new Uint8Array(0));
  });

  test('A view into a buffer slice encrypts as standalone data', async () => {
    const key = createDek();
    const backing = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const view = backing.subarray(2, 6);

    const sealed = await seal(key, view);
    expect(await open(key, sealed)).toEqual(new Uint8Array([3, 4, 5, 6]));
  });
});

describe('KEK derivation', () => {
  test('PRF: the same output and the same salt yield the same key', async () => {
    const prf = randomBytes(32);
    const salt = createSalt();

    expect(await kekFromPrf(prf, salt)).toEqual(await kekFromPrf(prf, salt));
  });

  test('PRF: a different salt or a different output — a different key', async () => {
    const prf = randomBytes(32);
    const salt = createSalt();
    const kek = await kekFromPrf(prf, salt);

    expect(await kekFromPrf(prf, createSalt())).not.toEqual(kek);
    expect(await kekFromPrf(randomBytes(32), salt)).not.toEqual(kek);
  });

  test('Phrase: the same input yields the same key, a typo — a different one', async () => {
    const salt = createSalt();
    const phrase = 'астра берег вилка гроза';

    const kek = await kekFromPassphrase(phrase, salt, PASSPHRASE_TEST_ITERATIONS);
    expect(await kekFromPassphrase(phrase, salt, PASSPHRASE_TEST_ITERATIONS)).toEqual(kek);
    expect(await kekFromPassphrase('астра берег вилка гроз', salt, PASSPHRASE_TEST_ITERATIONS))
      .not.toEqual(kek);
  });

  test('Phrase is NFKD-normalized: decomposed and precomposed characters — one key', async () => {
    const salt = createSalt();
    // «й» одним кодом против «и» + U+0306. Пользователь видит одно и то же,
    // и разные ключи здесь были бы невоспроизводимой потерей данных.
    const composed = 'чайник';
    const decomposed = 'чайник';

    expect(composed).not.toBe(decomposed);
    expect(await kekFromPassphrase(composed, salt, PASSPHRASE_TEST_ITERATIONS))
      .toEqual(await kekFromPassphrase(decomposed, salt, PASSPHRASE_TEST_ITERATIONS));
  });

  test('PRF and phrase with identical input yield DIFFERENT keys', async () => {
    // Разделение назначений: один и тот же материал не должен связывать
    // два способа доступа между собой.
    const salt = createSalt();
    const shared = text('одинаковый материал'.padEnd(32, ' '));

    const viaPrf = await kekFromPrf(shared, salt);
    const viaPhrase = await kekFromPassphrase('одинаковый материал', salt, PASSPHRASE_TEST_ITERATIONS);
    expect(viaPrf).not.toEqual(viaPhrase);
  });
});

describe('DEK envelope', () => {
  test('Wrap opens with its own key', async () => {
    const dek = createDek();
    const kek = await kekFromPrf(randomBytes(32), createSalt());

    const wrapped = await wrapDek(dek, kek, { kind: 'passkey', label: 'телефон', salt: createSalt() });
    expect(await unwrapDek(wrapped, kek)).toEqual(dek);
  });

  test('Wrap does not open with a foreign key', async () => {
    const kek = await kekFromPrf(randomBytes(32), createSalt());
    const other = await kekFromPrf(randomBytes(32), createSalt());

    const wrapped = await wrapDek(createDek(), kek, { kind: 'passkey', label: 'телефон', salt: createSalt() });
    await expect(unwrapDek(wrapped, other)).rejects.toThrow();
  });

  test('One DEK under N access methods: each opens the same key', async () => {
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

  test('Tampering with the wrap label breaks unwrapping', async () => {
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

describe('Device key', () => {
  test('Key is non-extractable: not a byte can be pulled out', async () => {
    const kek = await createDeviceKek();

    // Ровно то, ради чего он существует: экспорт обязан быть невозможен, иначе
    // ключ ничем не отличается от строки в localStorage.
    expect(kek.extractable).toBeFalsy();
    await expect(crypto.subtle.exportKey('raw', kek)).rejects.toThrow();
  });

  test('Wrap under the device key opens with it and only it', async () => {
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
