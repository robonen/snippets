import { todayISO } from '@brain/std';
import { daysInMonth, monthOf } from '../lib/month';
import type { Month } from '../lib/month';
import type { Expense } from './expense';

/**
 * Повторяющаяся трата: подписка, аренда, абонемент.
 *
 * Правило хранит ОДНО расписание — «каждый месяц N-го». Ни «каждые две недели»,
 * ни «по будням»: у ежемесячных платежей и месячной сводки один период, а
 * произвольный календарь потребовал бы разворачивать правило в набор дат и
 * держать его в согласии с правками задним числом.
 *
 * Правило само по себе денег не тратит. Оно порождает ОБЫЧНУЮ трату, которую
 * можно поправить и удалить: списание могло не пройти, цена — измениться, и
 * запись, которую нельзя тронуть, врала бы про остаток на счёте.
 */
export interface Recurring {
  id: string;
  /** Что списывается: «Подписка на музыку». Становится описанием траты. */
  title: string;
  /** Сумма в КОПЕЙКАХ, как и у траты. */
  amount: number;
  /** id категории; отсутствует — трата без категории. */
  category?: string;
  /** День месяца, 1…31. Больше, чем есть в месяце, зажимается при подстановке. */
  day: number;
  /** Выключенное правило ничего не подставляет, но помнит сумму и день. */
  active: boolean;
  createdAt: number;
}

export const MIN_DAY = 1;
export const MAX_DAY = 31;

/**
 * День списания в конкретном месяце.
 *
 * «Каждое 31-е» в феврале — это последний день февраля, а не 3 марта: платёж
 * принадлежит СВОЕМУ месяцу, и переезд в следующий сдвинул бы его в чужую
 * сводку, а заодно оставил бы февраль без подписки вовсе. Високосный год
 * поэтому меняет дату сам собой: в 2028-м то же правило встанет на 29-е.
 */
export function occurrenceDate(month: Month, day: number): string {
  const last = daysInMonth(month);
  const clamped = Math.min(Math.max(Math.trunc(day), MIN_DAY), last);
  return `${month}-${String(clamped).padStart(2, '0')}`;
}

/** Записана ли уже эта подписка в этом месяце. */
export function isRecorded(rule: Recurring, expenses: readonly Expense[], month: Month): boolean {
  return expenses.some(item => item.recurring === rule.id && monthOf(item.date) === month);
}

/**
 * Что пора записать в этот месяц: активные правила, чей день уже наступил и
 * которых в месяце ещё нет.
 *
 * Сравнение с сегодняшним днём одно на все случаи: для прошедшего месяца дата
 * списания заведомо позади, для будущего — впереди. Поэтому прошлый месяц
 * предлагает всё, будущий — ничего, и отдельных веток для них не нужно.
 */
export function dueRules(
  rules: readonly Recurring[],
  expenses: readonly Expense[],
  month: Month,
  today: string = todayISO(),
): Recurring[] {
  return rules.filter(rule => rule.active
    && occurrenceDate(month, rule.day) <= today
    && !isRecorded(rule, expenses, month));
}

/** Трата по правилу — обычная запись, помеченная ссылкой на своё правило. */
export function draftFromRule(rule: Recurring, month: Month, id: string, now: number): Expense {
  const expense: Expense = {
    id,
    amount: rule.amount,
    date: occurrenceDate(month, rule.day),
    createdAt: now,
    recurring: rule.id,
  };
  if (rule.category !== undefined) expense.category = rule.category;
  const note = rule.title.trim();
  if (note !== '') expense.note = note;
  return expense;
}

/** Сколько уходит «само» каждый месяц, копейки: сумма активных правил. */
export function monthlyLoad(rules: readonly Recurring[]): number {
  let total = 0;
  for (const rule of rules) {
    if (rule.active) total += rule.amount;
  }
  return total;
}

/** Правила по дню списания: так их и читают — «что спишется дальше». */
export function sortRules(rules: readonly Recurring[]): Recurring[] {
  return [...rules].sort((a, b) => a.day - b.day || a.title.localeCompare(b.title, 'ru'));
}
