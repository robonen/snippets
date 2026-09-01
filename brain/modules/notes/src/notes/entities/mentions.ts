import { extractLinks, linkKey } from '../lib/links';
import { bodyText } from './body';
import { sortNotes } from './note';
import type { Note } from './note';

/**
 * Кто ссылается на заметку.
 *
 * Связь считается ПО ЗАГОЛОВКУ, а не по id: `[[Планы на неделю]]` пишут руками,
 * и в момент письма заметки может ещё не быть. Обратная сторона честная —
 * переименование заголовка рвёт входящие ссылки; чинить это будет редактор,
 * который начнёт хранить в марке адрес, а не текст.
 *
 * Обход всего списка на каждый показ — осознанно: заметок у одного человека
 * тысячи, а не миллионы, и индекс обратных ссылок пришлось бы держать в ленде
 * согласованным при каждой правке тела.
 *
 * Архивные не считаются: архив — это «убрано с глаз», и связь оттуда вернула бы
 * на экран ровно то, что человек убрал.
 */
export function mentionsOf(note: Note, all: readonly Note[]): Note[] {
  const key = linkKey(note.title);
  if (key === '') return [];

  return sortNotes(all.filter(other =>
    other.id !== note.id
    && !other.archived
    && extractLinks(bodyText(other.body)).some(link => linkKey(link) === key)));
}
