import { addMonths, addYears, format, getDaysInMonth } from 'date-fns';
import { ru } from 'date-fns/locale';
import { parseISODate, todayISO } from '@brain/std';

/**
 * Месяц как единица навигации по тратам.
 *
 * Месяц — строка «YYYY-MM», а не `Date`: он и в ключах сравнения, и в подписи, и
 * в фильтре по дате, а `Date` в каждой из этих ролей тянет за собой часовой пояс
 * и вопрос «полночь какого дня». Строка сравнивается лексикографически ровно
 * так же, как хронологически.
 */
export type Month = string;

/** Месяц, в который попадает день «YYYY-MM-DD». */
export function monthOf(date: string): Month {
  // Дата уже канонична, и срез дешевле круга через `Date` и обратно.
  return date.slice(0, 7);
}

export function currentMonth(today: string = todayISO()): Month {
  return monthOf(today);
}

/** Соседний месяц. Через `date-fns`, потому что декабрь+1 — это ещё и смена года. */
export function shiftMonth(month: Month, delta: number): Month {
  return format(addMonths(firstDay(month), delta), 'yyyy-MM');
}

/** «август 2026». `LLLL` даёт именительный падеж, `MMMM` дал бы «августа». */
export function monthTitle(month: Month): string {
  return format(firstDay(month), 'LLLL yyyy', { locale: ru });
}

/** «авг» — подпись столбика в годовом обзоре, где двенадцать подписей в ряд. */
export function monthShort(month: Month): string {
  // Точка сокращения съедает место в ряду из двенадцати подписей и ничего не
  // добавляет: «авг» читается так же, как «авг.».
  return format(firstDay(month), 'LLL', { locale: ru }).replace(/\.$/, '');
}

/**
 * Сколько дней в месяце. Нужно повторяющимся тратам: «каждое 31-е» в феврале
 * обязано остаться в феврале, а не уехать в март.
 */
export function daysInMonth(month: Month): number {
  return getDaysInMonth(firstDay(month));
}

// ── Год ─────────────────────────────────────────────────────────────────────
// Год — тоже строка («YYYY») и по той же причине, что месяц: он и ключ
// сравнения, и подпись, и префикс месяца, а `Date` в каждой из этих ролей тянет
// часовой пояс и вопрос «полночь какого дня».

export type Year = string;

/** Год, в который попадает месяц. */
export function yearOf(month: Month): Year {
  return month.slice(0, 4);
}

export function currentYear(today: string = todayISO()): Year {
  return today.slice(0, 4);
}

/** Двенадцать месяцев года по порядку — скелет годового обзора. */
export function monthsOfYear(year: Year): Month[] {
  return Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`);
}

/** Соседний год. Через `date-fns` — ради одной арифметики дат на весь модуль. */
export function shiftYear(year: Year, delta: number): Year {
  return format(addYears(firstDay(`${year}-01`), delta), 'yyyy');
}

/** Первое число месяца — точка отсчёта для арифметики дат. */
function firstDay(month: Month): Date {
  return parseISODate(`${month}-01`);
}
