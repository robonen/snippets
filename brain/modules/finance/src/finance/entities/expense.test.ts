import { describe, expect, it } from 'vitest';
import { groupByDay, inMonth, matchesQuery, shareOf, sumAmount, sumByCategory } from './expense';
import type { Expense } from './expense';

function expense(id: string, amount: number, date: string, extra: Partial<Expense> = {}): Expense {
  return { id, amount, date, createdAt: Number(id), ...extra };
}

/** Три дня августа, две категории и одна трата без категории. */
const EXPENSES: Expense[] = [
  expense('1', 25_000, '2026-08-01', { category: 'food', note: 'кофе' }),
  expense('2', 125_050, '2026-08-01', { category: 'food', note: 'продукты' }),
  expense('3', 6000, '2026-08-02', { category: 'road', note: 'метро' }),
  expense('4', 40_000, '2026-08-05', { note: 'подарок' }),
  expense('5', 10_000, '2026-07-31', { category: 'food', note: 'кофе' }),
];

describe(sumAmount, () => {
  it('сумма считается в копейках и не теряет их', () => {
    expect(sumAmount(EXPENSES)).toBe(206_050);
    expect(sumAmount([])).toBe(0);
  });
});

describe(inMonth, () => {
  it('месяц отсекает соседний день, а не соседнюю неделю', () => {
    expect(inMonth(EXPENSES, '2026-08').map(item => item.id)).toEqual(['1', '2', '3', '4']);
    expect(inMonth(EXPENSES, '2026-07').map(item => item.id)).toEqual(['5']);
    expect(inMonth(EXPENSES, '2026-09')).toEqual([]);
  });
});

describe(groupByDay, () => {
  const days = groupByDay(inMonth(EXPENSES, '2026-08'));

  it('дни идут свежими сверху', () => {
    expect(days.map(day => day.date)).toEqual(['2026-08-05', '2026-08-02', '2026-08-01']);
  });

  it('сумма дня равна сумме его трат', () => {
    expect(days.map(day => day.total)).toEqual([40_000, 6000, 150_050]);
    expect(sumAmount(days.flatMap(day => day.items))).toBe(sumAmount(inMonth(EXPENSES, '2026-08')));
  });

  it('внутри дня поздняя запись сверху: только что введённую ищут первой', () => {
    expect(days.at(-1)?.items.map(item => item.id)).toEqual(['2', '1']);
  });

  it('пустой список — пустая группировка, а не день с нулём', () => {
    expect(groupByDay([])).toEqual([]);
  });
});

describe(sumByCategory, () => {
  const sums = sumByCategory(inMonth(EXPENSES, '2026-08'));

  it('суммы и счётчики по категориям, крупные сверху', () => {
    expect(sums).toEqual([
      { category: 'food', total: 150_050, count: 2 },
      { total: 40_000, count: 1 },
      { category: 'road', total: 6000, count: 1 },
    ]);
  });

  it('трата без категории — такая же строка: иначе сводка не сходится с итогом', () => {
    expect(sums.find(sum => sum.category === undefined)?.total).toBe(40_000);
    expect(sums.reduce((acc, sum) => acc + sum.total, 0)).toBe(sumAmount(inMonth(EXPENSES, '2026-08')));
  });

  it('при равных суммах порядок устойчив: строки не прыгают на перерисовке', () => {
    const tied = [
      expense('1', 1000, '2026-08-01', { category: 'b' }),
      expense('2', 1000, '2026-08-01', { category: 'a' }),
    ];
    expect(sumByCategory(tied).map(sum => sum.category)).toEqual(['a', 'b']);
  });

  it('пустой список — пустая сводка', () => {
    expect(sumByCategory([])).toEqual([]);
  });
});

describe(shareOf, () => {
  it('доля от нуля — ноль, а не NaN', () => {
    expect(shareOf(0, 0)).toBe(0);
    expect(shareOf(150_050, 196_050)).toBeCloseTo(0.765, 3);
  });
});

describe(matchesQuery, () => {
  const item = expense('1', 25_000, '2026-08-01', { category: 'food', note: 'Кофе с молоком' });

  it('ищет по описанию и по имени категории, без учёта регистра', () => {
    expect(matchesQuery(item, 'кофе')).toBeTruthy();
    expect(matchesQuery(item, 'МОЛОК')).toBeTruthy();
    expect(matchesQuery(item, 'еда', 'Еда')).toBeTruthy();
    expect(matchesQuery(item, 'такси', 'Еда')).toBeFalsy();
  });

  it('пустой запрос не совпадает ни с чем: иначе выдача — весь каталог', () => {
    expect(matchesQuery(item, '   ')).toBeFalsy();
  });
});
