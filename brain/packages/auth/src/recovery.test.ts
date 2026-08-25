import { expect, test } from 'vitest';
import {
  PHRASE_LENGTH,
  WORDS,
  createPhrase,
  isKnownPhrase,
  normalizePhrase,
  quizIndexes,
} from './recovery';

test('Dictionary is exactly 256 words without duplicates', () => {
  // Степень двойки: каждое слово несёт целые 8 бит, и выборка из случайного
  // байта равномерна без отбраковки.
  expect(WORDS).toHaveLength(256);
  expect(new Set(WORDS).size).toBe(256);
});

test('Dictionary has no «ё» and no Latin letters', () => {
  // «ё» пользователь напишет как «е» — и не попадёт в словарь.
  expect(WORDS.filter(word => word.includes('ё'))).toEqual([]);
  expect(WORDS.filter(word => /[a-z]/u.test(word))).toEqual([]);
});

test('No two words differ by a single letter', () => {
  // Обещание из комментария к словарю: описка в одной букве не должна
  // превращать слово в другое слово того же словаря.
  const clashes: string[] = [];
  for (let i = 0; i < WORDS.length; i++) {
    for (let j = i + 1; j < WORDS.length; j++) {
      if (differsByOne(WORDS[i]!, WORDS[j]!)) clashes.push(`${WORDS[i]}/${WORDS[j]}`);
    }
  }
  expect(clashes).toEqual([]);
});

test('Phrase is twelve words from the dictionary', () => {
  const phrase = createPhrase();
  expect(phrase).toHaveLength(PHRASE_LENGTH);
  expect(phrase.every(word => WORDS.includes(word))).toBeTruthy();
  expect(isKnownPhrase(phrase)).toBeTruthy();
});

test('Two consecutive phrases do not match', () => {
  // 96 бит энтропии: совпадение означало бы, что источник случайности сломан.
  expect(createPhrase().join(' ')).not.toBe(createPhrase().join(' '));
});

test('Normalization forgives case, extra spaces, and «ё»', () => {
  expect(normalizePhrase('  Астра   БЕРЕГ  вилка ')).toBe('астра берег вилка');
  expect(normalizePhrase(['Ёлка', 'астра'])).toBe('елка астра');
});

test('A foreign or incomplete phrase is detected before the expensive KDF', () => {
  const phrase = createPhrase();
  expect(isKnownPhrase(phrase.slice(0, 11))).toBeFalsy();
  expect(isKnownPhrase([...phrase.slice(0, 11), 'абракадабра'])).toBeFalsy();
  expect(isKnownPhrase(phrase.join('  ').toUpperCase())).toBeTruthy();
});

test('Check indices are distinct and within phrase bounds', () => {
  for (let run = 0; run < 50; run++) {
    const indexes = quizIndexes(2);
    expect(indexes).toHaveLength(2);
    expect(new Set(indexes).size).toBe(2);
    expect(indexes.every(index => index >= 0 && index < PHRASE_LENGTH)).toBeTruthy();
  }
});

test('Requesting more indices than there are words does not loop forever', () => {
  expect(quizIndexes(99, 4)).toEqual([0, 1, 2, 3]);
});

function differsByOne(a: string, b: string): boolean {
  if (a === b) return false;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    let diff = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
    return diff === 1;
  }
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  for (let i = 0; i < long.length; i++) {
    if (long.slice(0, i) + long.slice(i + 1) === short) return true;
  }
  return false;
}
