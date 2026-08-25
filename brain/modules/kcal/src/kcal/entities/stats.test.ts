import { describe, expect, it } from 'vitest';
import type { Entry } from './entry';
import type { WeightLog } from './profile';
import {
  chartMax,
  fillDays,
  macroShares,
  periodStats,
  sparkPoints,
  summarizeDays,
  weightTrend,
} from './stats';

function entry(date: string, kcal: number, protein = 0, fat = 0, carbs = 0): Entry {
  return {
    id: `${date}:${kcal}`,
    date,
    meal: 'lunch',
    name: 'Еда',
    kcal,
    protein,
    fat,
    carbs,
    createdAt: 0,
  };
}

function weight(date: string, kg: number): WeightLog {
  return { id: date, date, kg, createdAt: 0 };
}

describe(summarizeDays, () => {
  it('sums entries by day and sorts by date', () => {
    const days = summarizeDays([
      entry('2026-08-17', 500, 20, 10, 60),
      entry('2026-08-16', 300, 10, 5, 40),
      entry('2026-08-17', 200, 5, 2, 25),
    ]);

    expect(days.map(day => day.date)).toEqual(['2026-08-16', '2026-08-17']);
    expect(days[1]).toEqual({
      date: '2026-08-17',
      kcal: 700,
      protein: 25,
      fat: 12,
      carbs: 85,
      entries: 2,
    });
  });

  it('rounds macros to tenths: the binary-fraction tail does not leak into the label', () => {
    const days = summarizeDays([entry('2026-08-16', 100, 0.1, 0.2, 0.3), entry('2026-08-16', 100, 0.2, 0.1, 0.3)]);
    expect(days[0]).toMatchObject({ protein: 0.3, fat: 0.3, carbs: 0.6 });
  });

  it('empty diary — empty list', () => {
    expect(summarizeDays([])).toEqual([]);
  });
});

describe(fillDays, () => {
  const summaries = summarizeDays([entry('2026-08-16', 1800), entry('2026-08-18', 2100)]);

  it('fills missed days with zeros, keeping period order', () => {
    const days = fillDays(['2026-08-16', '2026-08-17', '2026-08-18'], summaries);

    expect(days.map(day => day.kcal)).toEqual([1800, 0, 2100]);
    expect(days[1]).toEqual({ date: '2026-08-17', kcal: 0, protein: 0, fat: 0, carbs: 0, entries: 0 });
  });

  it('days outside the period do not enter the output', () => {
    expect(fillDays(['2026-08-18'], summaries).map(day => day.kcal)).toEqual([2100]);
  });

  it('period with no entries — zeros for the whole length', () => {
    expect(fillDays(['2026-08-16', '2026-08-17'], []).every(day => day.entries === 0)).toBeTruthy();
  });
});

describe(periodStats, () => {
  it('average is computed over filled days, not over the period length', () => {
    const days = fillDays(
      ['2026-08-16', '2026-08-17', '2026-08-18', '2026-08-19'],
      summarizeDays([entry('2026-08-18', 1800, 100, 60, 200), entry('2026-08-19', 2200, 120, 80, 240)]),
    );

    expect(periodStats(days, 2000)).toEqual({
      trackedDays: 2,
      kcal: 2000,
      protein: 110,
      fat: 70,
      carbs: 220,
      onTargetShare: 50,
    });
  });

  it('single day: the average equals that day', () => {
    const days = fillDays(['2026-08-18'], summarizeDays([entry('2026-08-18', 1750, 90, 55, 180)]));
    expect(periodStats(days, 2000)).toMatchObject({ trackedDays: 1, kcal: 1750, onTargetShare: 100 });
  });

  it('period without entries — null, not zeros', () => {
    expect(periodStats(fillDays(['2026-08-16', '2026-08-17'], []), 2000)).toBeNull();
    expect(periodStats([], 2000)).toBeNull();
  });

  it('day exactly at the target counts as on target', () => {
    const days = summarizeDays([entry('2026-08-18', 2000)]);
    expect(periodStats(days, 2000)?.onTargetShare).toBe(100);
  });
});

describe(chartMax, () => {
  it('scale never below the target: the goal line is always in frame', () => {
    expect(chartMax(fillDays(['2026-08-16'], []), 2000)).toBeCloseTo(2160);
  });

  it('grows with the highest day', () => {
    const days = summarizeDays([entry('2026-08-16', 3000)]);
    expect(chartMax(days, 2000)).toBeCloseTo(3240);
  });

  it('empty set and zero target cause no division by zero', () => {
    expect(chartMax([], 0)).toBeGreaterThan(0);
  });
});

describe(macroShares, () => {
  it('calorie shares add up to exactly one hundred percent', () => {
    const shares = macroShares({ kcal: 2000, protein: 100, fat: 70, carbs: 220 });
    expect(shares.protein + shares.fat + shares.carbs).toBe(100);
    expect(shares).toEqual({ protein: 21, fat: 33, carbs: 46 });
  });

  it('empty day — zeros, not division by zero', () => {
    expect(macroShares({ kcal: 0, protein: 0, fat: 0, carbs: 0 })).toEqual({ protein: 0, fat: 0, carbs: 0 });
  });
});

describe(weightTrend, () => {
  const weights = [weight('2026-08-01', 82), weight('2026-08-10', 81.2), weight('2026-08-17', 80.4)];

  it('computes the difference from the last measurement to the reference point', () => {
    expect(weightTrend(weights, '2026-08-10')).toEqual({
      deltaKg: -0.8,
      fromDate: '2026-08-10',
      toDate: '2026-08-17',
    });
  });

  it('no reference point — takes the earliest measurement', () => {
    expect(weightTrend(weights, '2026-07-01')?.fromDate).toBe('2026-08-01');
  });

  it('single measurement — nothing to compare with', () => {
    expect(weightTrend([weight('2026-08-17', 80.4)], '2026-08-10')).toBeNull();
    expect(weightTrend([], '2026-08-10')).toBeNull();
  });

  it('reference point equals the last measurement — null', () => {
    expect(weightTrend([weight('2026-08-01', 82), weight('2026-08-17', 80.4)], '2026-08-17')).toBeNull();
  });

  it('weight gain — plus', () => {
    expect(weightTrend([weight('2026-08-01', 70), weight('2026-08-17', 71.5)], '2026-08-01')?.deltaKg).toBe(1.5);
  });
});

describe(sparkPoints, () => {
  it('spreads points across the width and flips the Y axis', () => {
    // 30 — низ картинки за вычетом отступа, 2 — верх: минимум внизу, максимум вверху.
    expect(sparkPoints([80, 82], 100, 30)).toBe('0.0,28.0 100.0,2.0');
  });

  it('flat line does not stick to the edge', () => {
    const points = sparkPoints([80, 80], 100, 30).split(' ');
    expect(points).toHaveLength(2);
    expect(points.every(point => point.endsWith(',28.0'))).toBeTruthy();
  });

  it('a single point yields no line', () => {
    expect(sparkPoints([80], 100, 30)).toBe('');
    expect(sparkPoints([], 100, 30)).toBe('');
  });
});
