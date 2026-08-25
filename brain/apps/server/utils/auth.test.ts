import { describe, expect, it } from 'vitest';
import { authorized } from './auth';

describe(authorized, () => {
  it('empty secret rejects EVERYONE, including an empty header', () => {
    expect(authorized('что угодно', '')).toBeFalsy();
    expect(authorized('Bearer что угодно', '')).toBeFalsy();
    expect(authorized('', '')).toBeFalsy();
    expect(authorized(undefined, '')).toBeFalsy();
    expect(authorized(null, '')).toBeFalsy();
  });

  it('accepts the correct token both with and without the Bearer prefix', () => {
    expect(authorized('секрет', 'секрет')).toBeTruthy();
    expect(authorized('Bearer секрет', 'секрет')).toBeTruthy();
  });

  it('rejects a foreign token, a missing header, and a substring of the correct one', () => {
    expect(authorized('другой', 'секрет')).toBeFalsy();
    expect(authorized('секре', 'секрет')).toBeFalsy();
    expect(authorized('секрет ', 'секрет')).toBeFalsy();
    expect(authorized(undefined, 'секрет')).toBeFalsy();
    expect(authorized(null, 'секрет')).toBeFalsy();
    // `Bearer` снимается один раз: двойной префикс — не тот токен.
    expect(authorized('Bearer Bearer секрет', 'секрет')).toBeFalsy();
  });
});
