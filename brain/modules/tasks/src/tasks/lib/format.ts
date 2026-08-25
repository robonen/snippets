import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { dayShort, parseISODate, shiftISODate } from '@brain/std';

/**
 * Форматирование, у которого нет домена: русские формы числительных и подписи
 * дней.
 *
 * Живёт в `lib`, а не в `entities`: слой самый нижний, он не знает ни про
 * задачи, ни про повторы, и именно поэтому им пользуются оба.
 */

const RU_PLURAL = new Intl.PluralRules('ru-RU');

/**
 * Категория CLDR → номер формы. Таблицей, а не `if`-ами: у русского пять
 * категорий из шести, и молча забытая `many` дала бы «5 задачи».
 */
const FORM_INDEX: Record<Intl.LDMLPluralRule, 0 | 1 | 2> = {
  one: 0,
  two: 1,
  few: 1,
  many: 2,
  other: 2,
  zero: 2,
};

/** Форма по числу: `['день', 'дня', 'дней']` — «один / два / пять». */
export function plural(count: number, forms: readonly [string, string, string]): string {
  return forms[FORM_INDEX[RU_PLURAL.select(count)]];
}

/** «3 задачи» — счётчик со словом. */
export function tasksLabel(count: number): string {
  return `${count} ${plural(count, ['задача', 'задачи', 'задач'])}`;
}

/** «2 из 5» — прогресс чек-листа в строке. */
export function stepsLabel(done: number, total: number): string {
  return `${done} из ${total}`;
}

/**
 * «сб, 29 августа» — календарная подпись дня.
 *
 * Отличается от `dayTitle` из `@brain/std` тем, что НЕ подменяет ближние дни
 * словами: там, где подпись стоит рядом со словом «Завтра», её работа — сказать,
 * какое это число.
 */
export function calendarDay(iso: string): string {
  return format(parseISODate(iso), 'EEEEEE, d MMMM', { locale: ru });
}

/**
 * Срок в строке списка: ближние дни словом, остальные числом («29.08»).
 *
 * Слово отвечает на вопрос «когда» без перевода, но работает ровно на трёх днях:
 * «пт, 29 августа» через две недели требует того же счёта в уме, что и «29.08»,
 * а места в строке занимает втрое больше. Точную дату показывает форма правки —
 * список отвечает на вопрос «горит или нет».
 */
export function dueLabel(iso: string, today: string): string {
  if (iso === today) return 'Сегодня';
  if (iso === shiftISODate(today, 1)) return 'Завтра';
  if (iso === shiftISODate(today, -1)) return 'Вчера';
  return dayShort(iso);
}

/** Подпись дня в шапке экрана: «пятница, 24 августа». */
export function dayHeading(iso: string): string {
  return format(parseISODate(iso), 'EEEE, d MMMM', { locale: ru });
}
