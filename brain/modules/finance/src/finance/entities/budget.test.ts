import { describe, expect, it } from 'vitest';
import { NEAR_SHARE, budgetRows, budgetStatus, overBudgetCount, totalLimit } from './budget';
import type { Category } from './category';
import type { CategorySum } from './expense';

const FOOD: Category = { id: 'food', name: 'Продукты', colorKey: 'teal', limit: 1_000_000 };
const ROAD: Category = { id: 'road', name: 'Транспорт', colorKey: 'indigo', limit: 200_000 };
const FUN: Category = { id: 'fun', name: 'Развлечения', colorKey: 'rose' };

describe(budgetStatus, () => {
  it('без лимита бюджета нет: ни доли, ни остатка, ни перерасхода', () => {
    const status = budgetStatus(500_000);
    expect(status.state).toBe('none');
    expect(status.share).toBe(0);
    expect(status.left).toBeUndefined();
    expect(status.limit).toBeUndefined();
  });

  it('нулевой и отрицательный лимит — тоже «не задан», а не мгновенный перерасход', () => {
    expect(budgetStatus(1, 0).state).toBe('none');
    expect(budgetStatus(1, -100).state).toBe('none');
  });

  it('доля и остаток считаются от лимита', () => {
    const status = budgetStatus(250_000, 1_000_000);
    expect(status.share).toBeCloseTo(0.25, 5);
    expect(status.left).toBe(750_000);
    expect(status.state).toBe('ok');
  });

  it('на исходе — заранее, а не вместе с превышением', () => {
    expect(budgetStatus(849_999, 1_000_000).state).toBe('ok');
    expect(budgetStatus(NEAR_SHARE * 1_000_000, 1_000_000).state).toBe('near');
    expect(budgetStatus(1_000_000, 1_000_000).state).toBe('near');
  });

  it('ровно по лимиту — ещё не перерасход, копейкой больше — уже', () => {
    expect(budgetStatus(1_000_000, 1_000_000).state).not.toBe('over');
    expect(budgetStatus(1_000_001, 1_000_000).state).toBe('over');
  });

  it('перерасход показывается долей больше единицы и отрицательным остатком', () => {
    const status = budgetStatus(1_500_000, 1_000_000);
    expect(status.share).toBeCloseTo(1.5, 5);
    expect(status.left).toBe(-500_000);
    expect(status.state).toBe('over');
  });

  it('нетронутый бюджет — ноль, а не деление на пустоту', () => {
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

  it('категории без лимита в бюджеты не попадают', () => {
    expect(budgetRows([FOOD, ROAD, FUN], sums).map(row => row.category.id)).toEqual(['road', 'food']);
  });

  it('ближе к краю — выше: перерасход виден без прокрутки', () => {
    const rows = budgetRows([FOOD, ROAD], sums);
    expect(rows[0]?.status.state).toBe('over');
    expect(rows[1]?.status.state).toBe('near');
  });

  it('категория без трат — нетронутый бюджет, а не пропущенная строка', () => {
    const rows = budgetRows([FOOD, ROAD], []);
    expect(rows).toHaveLength(2);
    expect(rows.every(row => row.status.spent === 0)).toBeTruthy();
  });

  it('при равных долях порядок устойчив — по имени', () => {
    const rows = budgetRows([ROAD, FOOD], []);
    expect(rows.map(row => row.category.name)).toEqual(['Продукты', 'Транспорт']);
  });

  it('без категорий и без трат — пустая сводка', () => {
    expect(budgetRows([], [])).toEqual([]);
  });
});

describe(overBudgetCount, () => {
  it('считает только превышенные бюджеты', () => {
    const rows = budgetRows([FOOD, ROAD], [
      { category: 'food', total: 900_000, count: 1 },
      { category: 'road', total: 250_000, count: 1 },
    ]);
    expect(overBudgetCount(rows)).toBe(1);
    expect(overBudgetCount([])).toBe(0);
  });
});

describe(totalLimit, () => {
  it('сумма лимитов — сколько всего разрешено себе за месяц', () => {
    expect(totalLimit(budgetRows([FOOD, ROAD], []))).toBe(1_200_000);
    expect(totalLimit([])).toBe(0);
  });
});
