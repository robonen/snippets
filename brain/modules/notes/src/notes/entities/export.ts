import { toISODate } from '@brain/std';
import { toMarkdown } from '../editor/markdown';
import { UNTITLED } from './note';
import type { Note } from './note';

/**
 * Выгрузка заметок в markdown.
 *
 * Формат выбран так, чтобы файл читался человеком и открывался чужим
 * редактором: заголовок первого уровня, строка метаданных курсивом, тело как
 * есть. Никакого своего контейнера — выгрузка нужна ровно затем, чтобы данные
 * можно было унести из приложения, а собственный формат унести не даёт.
 *
 * Обратного разбора здесь нет и не планируется: импорт — это слияние с тем, что
 * уже лежит в ленде, то есть решение про конфликты, а не разбор текста.
 */

/** Что отделяет заметки друг от друга в общем файле. */
const SEPARATOR = '\n\n---\n\n';

/**
 * Заголовок для файла — сырой, без человеческих подстановок.
 *
 * `noteLabel` здесь не годится: он показывает заметку дня как «Сегодня», а файл
 * переживает сегодня. У заметки дня заголовок и так ISO-дата.
 */
function exportTitle(note: Note): string {
  return note.title.trim() === '' ? UNTITLED : note.title.trim();
}

/** Дата правки и теги одной строкой: то, что иначе потерялось бы при выгрузке. */
function metaLine(note: Note): string {
  const parts = [`*${toISODate(new Date(note.updatedAt))}*`];
  if (note.tags.length > 0) parts.push(note.tags.map(tag => `#${tag}`).join(' '));
  return parts.join(' · ');
}

export function noteToMarkdown(note: Note): string {
  const blocks = [`# ${exportTitle(note)}`, metaLine(note)];
  const body = toMarkdown(note.body).trim();
  if (body !== '') blocks.push(body);
  return blocks.join('\n\n');
}

/**
 * Все заметки в один файл, разделённые горизонтальной чертой.
 *
 * Один файл, а не архив из многих: выгрузку чаще всего открывают, чтобы
 * прочитать и найти, — а не чтобы разложить обратно по папкам.
 */
export function notesToMarkdown(notes: readonly Note[]): string {
  if (notes.length === 0) return '';
  return `${notes.map(noteToMarkdown).join(SEPARATOR)}\n`;
}

/** Имя файла выгрузки. Латиницей: имя уезжает в чужую файловую систему. */
export function exportName(at: Date): string {
  return `notes-${toISODate(at)}.md`;
}
