import { describe, expect, it } from 'vitest';
import {
  currentMonth,
  currentYear,
  daysInMonth,
  monthOf,
  monthShort,
  monthTitle,
  monthsOfYear,
  shiftMonth,
  shiftYear,
  yearOf,
} from './month';

describe(monthOf, () => {
  it('месяц дня — первые семь символов канонической даты', () => {
    expect(monthOf('2026-08-24')).toBe('2026-08');
    expect(currentMonth('2026-01-01')).toBe('2026-01');
  });
});

describe(shiftMonth, () => {
  it('листание через границу года не роняет год', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-08', 0)).toBe('2026-08');
  });

  it('шаг на несколько месяцев считается как один переход', () => {
    expect(shiftMonth('2026-08', 6)).toBe('2027-02');
    expect(shiftMonth('2026-03', -14)).toBe('2025-01');
  });
});

describe(monthTitle, () => {
  it('месяц в именительном падеже: «август», а не «августа»', () => {
    expect(monthTitle('2026-08')).toBe('август 2026');
  });

  it('короткая подпись — для двенадцати столбиков в ряд', () => {
    // Точка сокращения снимается: в ряду из двенадцати подписей она только
    // съедает место.
    expect(monthShort('2026-08')).toBe('авг');
    expect(monthShort('2026-05')).toBe('май');
  });
});

describe(daysInMonth, () => {
  it('длина месяца известна вплоть до високосного февраля', () => {
    expect(daysInMonth('2026-01')).toBe(31);
    expect(daysInMonth('2026-04')).toBe(30);
    expect(daysInMonth('2026-02')).toBe(28);
    expect(daysInMonth('2028-02')).toBe(29);
    // Столетие делится на 400 — 2000-й високосный, 1900-й нет.
    expect(daysInMonth('2000-02')).toBe(29);
    expect(daysInMonth('1900-02')).toBe(28);
  });
});

describe(yearOf, () => {
  it('год месяца и год дня — первые четыре символа', () => {
    expect(yearOf('2026-08')).toBe('2026');
    expect(currentYear('2026-01-01')).toBe('2026');
  });
});

describe(monthsOfYear, () => {
  it('двенадцать месяцев по порядку, с ведущим нулём', () => {
    const months = monthsOfYear('2026');
    expect(months).toHaveLength(12);
    expect(months[0]).toBe('2026-01');
    expect(months[8]).toBe('2026-09');
    expect(months.at(-1)).toBe('2026-12');
  });
});

describe(shiftYear, () => {
  it('листание годов не роняет форму строки', () => {
    expect(shiftYear('2026', 1)).toBe('2027');
    expect(shiftYear('2026', -1)).toBe('2025');
    expect(shiftYear('2026', 0)).toBe('2026');
  });
});
