import { describe, expect, test } from 'vitest';
import { randomBytes } from './crypto';
import { packWrap, unpackWrap } from './wire';
import type { WrappedDek } from './crypto';

/**
 * Провод обёртки — то, что реально уезжает в теле `PUT /account/wraps`
 * (docs/04-server.md «Аккаунт и вход»). Сервер эти байты не разбирает
 * (план Р5), поэтому цикл «упаковать → распаковать» обязан быть точным сам по
 * себе — здесь и только здесь его проверить.
 */

const wrap = (patch: Partial<WrappedDek> = {}): WrappedDek => ({
  kind: 'passkey',
  label: 'passkey',
  salt: randomBytes(16),
  nonce: randomBytes(12),
  cipher: randomBytes(48), // 32 байта DEK + 16 байт метки GCM
  ...patch,
});

describe('packWrap/unpackWrap', () => {
  test('цикл точен на реальных размерах (соль 16, нонс 12, шифртекст 48)', () => {
    const source = wrap();
    const blob = packWrap(source);
    const back = unpackWrap({ kind: source.kind, label: source.label }, blob);
    expect(back).toEqual(source);
  });

  test('пустая соль — как у обёртки ключа устройства (хотя её на сервер не отправляют)', () => {
    const source = wrap({ salt: new Uint8Array(0) });
    const back = unpackWrap({ kind: source.kind, label: source.label }, packWrap(source));
    expect(back.salt).toEqual(new Uint8Array(0));
  });

  test('разные соль/нонс/шифртекст не перепутываются местами', () => {
    const source = wrap({
      salt: new Uint8Array([1, 1, 1]),
      nonce: new Uint8Array([2, 2]),
      cipher: new Uint8Array([3, 3, 3, 3]),
    });
    const back = unpackWrap({ kind: source.kind, label: source.label }, packWrap(source));
    expect(back.salt).toEqual(new Uint8Array([1, 1, 1]));
    expect(back.nonce).toEqual(new Uint8Array([2, 2]));
    expect(back.cipher).toEqual(new Uint8Array([3, 3, 3, 3]));
  });

  test('kind и label в блобе не участвуют — приходят от вызывающего заново', () => {
    const source = wrap({ kind: 'passphrase', label: 'фраза' });
    const blob = packWrap(source);
    // Тот же блоб, но с ДРУГОЙ меткой/видом — распаковка не спорит: она не
    // хранит kind/label внутри, ей и подделывать нечего на этом уровне.
    const relabelled = unpackWrap({ kind: 'passkey', label: 'другая метка' }, blob);
    expect(relabelled.kind).toBe('passkey');
    expect(relabelled.label).toBe('другая метка');
    expect(relabelled.salt).toEqual(source.salt);
  });

  test('обрубленный блоб (нет длины соли) — бросает, не падает молча', () => {
    expect(() => unpackWrap({ kind: 'passkey', label: 'x' }, new Uint8Array(0))).toThrow();
  });

  test('обрубленный блоб (соль есть, длины нонса нет) — бросает', () => {
    const blob = new Uint8Array([2, 9, 9]); // saltLen=2, соль есть, а дальше пусто
    expect(() => unpackWrap({ kind: 'passkey', label: 'x' }, blob)).toThrow();
  });

  test('обрубленный блоб (нонс неполный) — бросает', () => {
    const blob = new Uint8Array([0, 5, 1, 2]); // saltLen=0, nonceLen=5, но байт только 2
    expect(() => unpackWrap({ kind: 'passkey', label: 'x' }, blob)).toThrow();
  });

  test('блоб без шифртекста (только соль и нонс) — бросает: обёртка без секрета бессмысленна', () => {
    const blob = new Uint8Array([0, 0]); // saltLen=0, nonceLen=0, шифртекста нет
    expect(() => unpackWrap({ kind: 'passkey', label: 'x' }, blob)).toThrow();
  });

  test('поле длиннее 255 байт не упаковывается', () => {
    const source = wrap({ salt: randomBytes(256) });
    expect(() => packWrap(source)).toThrow();
  });
});
