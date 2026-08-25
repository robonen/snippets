import { createStorage } from 'unstorage';
import { beforeEach, describe, expect, it } from 'vitest';
import { CHALLENGE_COOKIE, CHALLENGE_PATH, consumeChallenge, issueChallenge } from './challenges';
import type { Storage } from 'unstorage';

let storage: Storage;

beforeEach(() => {
  storage = createStorage();
});

describe(issueChallenge, () => {
  it('заводит id и challenge как РАЗНЫЕ случайные значения', async () => {
    const a = await issueChallenge('register', storage);
    expect(a.id).not.toBe(a.challenge);
    const b = await issueChallenge('register', storage);
    expect(a.id).not.toBe(b.id);
    expect(a.challenge).not.toBe(b.challenge);
  });

  it('TTL — 5 минут', async () => {
    const { maxAgeSeconds } = await issueChallenge('login', storage);
    expect(maxAgeSeconds).toBe(5 * 60);
  });

  it('имя cookie и область видимости зафиксированы контрактом', () => {
    expect(CHALLENGE_COOKIE).toBe('brain_challenge');
    expect(CHALLENGE_PATH).toBe('/auth');
  });
});

describe(consumeChallenge, () => {
  it('верный id и вид — отдаёт тот же challenge, что выдали', async () => {
    const issued = await issueChallenge('register', storage);
    expect(await consumeChallenge(issued.id, 'register', storage)).toBe(issued.challenge);
  });

  it('одноразовый: второй запрос тем же id — null, даже сразу после успеха', async () => {
    const issued = await issueChallenge('register', storage);
    await consumeChallenge(issued.id, 'register', storage);
    expect(await consumeChallenge(issued.id, 'register', storage)).toBeNull();
  });

  it('одноразовый даже при НЕУДАЧНОЙ проверке (не тот kind) — challenge сгорает', async () => {
    const issued = await issueChallenge('register', storage);
    // Пришли не на тот путь — kind не совпал, консьюм проваливается.
    expect(await consumeChallenge(issued.id, 'login', storage)).toBeNull();
    // Повтор ПРАВИЛЬНЫМ kind тоже проваливается: запись уже стёрта.
    expect(await consumeChallenge(issued.id, 'register', storage)).toBeNull();
  });

  it('пустой, undefined и null id — null, не исключение', async () => {
    expect(await consumeChallenge('', 'register', storage)).toBeNull();
    expect(await consumeChallenge(undefined, 'register', storage)).toBeNull();
    expect(await consumeChallenge(null, 'register', storage)).toBeNull();
  });

  it('незнакомый id — null', async () => {
    expect(await consumeChallenge('выдуманный', 'register', storage)).toBeNull();
  });

  it('битая запись в хранилище — null, а запись убирается', async () => {
    await storage.setItem('challenge:кривая', { мусор: 1 });
    expect(await consumeChallenge('кривая', 'register', storage)).toBeNull();
    expect(await storage.getItem('challenge:кривая')).toBeNull();
  });

  it('истёкший challenge — null', async () => {
    await storage.setItem('challenge:старый', {
      kind: 'login',
      challenge: 'abc',
      expiresAt: Date.now() - 1000,
    });
    expect(await consumeChallenge('старый', 'login', storage)).toBeNull();
  });
});
