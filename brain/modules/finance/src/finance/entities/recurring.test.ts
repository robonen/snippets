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
  it('ordinary day stays itself', () => {
    expect(occurrenceDate('2026-08', 5)).toBe('2026-08-05');
    expect(occurrenceDate('2026-08', 31)).toBe('2026-08-31');
  });

  it('the 31st in a short month is the last day of the month, not the 1st of the next', () => {
    expect(occurrenceDate('2026-04', 31)).toBe('2026-04-30');
    expect(occurrenceDate('2026-09', 31)).toBe('2026-09-30');
  });

  it('February is clamped to its own length, leap year to its own', () => {
    expect(occurrenceDate('2026-02', 31)).toBe('2026-02-28');
    expect(occurrenceDate('2026-02', 30)).toBe('2026-02-28');
    expect(occurrenceDate('2028-02', 31)).toBe('2028-02-29');
    expect(occurrenceDate('2028-02', 29)).toBe('2028-02-29');
    // Столетие делится на 400 — 2000-й високосный, 1900-й нет.
    expect(occurrenceDate('2000-02', 31)).toBe('2000-02-29');
    expect(occurrenceDate('1900-02', 31)).toBe('1900-02-28');
  });

  it('day outside the calendar is clamped to the edge, not to an empty date', () => {
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

  it('record is recognized by the rule reference, not by amount equality', () => {
    expect(isRecorded(music, [recorded], '2026-08')).toBeTruthy();
    expect(isRecorded(music, [{ ...recorded, amount: 99_999 }], '2026-08')).toBeTruthy();
    expect(isRecorded(music, [{ ...recorded, recurring: undefined }], '2026-08')).toBeFalsy();
  });

  it('another month does not count as recorded', () => {
    expect(isRecorded(music, [recorded], '2026-09')).toBeFalsy();
  });
});

describe(dueRules, () => {
  const rules = [rule('music', 5), rule('rent', 25), rule('gym', 10, { active: false })];
  const today = '2026-08-24';

  it('time to record what is due and not yet in the month', () => {
    expect(dueRules(rules, [], '2026-08', today).map(item => item.id)).toEqual(['music']);
  });

  it('disabled rule is not applied even when its day has passed', () => {
    expect(dueRules(rules, [], '2026-08', today).some(item => item.id === 'gym')).toBeFalsy();
  });

  it('already recorded is not offered twice: application is idempotent', () => {
    const recorded: Expense = {
      id: 'e1',
      amount: 50_000,
      date: '2026-08-05',
      createdAt: 1,
      recurring: 'music',
    };
    expect(dueRules(rules, [recorded], '2026-08', today)).toEqual([]);
  });

  it('past month offers everything, future month nothing: one comparison with the day', () => {
    expect(dueRules(rules, [], '2026-07', today).map(item => item.id)).toEqual(['music', 'rent']);
    expect(dueRules(rules, [], '2026-09', today)).toEqual([]);
  });

  it('charge day today — already due', () => {
    expect(dueRules([rule('today', 24)], [], '2026-08', today)).toHaveLength(1);
  });

  it('month end is not swallowed by clamping: the 31st in February arrives on the 28th', () => {
    expect(dueRules([rule('rent', 31)], [], '2026-02', '2026-02-28')).toHaveLength(1);
    expect(dueRules([rule('rent', 31)], [], '2026-02', '2026-02-27')).toHaveLength(0);
  });
});

describe(draftFromRule, () => {
  it('expense is tagged with the rule reference and lands on its day', () => {
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

  it('empty name does not become a field, category may be absent', () => {
    const draft = draftFromRule(rule('bare', 3, { title: '  ' }), '2026-08', 'e1', 1);
    expect(Object.hasOwn(draft, 'note')).toBeFalsy();
    expect(Object.hasOwn(draft, 'category')).toBeFalsy();
  });
});

describe(monthlyLoad, () => {
  it('only active rules are counted', () => {
    expect(monthlyLoad([rule('a', 1), rule('b', 2, { amount: 120_000 })])).toBe(170_000);
    expect(monthlyLoad([rule('a', 1, { active: false })])).toBe(0);
    expect(monthlyLoad([])).toBe(0);
  });
});

describe(sortRules, () => {
  it('by charge day, ties broken by name', () => {
    const sorted = sortRules([rule('b', 10, { title: 'Б' }), rule('a', 10, { title: 'А' }), rule('c', 1)]);
    expect(sorted.map(item => item.id)).toEqual(['c', 'a', 'b']);
  });

  it('source list is untouched', () => {
    const rules = [rule('b', 10), rule('a', 1)];
    sortRules(rules);
    expect(rules.map(item => item.id)).toEqual(['b', 'a']);
  });
});
