import { expect, test } from 'vitest';
import {
  PHRASE_LENGTH,
  WORDS,
  createPhrase,
  isKnownPhrase,
  normalizePhrase,
  quizIndexes,
} from './recovery';

test('словарь — ровно 256 слов без повторов', () => {
  // Степень двойки: каждое слово несёт целые 8 бит, и выборка из случайного
  // байта равномерна без отбраковки.
  expect(WORDS).toHaveLength(256);
  expect(new Set(WORDS).size).toBe(256);
});

test('в словаре нет «ё» и нет латиницы', () => {
  // «ё» пользователь напишет как «е» — и не попадёт в словарь.
  expect(WORDS.filter(word => word.includes('ё'))).toEqual([]);
  expect(WORDS.filter(word => /[a-z]/u.test(word))).toEqual([]);
});

test('никакие два слова не различаются одной буквой', () => {
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

test('фраза — двенадцать слов из словаря', () => {
  const phrase = createPhrase();
  expect(phrase).toHaveLength(PHRASE_LENGTH);
  expect(phrase.every(word => WORDS.includes(word))).toBeTruthy();
  expect(isKnownPhrase(phrase)).toBeTruthy();
});

test('две фразы подряд не совпадают', () => {
  // 96 бит энтропии: совпадение означало бы, что источник случайности сломан.
  expect(createPhrase().join(' ')).not.toBe(createPhrase().join(' '));
});

test('нормализация прощает регистр, лишние пробелы и «ё»', () => {
  expect(normalizePhrase('  Астра   БЕРЕГ  вилка ')).toBe('астра берег вилка');
  expect(normalizePhrase(['Ёлка', 'астра'])).toBe('елка астра');
});

test('чужая или неполная фраза распознаётся до дорогого KDF', () => {
  const phrase = createPhrase();
  expect(isKnownPhrase(phrase.slice(0, 11))).toBeFalsy();
  expect(isKnownPhrase([...phrase.slice(0, 11), 'абракадабра'])).toBeFalsy();
  expect(isKnownPhrase(phrase.join('  ').toUpperCase())).toBeTruthy();
});

test('проверочные индексы различны и лежат в границах фразы', () => {
  for (let run = 0; run < 50; run++) {
    const indexes = quizIndexes(2);
    expect(indexes).toHaveLength(2);
    expect(new Set(indexes).size).toBe(2);
    expect(indexes.every(index => index >= 0 && index < PHRASE_LENGTH)).toBeTruthy();
  }
});

test('запрос большего числа индексов, чем слов, не зацикливается', () => {
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
