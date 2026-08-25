import { createStorage } from 'unstorage';
import { beforeEach, describe, expect, it } from 'vitest';
import { cookieFromHeader, createSession, destroySession, sessionValid } from './sessions';
import type { Storage } from 'unstorage';

/**
 * Хранилище на памяти для КАЖДОГО теста своё: `sessionValid` принимает
 * `storage` необязательным последним параметром именно для того, чтобы тесты
 * не воевали за один и тот же синглтон файловой системы (`utils/storage.ts`).
 */
let storage: Storage;

beforeEach(() => {
  storage = createStorage();
});

describe(createSession, () => {
  it('заводит id длиной в 256 бит и живую запись на 30 дней', async () => {
    const session = await createSession(storage);
    expect(session.id.length).toBeGreaterThan(32);
    expect(session.maxAgeSeconds).toBe(30 * 24 * 60 * 60);
    expect(await sessionValid(session.id, storage)).toBeTruthy();
  });

  it('два вызова дают РАЗНЫЕ id', async () => {
    const a = await createSession(storage);
    const b = await createSession(storage);
    expect(a.id).not.toBe(b.id);
  });
});

describe(sessionValid, () => {
  it('пустой, undefined и null id — не сессия', async () => {
    expect(await sessionValid('', storage)).toBeFalsy();
    expect(await sessionValid(undefined, storage)).toBeFalsy();
    expect(await sessionValid(null, storage)).toBeFalsy();
  });

  it('незнакомый id — не сессия', async () => {
    expect(await sessionValid('выдуманный-id', storage)).toBeFalsy();
  });

  it('битая запись в хранилище — не сессия, а не брошенное исключение', async () => {
    await storage.setItem('session:кривая', { мусор: true });
    expect(await sessionValid('кривая', storage)).toBeFalsy();
  });

  it('истёкшая сессия — не валидна и стирается из хранилища (ленивая уборка)', async () => {
    await storage.setItem('session:старая', { createdAt: 0, expiresAt: Date.now() - 1000 });
    expect(await sessionValid('старая', storage)).toBeFalsy();
    expect(await storage.getItem('session:старая')).toBeNull();
  });

  it('скользящее окно: сессия у самого края TTL продлевается', async () => {
    const almostExpired = Date.now() + 60 * 60 * 1000; // час до истечения — меньше TOUCH_GRACE
    await storage.setItem('session:на-грани', { createdAt: 0, expiresAt: almostExpired });
    expect(await sessionValid('на-грани', storage)).toBeTruthy();

    const after = await storage.getItem<{ expiresAt: number }>('session:на-грани');
    expect(after?.expiresAt).toBeGreaterThan(almostExpired);
  });

  it('недавно тронутая сессия НЕ переписывается на каждый чих — экономит запись', async () => {
    // «Тронута» 10 минут назад: TTL почти целиком впереди (30 дней минус 10
    // минут) — внутри часового окна TOUCH_GRACE_MS, продлевать рано.
    const recentlyTouched = Date.now() + 30 * 24 * 60 * 60 * 1000 - 10 * 60 * 1000;
    await storage.setItem('session:свежая', { createdAt: 0, expiresAt: recentlyTouched });
    expect(await sessionValid('свежая', storage)).toBeTruthy();

    const after = await storage.getItem<{ expiresAt: number }>('session:свежая');
    expect(after?.expiresAt).toBe(recentlyTouched);
  });
});

describe(destroySession, () => {
  it('гасит сессию: после — sessionValid лжёт «нет»', async () => {
    const session = await createSession(storage);
    await destroySession(session.id, storage);
    expect(await sessionValid(session.id, storage)).toBeFalsy();
  });

  it('незнакомый, пустой и null id — не отказ, а тихий no-op', async () => {
    await expect(destroySession('незнакомый', storage)).resolves.toBeUndefined();
    await expect(destroySession('', storage)).resolves.toBeUndefined();
    await expect(destroySession(null, storage)).resolves.toBeUndefined();
  });
});

describe(cookieFromHeader, () => {
  it('находит значение среди нескольких cookie', () => {
    expect(cookieFromHeader('a=1; brain_session=xyz; b=2', 'brain_session')).toBe('xyz');
  });

  it('единственная cookie — тоже находится', () => {
    expect(cookieFromHeader('brain_session=solo', 'brain_session')).toBe('solo');
  });

  it('нет заголовка или нет искомого имени — undefined', () => {
    expect(cookieFromHeader(null, 'brain_session')).toBeUndefined();
    expect(cookieFromHeader(undefined, 'brain_session')).toBeUndefined();
    expect(cookieFromHeader('a=1; b=2', 'brain_session')).toBeUndefined();
  });

  it('пробелы вокруг пары не портят разбор', () => {
    expect(cookieFromHeader('a=1;  brain_session=xyz  ; b=2', 'brain_session')).toBe('xyz');
  });
});
