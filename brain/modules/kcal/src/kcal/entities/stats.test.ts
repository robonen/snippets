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
  it('складывает записи по дням и сортирует по дате', () => {
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

  it('округляет макросы до десятых: хвост двоичной дроби не уезжает в подпись', () => {
    const days = summarizeDays([entry('2026-08-16', 100, 0.1, 0.2, 0.3), entry('2026-08-16', 100, 0.2, 0.1, 0.3)]);
    expect(days[0]).toMatchObject({ protein: 0.3, fat: 0.3, carbs: 0.6 });
  });

  it('пустой дневник — пустой список', () => {
    expect(summarizeDays([])).toEqual([]);
  });
});

describe(fillDays, () => {
  const summaries = summarizeDays([entry('2026-08-16', 1800), entry('2026-08-18', 2100)]);

  it('заполняет пропущенные дни нулями, сохраняя порядок периода', () => {
    const days = fillDays(['2026-08-16', '2026-08-17', '2026-08-18'], summaries);

    expect(days.map(day => day.kcal)).toEqual([1800, 0, 2100]);
    expect(days[1]).toEqual({ date: '2026-08-17', kcal: 0, protein: 0, fat: 0, carbs: 0, entries: 0 });
  });

  it('дни вне периода в выдачу не попадают', () => {
    expect(fillDays(['2026-08-18'], summaries).map(day => day.kcal)).toEqual([2100]);
  });

  it('период без единой записи — нули на всю длину', () => {
    expect(fillDays(['2026-08-16', '2026-08-17'], []).every(day => day.entries === 0)).toBeTruthy();
  });
});

describe(periodStats, () => {
  it('среднее считается по заполненным дням, а не по длине периода', () => {
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

  it('единственный день: среднее равно этому дню', () => {
    const days = fillDays(['2026-08-18'], summarizeDays([entry('2026-08-18', 1750, 90, 55, 180)]));
    expect(periodStats(days, 2000)).toMatchObject({ trackedDays: 1, kcal: 1750, onTargetShare: 100 });
  });

  it('период без записей — null, а не нули', () => {
    expect(periodStats(fillDays(['2026-08-16', '2026-08-17'], []), 2000)).toBeNull();
    expect(periodStats([], 2000)).toBeNull();
  });

  it('день ровно по норме считается днём в цели', () => {
    const days = summarizeDays([entry('2026-08-18', 2000)]);
    expect(periodStats(days, 2000)?.onTargetShare).toBe(100);
  });
});

describe(chartMax, () => {
  it('масштаб не ниже нормы: линия цели всегда в кадре', () => {
    expect(chartMax(fillDays(['2026-08-16'], []), 2000)).toBeCloseTo(2160);
  });

  it('растёт по самому высокому дню', () => {
    const days = summarizeDays([entry('2026-08-16', 3000)]);
    expect(chartMax(days, 2000)).toBeCloseTo(3240);
  });

  it('пустой набор и нулевая норма не дают деления на ноль', () => {
    expect(chartMax([], 0)).toBeGreaterThan(0);
  });
});

describe(macroShares, () => {
  it('доли калорий сходятся ровно в сто процентов', () => {
    const shares = macroShares({ kcal: 2000, protein: 100, fat: 70, carbs: 220 });
    expect(shares.protein + shares.fat + shares.carbs).toBe(100);
    expect(shares).toEqual({ protein: 21, fat: 33, carbs: 46 });
  });

  it('пустой день — нули, а не деление на ноль', () => {
    expect(macroShares({ kcal: 0, protein: 0, fat: 0, carbs: 0 })).toEqual({ protein: 0, fat: 0, carbs: 0 });
  });
});

describe(weightTrend, () => {
  const weights = [weight('2026-08-01', 82), weight('2026-08-10', 81.2), weight('2026-08-17', 80.4)];

  it('считает разницу от последнего замера до точки отсчёта', () => {
    expect(weightTrend(weights, '2026-08-10')).toEqual({
      deltaKg: -0.8,
      fromDate: '2026-08-10',
      toDate: '2026-08-17',
    });
  });

  it('точки отсчёта нет — берёт самый ранний замер', () => {
    expect(weightTrend(weights, '2026-07-01')?.fromDate).toBe('2026-08-01');
  });

  it('единственный замер — сравнивать не с чем', () => {
    expect(weightTrend([weight('2026-08-17', 80.4)], '2026-08-10')).toBeNull();
    expect(weightTrend([], '2026-08-10')).toBeNull();
  });

  it('точка отсчёта совпала с последним замером — null', () => {
    expect(weightTrend([weight('2026-08-01', 82), weight('2026-08-17', 80.4)], '2026-08-17')).toBeNull();
  });

  it('набор веса — плюс', () => {
    expect(weightTrend([weight('2026-08-01', 70), weight('2026-08-17', 71.5)], '2026-08-01')?.deltaKg).toBe(1.5);
  });
});

describe(sparkPoints, () => {
  it('раскладывает точки по ширине и переворачивает ось Y', () => {
    // 30 — низ картинки за вычетом отступа, 2 — верх: минимум внизу, максимум вверху.
    expect(sparkPoints([80, 82], 100, 30)).toBe('0.0,28.0 100.0,2.0');
  });

  it('плоская линия не прилипает к краю', () => {
    const points = sparkPoints([80, 80], 100, 30).split(' ');
    expect(points).toHaveLength(2);
    expect(points.every(point => point.endsWith(',28.0'))).toBeTruthy();
  });

  it('из одной точки линии не выходит', () => {
    expect(sparkPoints([80], 100, 30)).toBe('');
    expect(sparkPoints([], 100, 30)).toBe('');
  });
});
