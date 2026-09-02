import { dayShort, dayTitle, plural, toISODate } from '@brain/std';

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

export function fmtNotes(count: number): string {
  return `${count} ${plural(count, 'заметка', 'заметки', 'заметок')}`;
}

export function fmtWords(count: number): string {
  return `${count} ${plural(count, 'слово', 'слова', 'слов')}`;
}
