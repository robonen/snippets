import { round1 } from '@brain/std';
import type { Entry } from './entry';
import type { Nutrients } from './nutrition';
import type { WeightLog } from './profile';

/**
 * Расчёты статистики — чистые функции над снимками дневника.
 *
 * Экран не считает ничего сам: график, средние и тренд веса — это арифметика с
 * краевыми случаями (пустой период, единственный день, плоская линия веса), и
 * проверять её через DOM дороже и хуже, чем вызовом функции.
 */

/** Итог одного дня дневника. */
export interface DaySummary extends Nutrients {
  date: string;
  /** Число записей: 0 отличает «ничего не ел» от «не вёл дневник». */
  entries: number;
}

export function emptyDay(date: string): DaySummary {
  return { date, kcal: 0, protein: 0, fat: 0, carbs: 0, entries: 0 };
}

/** Записи, свёрнутые в дни, по возрастанию даты. */
export function summarizeDays(entries: readonly Entry[]): DaySummary[] {
  const byDate = new Map<string, DaySummary>();
  for (const entry of entries) {
    let day = byDate.get(entry.date);
    if (day === undefined) {
      day = emptyDay(entry.date);
      byDate.set(entry.date, day);
    }
    day.kcal += entry.kcal;
    day.protein += entry.protein;
    day.fat += entry.fat;
    day.carbs += entry.carbs;
    day.entries += 1;
  }
  // Хвост двоичной дроби из десятков слагаемых виден в подписи «12,299999 г»,
  // поэтому округляем один раз здесь, а не в каждом месте показа.
  for (const day of byDate.values()) {
    day.protein = round1(day.protein);
    day.fat = round1(day.fat);
    day.carbs = round1(day.carbs);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Дни периода в заданном порядке: пропуски заполняются нулевыми.
 *
 * График рисуется по календарю, а не по тому, что записано: провал в середине
 * недели — это факт, и молча сжимать его до соседних столбиков значило бы врать
 * о регулярности.
 */
export function fillDays(dates: readonly string[], summaries: readonly DaySummary[]): DaySummary[] {
  const byDate = new Map(summaries.map(day => [day.date, day]));
  return dates.map(date => byDate.get(date) ?? emptyDay(date));
}

export interface PeriodStats extends Nutrients {
  /** Сколько дней периода вообще заполнялись — среднее считается только по ним. */
  trackedDays: number;
  /** Доля дней в пределах дневной нормы, проценты. */
  onTargetShare: number;
}

/**
 * Средние за период. `null` — в периоде нет ни одного заполненного дня.
 *
 * Знаменатель — заполненные дни, а не длина периода: человек, который завёл
 * дневник в четверг, не ел ноль калорий с понедельника, и делить на семь
 * значило бы показать ему вдвое заниженное среднее.
 */
export function periodStats(days: readonly DaySummary[], targetKcal: number): PeriodStats | null {
  const tracked = days.filter(day => day.entries > 0);
  if (tracked.length === 0) return null;

  const total = tracked.reduce<Nutrients>((acc, day) => ({
    kcal: acc.kcal + day.kcal,
    protein: acc.protein + day.protein,
    fat: acc.fat + day.fat,
    carbs: acc.carbs + day.carbs,
  }), { kcal: 0, protein: 0, fat: 0, carbs: 0 });

  const onTarget = tracked.filter(day => day.kcal <= targetKcal).length;
  return {
    trackedDays: tracked.length,
    kcal: Math.round(total.kcal / tracked.length),
    protein: round1(total.protein / tracked.length),
    fat: round1(total.fat / tracked.length),
    carbs: round1(total.carbs / tracked.length),
    onTargetShare: Math.round((onTarget / tracked.length) * 100),
  };
}

/** Запас над самым высоким столбиком, чтобы он не упирался в край графика. */
const CHART_HEADROOM = 1.08;

/**
 * Верх шкалы графика калорий. Никогда не ниже нормы: иначе линия цели уезжала бы
 * за пределы картинки в те дни, когда ели мало, и график терял бы точку отсчёта.
 */
export function chartMax(days: readonly DaySummary[], targetKcal: number): number {
  const peak = Math.max(targetKcal, ...days.map(day => day.kcal));
  // Пустой дневник и нулевая норма: любое положительное число лучше деления на ноль.
  return peak > 0 ? peak * CHART_HEADROOM : 1;
}

/** Калорийность грамма макронутриента — по Атуотеру. */
const KCAL_PER_GRAM = { protein: 4, fat: 9, carbs: 4 } as const;

export interface MacroShares {
  protein: number;
  fat: number;
  carbs: number;
}

/**
 * Доли калорий из белка, жира и углеводов в процентах.
 *
 * Углеводы добираются остатком до ста: три независимо округлённые доли дают
 * 99 или 101, и полоса на экране либо не сходится, либо вылезает.
 */
export function macroShares(nutrients: Nutrients): MacroShares {
  const protein = nutrients.protein * KCAL_PER_GRAM.protein;
  const fat = nutrients.fat * KCAL_PER_GRAM.fat;
  const carbs = nutrients.carbs * KCAL_PER_GRAM.carbs;
  const total = protein + fat + carbs;
  if (total <= 0) return { protein: 0, fat: 0, carbs: 0 };

  const proteinShare = Math.round((protein / total) * 100);
  const fatShare = Math.round((fat / total) * 100);
  return { protein: proteinShare, fat: fatShare, carbs: 100 - proteinShare - fatShare };
}

export interface WeightTrend {
  /** Разница «сейчас минус тогда», кг: минус — вес снизился. */
  deltaKg: number;
  fromDate: string;
  toDate: string;
}

/**
 * Изменение веса от точки отсчёта до последнего замера. `null` — сравнивать не с
 * чем: замер один или все они сделаны после `since`… кроме случая, когда точки
 * отсчёта нет вовсе — тогда берётся самый ранний замер, иначе первая неделя
 * ведения дневника не показывала бы динамику вообще.
 */
export function weightTrend(weights: readonly WeightLog[], since: string): WeightTrend | null {
  const latest = weights.at(-1);
  const earliest = weights[0];
  if (latest === undefined || earliest === undefined || weights.length < 2) return null;

  const reference = [...weights].reverse().find(item => item.date <= since) ?? earliest;
  if (reference.date === latest.date) return null;

  return {
    deltaKg: round1(latest.kg - reference.kg),
    fromDate: reference.date,
    toDate: latest.date,
  };
}

/** Отступ линии от краёв картинки, чтобы толщина штриха не срезалась. */
const SPARK_PAD = 2;
/** Минимальный размах шкалы, кг: без него ±100 г растягиваются на всю высоту. */
const SPARK_MIN_SPAN = 0.5;

/**
 * Точки для `<polyline>` спарклайна в координатах `0 0 width height`.
 * Пустая строка — рисовать нечего: из одной точки линии не выходит.
 */
export function sparkPoints(values: readonly number[], width: number, height: number): string {
  if (values.length < 2) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, SPARK_MIN_SPAN);
  const usable = height - SPARK_PAD * 2;

  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      // Ось Y в SVG растёт вниз, а вес на графике — вверх.
      const y = height - SPARK_PAD - ((value - min) / span) * usable;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}
