import { describe, expect, it } from 'vitest';
import { dayTitle, lastDays, shiftISODate, toISODate } from './dates';

describe(toISODate, () => {
  it('Local date without a UTC shift', () => {
    expect(toISODate(new Date(2026, 7, 7))).toBe('2026-08-07');
    expect(toISODate(new Date(2026, 0, 1, 0, 30))).toBe('2026-01-01');
  });
});

describe(shiftISODate, () => {
  it('Crossing month and year boundaries', () => {
    expect(shiftISODate('2026-08-01', -1)).toBe('2026-07-31');
    expect(shiftISODate('2025-12-31', 1)).toBe('2026-01-01');
    expect(shiftISODate('2026-08-07', 0)).toBe('2026-08-07');
  });

  it('Leap-year February', () => {
    expect(shiftISODate('2028-02-28', 1)).toBe('2028-02-29');
  });
});

describe(dayTitle, () => {
  const today = '2026-08-07';

  it('Relative days', () => {
    expect(dayTitle('2026-08-07', today)).toBe('Сегодня');
    expect(dayTitle('2026-08-06', today)).toBe('Вчера');
    expect(dayTitle('2026-08-08', today)).toBe('Завтра');
  });

  it('Distant days — weekday and date in Russian', () => {
    expect(dayTitle('2026-08-01', today)).toMatch(/1 августа/);
  });
});

describe(lastDays, () => {
  it('Last N days in ascending order, including today', () => {
    expect(lastDays(3, '2026-08-07')).toEqual(['2026-08-05', '2026-08-06', '2026-08-07']);
  });
});
