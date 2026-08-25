import { expect, test } from 'vitest';
import { Link } from '@sync/core';
import { devicePeer, landBytes, landId } from './land';

/**
 * Адрес ленда — обещание на все устройства и все запуски сразу. Тесты здесь
 * стерегут именно ЭТО: не «функция работает», а «байты те же самые».
 */

test('адрес ленда kcal совпадает с тем, с которым дневник уже живёт', () => {
  // Ровно те байты, что зашиты в kcal/src/db/space.ts: «kcal» по кругу до
  // восьми. Разойдись они — переезд дневника стал бы переливкой данных.
  const expected = new Uint8Array([0x6B, 0x63, 0x61, 0x6C, 0x6B, 0x63, 0x61, 0x6C]);
  expect(landBytes('kcal')).toEqual(expected);

  const legacy = Link.land(Link.peer(expected), new Uint8Array(8));
  expect(landId('kcal').str).toBe(legacy.str);
});

test('имя короче восьми повторяется по кругу, длиннее — обрезается', () => {
  expect(new TextDecoder().decode(landBytes('notes'))).toBe('notesnot');
  expect(new TextDecoder().decode(landBytes('a'))).toBe('aaaaaaaa');
  expect(new TextDecoder().decode(landBytes('bookmarks'))).toBe('bookmark');
});

test('адрес детерминирован: два вызова дают одни байты', () => {
  expect(landId('notes').str).toBe(landId('notes').str);
  expect(landId('notes').str).not.toBe(landId('tasks').str);
});

test('период имени даёт столкновение — оно ловится реестром, но начинается здесь', () => {
  // Документируем цену схемы: обрезка до восьми байт делает эти имена
  // неразличимыми. Проверка набора живёт в createRegistry.
  expect(landId('ab').str).toBe(landId('abab').str);
});

test('не-ASCII и пустое имя отвергаются', () => {
  expect(() => landBytes('заметки')).toThrow(/не ASCII/);
  expect(() => landBytes('')).toThrow(/пуст/);
});

test('пир устройства чеканится один раз и переживает перезапуск', () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
  };

  const first = devicePeer(storage);
  expect(devicePeer(storage).str).toBe(first.str);

  // Битое значение не роняет запуск: пир не данные, терять нечего.
  store.set('brain.peer', 'не ссылка');
  const reminted = devicePeer(storage);
  expect(reminted.str).not.toBe('не ссылка');
  expect(devicePeer(storage).str).toBe(reminted.str);
});
