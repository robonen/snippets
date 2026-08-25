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
  it('month of a day — the first seven characters of the canonical date', () => {
    expect(monthOf('2026-08-24')).toBe('2026-08');
    expect(currentMonth('2026-01-01')).toBe('2026-01');
  });
});

describe(shiftMonth, () => {
  it('paging across the year boundary does not break the year', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-08', 0)).toBe('2026-08');
  });

  it('a step of several months counts as one transition', () => {
    expect(shiftMonth('2026-08', 6)).toBe('2027-02');
    expect(shiftMonth('2026-03', -14)).toBe('2025-01');
  });
});

describe(monthTitle, () => {
  it('month in the nominative case: "август", not "августа"', () => {
    expect(monthTitle('2026-08')).toBe('август 2026');
  });

  it('short label — for twelve bars in a row', () => {
    // Точка сокращения снимается: в ряду из двенадцати подписей она только
    // съедает место.
    expect(monthShort('2026-08')).toBe('авг');
    expect(monthShort('2026-05')).toBe('май');
  });
});

describe(daysInMonth, () => {
  it('month length is known down to leap February', () => {
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
  it('year of a month and year of a day — the first four characters', () => {
    expect(yearOf('2026-08')).toBe('2026');
    expect(currentYear('2026-01-01')).toBe('2026');
  });
});

describe(monthsOfYear, () => {
  it('twelve months in order, zero-padded', () => {
    const months = monthsOfYear('2026');
    expect(months).toHaveLength(12);
    expect(months[0]).toBe('2026-01');
    expect(months[8]).toBe('2026-09');
    expect(months.at(-1)).toBe('2026-12');
  });
});

describe(shiftYear, () => {
  it('paging years does not break the string format', () => {
    expect(shiftYear('2026', 1)).toBe('2027');
    expect(shiftYear('2026', -1)).toBe('2025');
    expect(shiftYear('2026', 0)).toBe('2026');
  });
});
