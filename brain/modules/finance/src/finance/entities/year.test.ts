import { describe, expect, it } from 'vitest';
import { chartMax, compareTotals, monthlyTotals, yearStats } from './year';
import type { Expense } from './expense';

function expense(id: string, amount: number, date: string): Expense {
  return { id, amount, date, createdAt: Number(id) };
}

const EXPENSES: Expense[] = [
  expense('1', 25_000, '2026-01-15'),
  expense('2', 125_050, '2026-01-31'),
  expense('3', 6000, '2026-03-02'),
  expense('4', 40_000, '2026-12-05'),
  expense('5', 10_000, '2025-12-31'),
];

describe(monthlyTotals, () => {
  const totals = monthlyTotals(EXPENSES, '2026');

  it('месяцев ровно двенадцать, по порядку — пустые тоже', () => {
    expect(totals).toHaveLength(12);
    expect(totals[0]?.month).toBe('2026-01');
    expect(totals.at(-1)?.month).toBe('2026-12');
  });

  it('суммы и счётчики раскладываются по своим месяцам', () => {
    expect(totals[0]).toEqual({ month: '2026-01', total: 150_050, count: 2 });
    expect(totals[2]).toEqual({ month: '2026-03', total: 6000, count: 1 });
    expect(totals[11]).toEqual({ month: '2026-12', total: 40_000, count: 1 });
  });

  it('пустой месяц — ноль с нулём записей, а не пропуск в ряду', () => {
    expect(totals[1]).toEqual({ month: '2026-02', total: 0, count: 0 });
  });

  it('чужой год в обзор не попадает', () => {
    expect(totals.reduce((sum, item) => sum + item.total, 0)).toBe(196_050);
    expect(monthlyTotals(EXPENSES, '2025')[11]).toEqual({ month: '2025-12', total: 10_000, count: 1 });
  });
});

describe(yearStats, () => {
  it('среднее считается по месяцам С ТРАТАМИ, а не по всем двенадцати', () => {
    const stats = yearStats(monthlyTotals(EXPENSES, '2026'));
    expect(stats.total).toBe(196_050);
    expect(stats.tracked).toBe(3);
    expect(stats.average).toBe(65_350);
  });

  it('самый дорогой месяц находится', () => {
    expect(yearStats(monthlyTotals(EXPENSES, '2026')).peak?.month).toBe('2026-01');
  });

  it('пустой год — нули без деления на ноль и без выдуманного пика', () => {
    const stats = yearStats(monthlyTotals([], '2026'));
    expect(stats).toMatchObject({ total: 0, tracked: 0, average: 0 });
    expect(stats.peak).toBeUndefined();
  });

  it('среднее — целые копейки: половинки копейки не бывает', () => {
    const stats = yearStats([
      { month: '2026-01', total: 100, count: 1 },
      { month: '2026-02', total: 101, count: 1 },
    ]);
    expect(Number.isInteger(stats.average)).toBeTruthy();
    expect(stats.average).toBe(101);
  });
});

describe(compareTotals, () => {
  it('рост, спад и «столько же» различаются направлением', () => {
    expect(compareTotals(120, 100)).toMatchObject({ delta: 20, direction: 'up' });
    expect(compareTotals(80, 100)).toMatchObject({ delta: -20, direction: 'down' });
    expect(compareTotals(100, 100)).toMatchObject({ delta: 0, direction: 'flat' });
  });

  it('доля считается от прошлого месяца', () => {
    expect(compareTotals(150, 100).share).toBeCloseTo(0.5, 5);
    expect(compareTotals(50, 100).share).toBeCloseTo(-0.5, 5);
  });

  it('пустой прошлый месяц сравнивать не с чем: доля null, а не бесконечность', () => {
    expect(compareTotals(100, 0)).toMatchObject({ delta: 100, share: null, direction: 'up' });
    expect(compareTotals(0, 0)).toMatchObject({ delta: 0, share: null, direction: 'flat' });
  });
});

describe(chartMax, () => {
  it('верх шкалы — самый дорогой месяц', () => {
    expect(chartMax(monthlyTotals(EXPENSES, '2026'))).toBe(150_050);
  });

  it('пустой год не даёт нулевой шкалы: на ней любой столбик был бы во всю высоту', () => {
    expect(chartMax(monthlyTotals([], '2026'))).toBe(1);
    expect(chartMax([])).toBe(1);
  });
});
