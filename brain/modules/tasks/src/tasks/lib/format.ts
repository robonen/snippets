import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { dayShort, parseISODate, plural, shiftISODate } from '@brain/std';

/**
 * Подписи дней и счётчиков, у которых нет домена.
 *
 * Живёт в `lib`, а не в `entities`: слой самый нижний, он не знает ни про
 * задачи, ни про повторы, и именно поэтому им пользуются оба.
 */

/** «3 задачи» — счётчик со словом. */
export function tasksLabel(count: number): string {
  return `${count} ${plural(count, 'задача', 'задачи', 'задач')}`;
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
