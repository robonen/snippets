import { expect, test } from 'vitest';
import { decodeBytes, encodeBytes, randomBytes } from './crypto';

/**
 * Обёртки и соли ездят через атомы ленда строками. Кодек обязан быть точным до
 * байта: потерянный при округлении длины хвост — это не «слегка испорченная
 * строка», а несходящийся ключ и недоступные данные.
 */

test('Bytes → string → bytes round trip is exact for all lengths up to 64', () => {
  for (let length = 0; length <= 64; length++) {
    const source = randomBytes(length);
    expect(decodeBytes(encodeBytes(source))).toEqual(source);
  }
});

test('String contains no characters that need URL escaping', () => {
  for (let run = 0; run < 100; run++) {
    const encoded = encodeBytes(randomBytes(32));
    expect(encoded).not.toMatch(/[+/=]/);
  }
});

test('Extreme byte values survive the round trip', () => {
  const edges = new Uint8Array([0, 1, 127, 128, 254, 255]);
  expect(decodeBytes(encodeBytes(edges))).toEqual(edges);

  const all = new Uint8Array(256);
  for (let i = 0; i < 256; i++) all[i] = i;
  expect(decodeBytes(encodeBytes(all))).toEqual(all);
});

test('Empty bytes yield an empty string and back', () => {
  expect(encodeBytes(new Uint8Array(0))).toBe('');
  expect(decodeBytes('')).toEqual(new Uint8Array(0));
});
