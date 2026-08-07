import { addDays, format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';

/** Локальная дата в формате YYYY-MM-DD (не UTC — день дневника «человеческий»). */
export function toISODate(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

export function todayISO(): string {
  return toISODate(new Date());
}

/** Локальная полночь указанного дня (date-fns трактует date-only строки как локальные). */
export function parseISODate(iso: string): Date {
  return parseISO(iso);
}

export function shiftISODate(iso: string, days: number): string {
  return toISODate(addDays(parseISODate(iso), days));
}

/** «Сегодня» / «Вчера» / «сб, 1 августа» — ru-локаль даёт родительный падеж месяца. */
export function dayTitle(iso: string, today: string = todayISO()): string {
  if (iso === today) return 'Сегодня';
  if (iso === shiftISODate(today, -1)) return 'Вчера';
  if (iso === shiftISODate(today, 1)) return 'Завтра';
  return format(parseISODate(iso), 'EEEEEE, d MMMM', { locale: ru });
}

/** Короткая подпись дня для графиков: «5.08». */
export function dayShort(iso: string): string {
  return format(parseISODate(iso), 'd.MM');
}

/** Последние `count` дней, включая сегодняшний, по возрастанию. */
export function lastDays(count: number, today: string = todayISO()): string[] {
  const end = parseISODate(today);
  const days: string[] = [];
  for (let i = count - 1; i >= 0; i--) days.push(toISODate(addDays(end, -i)));
  return days;
}
