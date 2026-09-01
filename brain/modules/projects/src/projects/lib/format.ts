/**
 * Форматирование денег, месяцев и периодов — всё, что экраны показывают
 * человеку, но что не является расчётом (расчёты — в `entities/project.ts`).
 *
 * Месяц проекта — строка `YYYY-MM`: у проекта нет точного дня начала, а
 * «февраль — март 2023» — ровно та точность, с которой о нём помнят.
 */

const money = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 });
const monthLong = new Intl.DateTimeFormat('ru-RU', { month: 'long' });
const dayNumeric = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });

/** «50 000 ₽». Без копеек: оплаты за проекты копейками не считают. */
export function fmtMoney(value: number): string {
  return money.format(value);
}

/** Название месяца в именительном падеже: 1 → «январь». */
export function monthName(index: number): string {
  return monthLong.format(new Date(2000, index - 1, 1));
}

/** Все двенадцать — для выбора месяца. */
export const MONTHS: readonly string[] = Array.from({ length: 12 }, (_, at) => monthName(at + 1));

/** Разобрать `YYYY-MM`. Мусор — `null`: строка приходит из ленда, а ленд может быть чужим. */
export function parseMonth(value: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/u.exec(value);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? { year, month } : null;
}

export function toMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** «февраль 2023». Нечитаемое значение показывается как есть, а не прячется. */
export function fmtMonth(value: string): string {
  const parsed = parseMonth(value);
  return parsed === null ? value : `${monthName(parsed.month)} ${parsed.year}`;
}

/**
 * Период проекта одной строкой: год пишется один раз, если он общий.
 *
 *   «февраль — март 2023», «март 2023 — октябрь 2024», «февраль 2023», «с мая 2023».
 */
export function fmtPeriod(startedAt: string, endedAt?: string): string {
  const start = parseMonth(startedAt);
  if (start === null) return startedAt;
  if (endedAt === undefined) return `с ${genitive(start.month)} ${start.year}`;
  const end = parseMonth(endedAt);
  if (end === null) return fmtMonth(startedAt);
  if (start.year === end.year && start.month === end.month) return fmtMonth(startedAt);
  if (start.year === end.year) return `${monthName(start.month)} — ${monthName(end.month)} ${start.year}`;
  return `${monthName(start.month)} ${start.year} — ${monthName(end.month)} ${end.year}`;
}

/** Родительный падеж для «с мая»: у Intl такой формы нет. */
const GENITIVE = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

export function genitive(month: number): string {
  return GENITIVE[month - 1] ?? '';
}

/** Сколько месяцев длится период, включая оба края: февраль — март = 2. */
export function monthsBetween(from: string, to: string): number {
  const a = parseMonth(from);
  const b = parseMonth(to);
  if (a === null || b === null) return 0;
  return Math.max(0, (b.year - a.year) * 12 + (b.month - a.month) + 1);
}

/** «2 мес.», «1 г. 8 мес.», «3 г.». */
export function fmtDuration(months: number): string {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} г.`);
  if (rest > 0 || years === 0) parts.push(`${rest} мес.`);
  return parts.join(' ');
}

/** «01.04.2023» из ISO-даты; мусор — как есть. */
export function fmtDay(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(iso);
  if (match === null) return iso;
  return dayNumeric.format(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

/**
 * Русское склонение по числу. Считается по последним двум разрядам: у 11–14
 * окончание не такое, как у 1–4.
 */
export function plural(count: number, one: string, few: string, many: string): string {
  const abs = Math.abs(count) % 100;
  if (abs >= 11 && abs <= 14) return many;
  const last = abs % 10;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

export function fmtProjects(count: number): string {
  return `${count} ${plural(count, 'проект', 'проекта', 'проектов')}`;
}

export function fmtPeople(count: number): string {
  return `${count} ${plural(count, 'человек', 'человека', 'человек')}`;
}
