import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authorized } from './auth';

const saved = process.env.SYNC_TOKEN;

beforeEach(() => {
  delete process.env.SYNC_TOKEN;
});

afterEach(() => {
  if (saved === undefined) delete process.env.SYNC_TOKEN;
  else process.env.SYNC_TOKEN = saved;
});

describe(authorized, () => {
  it('без токена в окружении отказывает ВСЕМ, включая пустой заголовок', () => {
    expect(authorized('что угодно')).toBeFalsy();
    expect(authorized('Bearer что угодно')).toBeFalsy();
    expect(authorized('')).toBeFalsy();
    expect(authorized(undefined)).toBeFalsy();
    expect(authorized(null)).toBeFalsy();

    // Пустая строка в env — это «не настроен», а не «пустой пароль подойдёт».
    process.env.SYNC_TOKEN = '';
    expect(authorized('')).toBeFalsy();
  });

  it('пропускает верный токен и с префиксом Bearer, и без него', () => {
    process.env.SYNC_TOKEN = 'секрет';
    expect(authorized('секрет')).toBeTruthy();
    expect(authorized('Bearer секрет')).toBeTruthy();
  });

  it('отвергает чужой токен, отсутствующий заголовок и подстроку верного', () => {
    process.env.SYNC_TOKEN = 'секрет';
    expect(authorized('другой')).toBeFalsy();
    expect(authorized('секре')).toBeFalsy();
    expect(authorized('секрет ')).toBeFalsy();
    expect(authorized(undefined)).toBeFalsy();
    expect(authorized(null)).toBeFalsy();
    // `Bearer` снимается один раз: двойной префикс — не тот токен.
    expect(authorized('Bearer Bearer секрет')).toBeFalsy();
  });
});
