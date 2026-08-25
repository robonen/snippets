import { describe, expect, it } from 'vitest';
import { authorized } from './auth';

describe(authorized, () => {
  it('пустой секрет отказывает ВСЕМ, включая пустой заголовок', () => {
    expect(authorized('что угодно', '')).toBeFalsy();
    expect(authorized('Bearer что угодно', '')).toBeFalsy();
    expect(authorized('', '')).toBeFalsy();
    expect(authorized(undefined, '')).toBeFalsy();
    expect(authorized(null, '')).toBeFalsy();
  });

  it('пропускает верный токен и с префиксом Bearer, и без него', () => {
    expect(authorized('секрет', 'секрет')).toBeTruthy();
    expect(authorized('Bearer секрет', 'секрет')).toBeTruthy();
  });

  it('отвергает чужой токен, отсутствующий заголовок и подстроку верного', () => {
    expect(authorized('другой', 'секрет')).toBeFalsy();
    expect(authorized('секре', 'секрет')).toBeFalsy();
    expect(authorized('секрет ', 'секрет')).toBeFalsy();
    expect(authorized(undefined, 'секрет')).toBeFalsy();
    expect(authorized(null, 'секрет')).toBeFalsy();
    // `Bearer` снимается один раз: двойной префикс — не тот токен.
    expect(authorized('Bearer Bearer секрет', 'секрет')).toBeFalsy();
  });
});
