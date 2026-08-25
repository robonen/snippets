import { monthOf, monthsOfYear, yearOf } from '../lib/month';
import type { Month, Year } from '../lib/month';
import type { Expense } from './expense';

/**
 * Годовой обзор: сколько уходило в месяц и куда это движется.
 *
 * Все двенадцать месяцев показываются всегда, даже пустые: провал в графике —
 * это ответ («в мае не тратил» или «в мае не записывал»), а месяц, выпавший из
 * ряда, превращает картинку в обманчиво ровную.
 */

/** Итог одного месяца. */
export interface MonthTotal {
  month: Month;
  /** Сумма за месяц, копейки. */
  total: number;
  count: number;
}

export interface YearStats {
  /** Сумма за год, копейки. */
  total: number;
  /** Месяцев с тратами. */
  tracked: number;
  /**
   * Среднее по месяцам С ТРАТАМИ, копейки.
   *
   * Делить на двенадцать нечестно, пока год не кончился: в марте это дало бы
   * четверть настоящего расхода и «всё хорошо» на пустом месте.
   */
  average: number;
  /** Самый дорогой месяц — верх шкалы графика и повод посмотреть, что там было. */
  peak?: MonthTotal;
}

/** Изменение относительно прошлого периода. */
export interface Change {
  /** Разница в копейках: положительная — стало больше. */
  delta: number;
  /** Доля изменения. `null` — сравнивать не с чем: прошлый период пуст. */
  share: number | null;
  direction: 'up' | 'down' | 'flat';
}

/** Суммы по месяцам года — все двенадцать, включая пустые. */
export function monthlyTotals(expenses: readonly Expense[], year: Year): MonthTotal[] {
  const totals = new Map<Month, MonthTotal>(
    monthsOfYear(year).map(month => [month, { month, total: 0, count: 0 }]),
  );

  for (const expense of expenses) {
    const month = monthOf(expense.date);
    if (yearOf(month) !== year) continue;
    const entry = totals.get(month);
    if (entry === undefined) continue;
    entry.total += expense.amount;
    entry.count += 1;
  }

  return [...totals.values()];
}

/** Итоги года по помесячным суммам. */
export function yearStats(totals: readonly MonthTotal[]): YearStats {
  let total = 0;
  let tracked = 0;
  let peak: MonthTotal | undefined;

  for (const entry of totals) {
    total += entry.total;
    if (entry.count === 0) continue;
    tracked += 1;
    if (peak === undefined || entry.total > peak.total) peak = entry;
  }

  const stats: YearStats = {
    total,
    tracked,
    average: tracked === 0 ? 0 : Math.round(total / tracked),
  };
  if (peak !== undefined) stats.peak = peak;
  return stats;
}

/**
 * Сравнение двух сумм. Доля не считается от нуля: «на бесконечность больше»
 * ничего не сообщает, а `null` честно говорит «сравнивать не с чем».
 */
export function compareTotals(current: number, previous: number): Change {
  const delta = current - previous;
  return {
    delta,
    share: previous > 0 ? delta / previous : null,
    direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
  };
}

/**
 * Верх шкалы графика. Нулевой год не даёт нулевой высоты: на такой шкале любой
 * столбик оказался бы во всю картинку.
 */
export function chartMax(totals: readonly MonthTotal[]): number {
  let max = 0;
  for (const entry of totals) max = Math.max(max, entry.total);
  return max === 0 ? 1 : max;
}
