import { describe, expect, it } from 'vitest';
import { NEAR_SHARE, budgetRows, budgetStatus, overBudgetCount, totalLimit } from './budget';
import type { Category } from './category';
import type { CategorySum } from './expense';

const FOOD: Category = { id: 'food', name: 'Продукты', colorKey: 'teal', limit: 1_000_000 };
const ROAD: Category = { id: 'road', name: 'Транспорт', colorKey: 'indigo', limit: 200_000 };
const FUN: Category = { id: 'fun', name: 'Развлечения', colorKey: 'rose' };

describe(budgetStatus, () => {
  it('no limit — no budget: no share, no remainder, no overspend', () => {
    const status = budgetStatus(500_000);
    expect(status.state).toBe('none');
    expect(status.share).toBe(0);
    expect(status.left).toBeUndefined();
    expect(status.limit).toBeUndefined();
  });

  it('zero and negative limits are also "not set", not an instant overspend', () => {
    expect(budgetStatus(1, 0).state).toBe('none');
    expect(budgetStatus(1, -100).state).toBe('none');
  });

  it('share and remainder are computed from the limit', () => {
    const status = budgetStatus(250_000, 1_000_000);
    expect(status.share).toBeCloseTo(0.25, 5);
    expect(status.left).toBe(750_000);
    expect(status.state).toBe('ok');
  });

  it('running low fires early, not together with the overspend', () => {
    expect(budgetStatus(849_999, 1_000_000).state).toBe('ok');
    expect(budgetStatus(NEAR_SHARE * 1_000_000, 1_000_000).state).toBe('near');
    expect(budgetStatus(1_000_000, 1_000_000).state).toBe('near');
  });

  it('exactly at the limit is not yet overspend, one kopeck more is', () => {
    expect(budgetStatus(1_000_000, 1_000_000).state).not.toBe('over');
    expect(budgetStatus(1_000_001, 1_000_000).state).toBe('over');
  });

  it('overspend shows as a share above one and a negative remainder', () => {
    const status = budgetStatus(1_500_000, 1_000_000);
    expect(status.share).toBeCloseTo(1.5, 5);
    expect(status.left).toBe(-500_000);
    expect(status.state).toBe('over');
  });

  it('untouched budget — zero, not division by nothing', () => {
    expect(budgetStatus(0, 1_000_000)).toMatchObject({ share: 0, left: 1_000_000, state: 'ok' });
  });
});

describe(budgetRows, () => {
  const sums: CategorySum[] = [
    { category: 'food', total: 900_000, count: 12 },
    { category: 'road', total: 250_000, count: 8 },
    { category: 'fun', total: 400_000, count: 3 },
    { total: 100_000, count: 1 },
  ];

  it('categories without a limit do not enter the budgets', () => {
    expect(budgetRows([FOOD, ROAD, FUN], sums).map(row => row.category.id)).toEqual(['road', 'food']);
  });

  it('closer to the edge — higher: overspend is visible without scrolling', () => {
    const rows = budgetRows([FOOD, ROAD], sums);
    expect(rows[0]?.status.state).toBe('over');
    expect(rows[1]?.status.state).toBe('near');
  });

  it('category without expenses — an untouched budget, not a skipped row', () => {
    const rows = budgetRows([FOOD, ROAD], []);
    expect(rows).toHaveLength(2);
    expect(rows.every(row => row.status.spent === 0)).toBeTruthy();
  });

  it('with equal shares the order is stable — by name', () => {
    const rows = budgetRows([ROAD, FOOD], []);
    expect(rows.map(row => row.category.name)).toEqual(['Продукты', 'Транспорт']);
  });

  it('no categories and no expenses — empty summary', () => {
    expect(budgetRows([], [])).toEqual([]);
  });
});

describe(overBudgetCount, () => {
  it('counts only exceeded budgets', () => {
    const rows = budgetRows([FOOD, ROAD], [
      { category: 'food', total: 900_000, count: 1 },
      { category: 'road', total: 250_000, count: 1 },
    ]);
    expect(overBudgetCount(rows)).toBe(1);
    expect(overBudgetCount([])).toBe(0);
  });
});

describe(totalLimit, () => {
  it('sum of limits — the total allowed for the month', () => {
    expect(totalLimit(budgetRows([FOOD, ROAD], []))).toBe(1_200_000);
    expect(totalLimit([])).toBe(0);
  });
});
