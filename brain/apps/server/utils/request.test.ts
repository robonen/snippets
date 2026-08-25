import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mockEvent } from 'nitro/h3';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bearerOrSession, chunkOfRequest, hasSession, landOfRequest } from './request';
import { createSession } from './sessions';
import type { H3Event } from 'nitro/h3';

/**
 * `landOfRequest`/`hasSession`/`bearerOrSession` зовут `sessionValid` БЕЗ
 * своего параметра `storage` — это осознанно тонкий, route-facing слой
 * (`utils/request.ts`), а не ещё одно место для инъекции. Поэтому здесь, в
 * отличие от `sessions.test.ts`, реальный синглтон `useStorage()` — с
 * `DATA_DIR`, указывающим на свой временный каталог на весь файл: разные
 * тесты используют РАЗНЫЕ id сессий, друг другу не мешают.
 */

let dir: string;
const savedData = process.env.DATA_DIR;
const savedToken = process.env.SYNC_TOKEN;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'brain-request-'));
  process.env.DATA_DIR = dir;
});

afterAll(async () => {
  if (savedData === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = savedData;
  await rm(dir, { recursive: true, force: true });
});

beforeEach(() => {
  delete process.env.SYNC_TOKEN;
});

afterEach(() => {
  if (savedToken === undefined) delete process.env.SYNC_TOKEN;
  else process.env.SYNC_TOKEN = savedToken;
});

function eventWith(options: { cookie?: string; authorization?: string; land?: string } = {}): H3Event {
  const headers: Record<string, string> = {};
  if (options.cookie !== undefined) headers.cookie = options.cookie;
  if (options.authorization !== undefined) headers.authorization = options.authorization;
  const event = mockEvent('http://localhost/sync/x', { headers });
  if (options.land !== undefined) event.context.params = { land: options.land };
  return event;
}

describe(hasSession, () => {
  it('нет cookie вовсе — false', async () => {
    expect(await hasSession(eventWith())).toBeFalsy();
  });

  it('cookie с валидным id сессии — true', async () => {
    const session = await createSession();
    expect(await hasSession(eventWith({ cookie: `brain_session=${session.id}` }))).toBeTruthy();
  });

  it('cookie с чужим/выдуманным id — false', async () => {
    // Значение cookie идёт через настоящий заголовок `Headers`, а он по спеке
    // ByteString — кириллица там незаконна так же, как в настоящем cookie
    // никогда не бывает: реальные id это base64url, только ASCII.
    expect(await hasSession(eventWith({ cookie: 'brain_session=fake-id' }))).toBeFalsy();
  });
});

describe(bearerOrSession, () => {
  it('верный Bearer без всякой cookie — true', async () => {
    process.env.SYNC_TOKEN = 'token';
    expect(await bearerOrSession(eventWith({ authorization: 'Bearer token' }))).toBeTruthy();
  });

  it('валидная cookie без всякого Bearer — true', async () => {
    const session = await createSession();
    expect(await bearerOrSession(eventWith({ cookie: `brain_session=${session.id}` }))).toBeTruthy();
  });

  it('ни Bearer, ни cookie — false', async () => {
    process.env.SYNC_TOKEN = 'token';
    expect(await bearerOrSession(eventWith())).toBeFalsy();
  });

  it('неверный Bearer И неверная cookie одновременно — false', async () => {
    process.env.SYNC_TOKEN = 'token';
    expect(await bearerOrSession(eventWith({ authorization: 'Bearer other', cookie: 'brain_session=none' }))).toBeFalsy();
  });
});

describe(landOfRequest, () => {
  it('нет доступа — 401 ДО разбора адреса ленда (неавторизованный не узнаёт, распарсился ли он)', async () => {
    await expect(landOfRequest(eventWith({ land: 'не-адрес-ленда' })))
      .rejects.toMatchObject({ status: 401 });
  });

  it('доступ по Bearer есть, адрес не разбирается — 400', async () => {
    process.env.SYNC_TOKEN = 'token';
    await expect(landOfRequest(eventWith({ authorization: 'Bearer token', land: 'мусор' })))
      .rejects.toMatchObject({ status: 400 });
  });

  it('доступ по cookie есть, адрес корректный — отдаёт ленд', async () => {
    const session = await createSession();
    const land = 'a2NhbGtjYWw';
    await expect(landOfRequest(eventWith({ cookie: `brain_session=${session.id}`, land })))
      .resolves.toBe(land);
  });
});

describe(chunkOfRequest, () => {
  it('непустое тело — байты как есть', async () => {
    const event = mockEvent('http://localhost/sync/x', { method: 'POST', body: new Uint8Array([1, 2, 3]) });
    expect(await chunkOfRequest(event)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('пустое тело — отказ 400: кусок журнала не бывает пустым', async () => {
    const event = mockEvent('http://localhost/sync/x', { method: 'POST' });
    await expect(chunkOfRequest(event)).rejects.toMatchObject({ status: 400 });
  });
});
