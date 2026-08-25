import { describe, expect, it } from 'vitest';
import { Land, Link, createSpace, fixedClock } from '@sync/core';
import type { Space } from '@sync/core';
import type { Category } from '../entities/category';
import type { Expense } from '../entities/expense';
import type { Recurring } from '../entities/recurring';
import {
  FinanceModel,
  readCategory,
  readExpense,
  readRule,
  writeCategory,
  writeExpense,
  writeRule,
} from './models';

function spaceOf(): Space {
  const land = new Land(Link.peer(new Uint8Array(8).fill(0x66)), fixedClock(1_700_000));
  return createSpace({ land });
}

const EXPENSE: Expense = {
  id: 'e1',
  amount: 125_050,
  category: 'c1',
  note: 'продукты',
  date: '2026-08-24',
  createdAt: 1_700_100,
};

const CATEGORY: Category = { id: 'c1', name: 'Продукты', colorKey: 'teal', limit: 1_000_000 };

const RULE: Recurring = {
  id: 'r1',
  title: 'Подписка на музыку',
  amount: 29_900,
  category: 'c1',
  day: 5,
  active: true,
  createdAt: 1_700_050,
};

describe('модели финансов на @sync/core', () => {
  it('трата переживает круг документ → снимок, включая опциональные поля', () => {
    const root = spaceOf().root(FinanceModel);
    writeExpense(root.entries(EXPENSE.id), EXPENSE);

    expect(readExpense(EXPENSE.id, root.entries(EXPENSE.id))).toEqual(EXPENSE);
  });

  it('незаполненные опциональные поля отсутствуют, а не равны null', () => {
    const root = spaceOf().root(FinanceModel);
    const bare: Expense = { id: 'e2', amount: 25_000, date: '2026-08-24', createdAt: 1_700_200 };
    writeExpense(root.entries(bare.id), bare);

    const back = readExpense(bare.id, root.entries(bare.id));
    expect(back).toEqual(bare);
    expect(Object.hasOwn(back, 'category')).toBeFalsy();
    expect(Object.hasOwn(back, 'note')).toBeFalsy();
  });

  it('снятая категория читается как отсутствие, а не как прежнее значение', () => {
    const root = spaceOf().root(FinanceModel);
    writeExpense(root.entries(EXPENSE.id), EXPENSE);
    writeExpense(root.entries(EXPENSE.id), { ...EXPENSE, category: undefined });

    expect(readExpense(EXPENSE.id, root.entries(EXPENSE.id)).category).toBeUndefined();
  });

  it('сумма хранится копейками и возвращается ровно той же', () => {
    const root = spaceOf().root(FinanceModel);
    for (const amount of [0, 1, 99, 25_000, 1_200_000_000]) {
      writeExpense(root.entries('e'), { ...EXPENSE, id: 'e', amount });
      expect(readExpense('e', root.entries('e')).amount).toBe(amount);
    }
  });

  it('дробная сумма не пишется вовсе: деньги целые, и ошибка вылезает на месте', () => {
    const root = spaceOf().root(FinanceModel);
    expect(() => writeExpense(root.entries('e3'), { ...EXPENSE, id: 'e3', amount: 250.5 })).toThrow();
  });

  it('категория переживает круг документ → снимок, включая лимит', () => {
    const root = spaceOf().root(FinanceModel);
    writeCategory(root.categories(CATEGORY.id), CATEGORY);

    expect(readCategory(CATEGORY.id, root.categories(CATEGORY.id))).toEqual(CATEGORY);
  });

  it('незаданный бюджет читается как отсутствие, а не как ноль', () => {
    const root = spaceOf().root(FinanceModel);
    const bare: Category = { id: 'c2', name: 'Развлечения', colorKey: 'rose' };
    writeCategory(root.categories(bare.id), bare);

    const back = readCategory(bare.id, root.categories(bare.id));
    expect(back).toEqual(bare);
    expect(Object.hasOwn(back, 'limit')).toBeFalsy();
  });

  it('снятый бюджет не оставляет прежнего значения', () => {
    const root = spaceOf().root(FinanceModel);
    writeCategory(root.categories(CATEGORY.id), CATEGORY);
    writeCategory(root.categories(CATEGORY.id), { ...CATEGORY, limit: undefined });

    expect(readCategory(CATEGORY.id, root.categories(CATEGORY.id)).limit).toBeUndefined();
  });

  it('повторяющаяся трата переживает круг документ → снимок', () => {
    const root = spaceOf().root(FinanceModel);
    writeRule(root.rules(RULE.id), RULE);

    expect(readRule(RULE.id, root.rules(RULE.id))).toEqual(RULE);
  });

  it('правило без категории читается без поля, выключенное остаётся выключенным', () => {
    const root = spaceOf().root(FinanceModel);
    const bare: Recurring = {
      id: 'r2',
      title: 'Аренда',
      amount: 4_500_000,
      day: 31,
      active: false,
      createdAt: 1_700_060,
    };
    writeRule(root.rules(bare.id), bare);

    const back = readRule(bare.id, root.rules(bare.id));
    expect(back).toEqual(bare);
    expect(Object.hasOwn(back, 'category')).toBeFalsy();
  });

  it('ссылка траты на своё правило переживает круг', () => {
    const root = spaceOf().root(FinanceModel);
    const auto: Expense = { ...EXPENSE, id: 'e-auto', recurring: 'r1' };
    writeExpense(root.entries(auto.id), auto);
    writeExpense(root.entries(EXPENSE.id), EXPENSE);

    expect(readExpense(auto.id, root.entries(auto.id))).toEqual(auto);
    // Записанная руками трата поля не заводит: иначе «уже записано» ловило бы
    // чужие траты.
    expect(Object.hasOwn(readExpense(EXPENSE.id, root.entries(EXPENSE.id)), 'recurring')).toBeFalsy();
  });

  it('ключи каталогов видны и удаляются по отдельности', () => {
    const root = spaceOf().root(FinanceModel);
    writeExpense(root.entries('a'), { ...EXPENSE, id: 'a' });
    writeExpense(root.entries('b'), { ...EXPENSE, id: 'b', note: 'кофе' });
    writeCategory(root.categories('c1'), CATEGORY);

    expect([...root.entries.keys()].sort()).toEqual(['a', 'b']);
    root.entries.delete('a');
    expect([...root.entries.keys()]).toEqual(['b']);
    // Удаление траты каталог категорий не трогает.
    expect([...root.categories.keys()]).toEqual(['c1']);
  });

  it('две вкладки сходятся: запись из одной видна в другой', () => {
    const clock = fixedClock(1_700_000);
    const peer = Link.peer(new Uint8Array(8).fill(0x66));
    const tabA = new Land(peer, clock, { session: 0x000100 });
    const tabB = new Land(peer, clock, { session: 0x800100 });

    const rootA = createSpace({ land: tabA }).root(FinanceModel);
    const rootB = createSpace({ land: tabB }).root(FinanceModel);

    writeExpense(rootA.entries('x'), { ...EXPENSE, id: 'x' });
    writeExpense(rootB.entries('y'), { ...EXPENSE, id: 'y', note: 'из второй вкладки' });

    // Обмен как по каналу вкладок, только руками и детерминированно.
    tabB.apply(tabA.part().units);
    tabA.apply(tabB.part().units);

    expect(readExpense('x', rootB.entries('x')).note).toBe('продукты');
    expect(readExpense('y', rootA.entries('y')).note).toBe('из второй вкладки');
  });
});
