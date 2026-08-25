import { expect, test } from 'vitest';
import { decodeBytes, encodeBytes, randomBytes } from './crypto';

/**
 * Обёртки и соли ездят через атомы ленда строками. Кодек обязан быть точным до
 * байта: потерянный при округлении длины хвост — это не «слегка испорченная
 * строка», а несходящийся ключ и недоступные данные.
 */

test('цикл байт → строка → байт точен на всех длинах до 64', () => {
  for (let length = 0; length <= 64; length++) {
    const source = randomBytes(length);
    expect(decodeBytes(encodeBytes(source))).toEqual(source);
  }
});

test('в строке нет символов, требующих экранирования в URL', () => {
  for (let run = 0; run < 100; run++) {
    const encoded = encodeBytes(randomBytes(32));
    expect(encoded).not.toMatch(/[+/=]/);
  }
});

test('крайние значения байтов переживают цикл', () => {
  const edges = new Uint8Array([0, 1, 127, 128, 254, 255]);
  expect(decodeBytes(encodeBytes(edges))).toEqual(edges);

  const all = new Uint8Array(256);
  for (let i = 0; i < 256; i++) all[i] = i;
  expect(decodeBytes(encodeBytes(all))).toEqual(all);
});

test('пустые байты дают пустую строку и обратно', () => {
  expect(encodeBytes(new Uint8Array(0))).toBe('');
  expect(decodeBytes('')).toEqual(new Uint8Array(0));
});
