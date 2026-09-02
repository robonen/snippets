/**
 * `@brain/std` — хелперы, которые нужны нескольким модулям и не относятся ни к
 * домену, ни к интерфейсу.
 *
 * Планка входа сюда высокая: как только функция начинает знать про калории,
 * заметки или задачи, её место в модуле. Всё, что уже есть в
 * `@robonen/stdlib`, сюда не дублируется.
 */

export { dayShort, dayTitle, lastDays, parseISODate, shiftISODate, toISODate, todayISO } from './dates';
export { round1, roundTo } from './numbers';
export { plural } from './text';
