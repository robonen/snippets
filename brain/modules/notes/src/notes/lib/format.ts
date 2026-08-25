import { dayShort, dayTitle, toISODate } from '@brain/std';

/**
 * Когда заметку трогали в последний раз.
 *
 * Точность до дня, а не до минуты: список читают глазами, и «Вчера» отвечает на
 * вопрос «свежее или нет» быстрее, чем «14:32».
 */
export function fmtWhen(at: number): string {
  return dayTitle(toISODate(new Date(at)));
}

/** Дата цифрами — для плиток сводки, где длинная подпись ломает вёрстку. */
export function fmtDate(at: number): string {
  return dayShort(toISODate(new Date(at)));
}

/**
 * Русское склонение по числу.
 *
 * Считается по последним двум разрядам, а не по последней цифре: у 11–14
 * окончание не такое, как у 1–4, и «11 заметка» — самая заметная опечатка
 * интерфейса, которую можно не писать.
 */
export function plural(count: number, one: string, few: string, many: string): string {
  const abs = Math.abs(count) % 100;
  if (abs >= 11 && abs <= 14) return many;
  const last = abs % 10;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

export function fmtNotes(count: number): string {
  return `${count} ${plural(count, 'заметка', 'заметки', 'заметок')}`;
}

export function fmtWords(count: number): string {
  return `${count} ${plural(count, 'слово', 'слова', 'слов')}`;
}
