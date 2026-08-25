import { describe, expect, it } from 'vitest';
import {
  draftFromRule,
  dueRules,
  isRecorded,
  monthlyLoad,
  occurrenceDate,
  sortRules,
} from './recurring';
import type { Recurring } from './recurring';
import type { Expense } from './expense';

function rule(id: string, day: number, extra: Partial<Recurring> = {}): Recurring {
  return { id, title: id, amount: 50_000, day, active: true, createdAt: 1, ...extra };
}

describe(occurrenceDate, () => {
  it('обычный день остаётся собой', () => {
    expect(occurrenceDate('2026-08', 5)).toBe('2026-08-05');
    expect(occurrenceDate('2026-08', 31)).toBe('2026-08-31');
  });

  it('31-е в коротком месяце — последний день месяца, а не первое число следующего', () => {
    expect(occurrenceDate('2026-04', 31)).toBe('2026-04-30');
    expect(occurrenceDate('2026-09', 31)).toBe('2026-09-30');
  });

  it('февраль зажимается по своей длине, високосный — по своей', () => {
    expect(occurrenceDate('2026-02', 31)).toBe('2026-02-28');
    expect(occurrenceDate('2026-02', 30)).toBe('2026-02-28');
    expect(occurrenceDate('2028-02', 31)).toBe('2028-02-29');
    expect(occurrenceDate('2028-02', 29)).toBe('2028-02-29');
    // Столетие делится на 400 — 2000-й високосный, 1900-й нет.
    expect(occurrenceDate('2000-02', 31)).toBe('2000-02-29');
    expect(occurrenceDate('1900-02', 31)).toBe('1900-02-28');
  });

  it('день вне календаря приводится к краю, а не к пустой дате', () => {
    expect(occurrenceDate('2026-08', 0)).toBe('2026-08-01');
    expect(occurrenceDate('2026-08', -5)).toBe('2026-08-01');
    expect(occurrenceDate('2026-08', 99)).toBe('2026-08-31');
    expect(occurrenceDate('2026-08', 5.7)).toBe('2026-08-05');
  });
});

describe(isRecorded, () => {
  const music = rule('music', 5);
  const recorded: Expense = {
    id: 'e1',
    amount: 50_000,
    date: '2026-08-05',
    createdAt: 1,
    recurring: 'music',
  };

  it('запись узнаётся по ссылке на правило, а не по совпадению суммы', () => {
    expect(isRecorded(music, [recorded], '2026-08')).toBeTruthy();
    expect(isRecorded(music, [{ ...recorded, amount: 99_999 }], '2026-08')).toBeTruthy();
    expect(isRecorded(music, [{ ...recorded, recurring: undefined }], '2026-08')).toBeFalsy();
  });

  it('чужой месяц не считается записанным', () => {
    expect(isRecorded(music, [recorded], '2026-09')).toBeFalsy();
  });
});

describe(dueRules, () => {
  const rules = [rule('music', 5), rule('rent', 25), rule('gym', 10, { active: false })];
  const today = '2026-08-24';

  it('пора записать то, чей день наступил и чего в месяце ещё нет', () => {
    expect(dueRules(rules, [], '2026-08', today).map(item => item.id)).toEqual(['music']);
  });

  it('выключенное правило не подставляется, даже когда день прошёл', () => {
    expect(dueRules(rules, [], '2026-08', today).some(item => item.id === 'gym')).toBeFalsy();
  });

  it('уже записанное второй раз не предлагается: подстановка идемпотентна', () => {
    const recorded: Expense = {
      id: 'e1',
      amount: 50_000,
      date: '2026-08-05',
      createdAt: 1,
      recurring: 'music',
    };
    expect(dueRules(rules, [recorded], '2026-08', today)).toEqual([]);
  });

  it('прошлый месяц предлагает всё, будущий — ничего: сравнение с днём одно', () => {
    expect(dueRules(rules, [], '2026-07', today).map(item => item.id)).toEqual(['music', 'rent']);
    expect(dueRules(rules, [], '2026-09', today)).toEqual([]);
  });

  it('день списания сегодня — уже пора', () => {
    expect(dueRules([rule('today', 24)], [], '2026-08', today)).toHaveLength(1);
  });

  it('конец месяца не проглатывается зажатием: 31-е в феврале наступает 28-го', () => {
    expect(dueRules([rule('rent', 31)], [], '2026-02', '2026-02-28')).toHaveLength(1);
    expect(dueRules([rule('rent', 31)], [], '2026-02', '2026-02-27')).toHaveLength(0);
  });
});

describe(draftFromRule, () => {
  it('трата помечена ссылкой на правило и встаёт на свой день', () => {
    expect(draftFromRule(rule('music', 31, { title: 'Музыка', category: 'fun' }), '2026-02', 'e9', 777))
      .toEqual({
        id: 'e9',
        amount: 50_000,
        category: 'fun',
        note: 'Музыка',
        date: '2026-02-28',
        createdAt: 777,
        recurring: 'music',
      });
  });

  it('пустое название полем не становится, категории может не быть', () => {
    const draft = draftFromRule(rule('bare', 3, { title: '  ' }), '2026-08', 'e1', 1);
    expect(Object.hasOwn(draft, 'note')).toBeFalsy();
    expect(Object.hasOwn(draft, 'category')).toBeFalsy();
  });
});

describe(monthlyLoad, () => {
  it('считаются только активные правила', () => {
    expect(monthlyLoad([rule('a', 1), rule('b', 2, { amount: 120_000 })])).toBe(170_000);
    expect(monthlyLoad([rule('a', 1, { active: false })])).toBe(0);
    expect(monthlyLoad([])).toBe(0);
  });
});

describe(sortRules, () => {
  it('по дню списания, при совпадении — по названию', () => {
    const sorted = sortRules([rule('b', 10, { title: 'Б' }), rule('a', 10, { title: 'А' }), rule('c', 1)]);
    expect(sorted.map(item => item.id)).toEqual(['c', 'a', 'b']);
  });

  it('исходный список не трогается', () => {
    const rules = [rule('b', 10), rule('a', 1)];
    sortRules(rules);
    expect(rules.map(item => item.id)).toEqual(['b', 'a']);
  });
});
