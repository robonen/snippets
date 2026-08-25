import { describe, expect, it } from 'vitest';
import { estimateMinutes, formatMinutes, readingLabel, readingWeight, totalMinutes } from './reading';

/** Неразрывный пробел: число и единица не разрываются переносом строки. */
const NBSP = ' ';

describe(readingWeight, () => {
  it('заметка весит вдвое против заголовка', () => {
    expect(readingWeight({ title: 'раз два три' })).toBe(3);
    expect(readingWeight({ title: 'раз два три', note: 'четыре пять' })).toBe(7);
  });

  it('пустые строки слов не добавляют', () => {
    expect(readingWeight({ title: '', note: '   ' })).toBe(0);
    expect(readingWeight({ title: 'один' })).toBe(1);
  });

  it('лишние пробелы и переводы строк слов не удваивают', () => {
    expect(readingWeight({ title: '  раз   два \n три ' })).toBe(3);
  });
});

describe(estimateMinutes, () => {
  it('короткий заголовок без заметки — нижняя ступень', () => {
    expect(estimateMinutes({ title: 'CRDT без слёз' })).toBe(2);
  });

  it('оценка растёт ступенями, а не непрерывно: «7 минут» обещало бы измерение', () => {
    expect(estimateMinutes({ title: words(5) })).toBe(5);
    expect(estimateMinutes({ title: words(11) })).toBe(10);
    expect(estimateMinutes({ title: words(21) })).toBe(20);
    expect(estimateMinutes({ title: words(37) })).toBe(30);
  });

  it('границы ступеней включают верхнее значение', () => {
    expect(estimateMinutes({ title: words(4) })).toBe(2);
    expect(estimateMinutes({ title: words(10) })).toBe(5);
    expect(estimateMinutes({ title: words(20) })).toBe(10);
    expect(estimateMinutes({ title: words(36) })).toBe(20);
  });

  it('оценка не убывает от добавленной заметки', () => {
    const bare = estimateMinutes({ title: words(3) });
    expect(estimateMinutes({ title: words(3), note: words(4) })).toBeGreaterThan(bare);
  });

  it('самая длинная очередь всё равно ограничена сверху: точнее не знаем', () => {
    expect(estimateMinutes({ title: words(500), note: words(500) })).toBe(30);
  });
});

describe(totalMinutes, () => {
  it('очередь складывается из оценок, пустая — ноль', () => {
    expect(totalMinutes([{ title: words(1) }, { title: words(5) }])).toBe(7);
    expect(totalMinutes([])).toBe(0);
  });
});

describe(formatMinutes, () => {
  it('меньше часа печатается минутами', () => {
    expect(formatMinutes(5)).toBe(`5${NBSP}мин`);
    expect(formatMinutes(59)).toBe(`59${NBSP}мин`);
    expect(formatMinutes(0)).toBe(`0${NBSP}мин`);
  });

  it('часы появляются только когда они есть: «0 ч 5 мин» ничего не добавляет', () => {
    expect(formatMinutes(60)).toBe(`1${NBSP}ч`);
    expect(formatMinutes(120)).toBe(`2${NBSP}ч`);
    expect(formatMinutes(75)).toBe(`1${NBSP}ч${NBSP}15${NBSP}мин`);
  });

  it('отрицательного времени чтения не бывает', () => {
    expect(formatMinutes(-10)).toBe(`0${NBSP}мин`);
  });
});

describe(readingLabel, () => {
  it('подпись помечена тильдой: это прикидка, а не измерение', () => {
    expect(readingLabel({ title: 'CRDT без слёз' })).toBe(`≈${NBSP}2${NBSP}мин`);
  });
});

/** Строка ровно из `count` слов — вес считается по ним, а не по символам. */
function words(count: number): string {
  return Array.from({ length: count }, (_, index) => `с${index}`).join(' ');
}
