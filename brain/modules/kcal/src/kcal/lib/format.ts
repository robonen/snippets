import { parseISODate } from '@brain/std';

const kcalFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const gramFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const weekdayFormat = new Intl.DateTimeFormat('ru-RU', { weekday: 'short' });

/** «1 840» — целые ккал с неразрывной группировкой. */
export function fmtKcal(value: number): string {
  return kcalFormat.format(Math.round(value));
}

/** «82,5» — граммы с одним знаком, без хвоста «,0». */
export function fmtG(value: number): string {
  return gramFormat.format(value);
}

/**
 * «пн» — подпись столбика в полосе недели.
 *
 * День недели, а не число месяца: полоса стоит рядом с сегодняшним днём и
 * отвечает на вопрос «как шла неделя», а в неделе ориентируются по вт/ср, а не
 * по 12/13.
 */
export function fmtWeekday(iso: string): string {
  return weekdayFormat.format(parseISODate(iso));
}
