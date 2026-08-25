import { atom, model, parts, t } from '@sync/core';
import { scoped } from '@brain/module-kit';
import type { Doc } from '@sync/core';
import { formatTags, parseTags } from '../lib/tags';
import type { Note } from '../entities/note';

/**
 * Модели заметок на `@sync/core`: схема — данные, документ — объект каналов,
 * поле — атом. Снимки (`readNote`/`writeNote`) переводят документ в плоский
 * доменный тип, а `undefined` домена — в `null` модели: у каналов один сентинел.
 *
 * ─── Тело заметки: ВРЕМЕННОЕ решение ────────────────────────────────────────
 *
 * `body` — это `atom(t.string)` со всем markdown-текстом целиком. Так не
 * останется: по плану (docs/00-plan.md, Р6) телом владеет редактор
 * `@robonen/writekit` со СВОИМ CRDT, и в ленде вместо строки будут лежать байты
 * его op-лога и снапшотов — `atom(t.bytes)` или пара полей «лог + снимок».
 *
 * Почему сейчас строка, а не сразу байты: риск «два CRDT» (план, Э3, 🔴) не
 * снимается объявлением поля — его снимает спайк транспорта, компакции и
 * холодного открытия. Поле, объявленное вслепую под ненаписанный редактор, всё
 * равно переписывается, а до тех пор врёт про готовность.
 *
 * Что это стоит уже сегодня, честно: тело целиком — один атом, поэтому две
 * вкладки, правившие текст одновременно, сойдутся не побуквенно, а «победил
 * последний писавший». Для одного человека на одном устройстве это приемлемо,
 * для совместного редактирования — нет; ровно за этим и едет writekit.
 *
 * Что переезд затронет: `readNote`/`writeNote` здесь и `lib/links.ts`, который
 * сейчас ищет `[[…]]` в тексте, а тогда будет читать марки документа. Домен
 * (`Note`), экраны, поиск и упоминания переезда не заметят — они уже работают с
 * плоским снимком, а не с каналом.
 */

/** Имя модуля: из него чеканится адрес ленда, префикс моделей и путь маршрутов. */
export const NOTES_ID = 'notes';

const scope = scoped(NOTES_ID);

export const NoteModel = model(scope('note'), {
  title: atom(t.string),
  body: atom(t.string),
  tags: atom(t.string),
  pinned: atom(t.bool),
  /**
   * Убрана с глаз. Отдельным атомом, а не удалением документа: архив обязан
   * пережить синхронизацию как СОСТОЯНИЕ — удаление на одном устройстве и
   * правка на другом сходятся хуже, чем два булевых атома.
   */
  archived: atom(t.bool),
  /** Дата дня у заметки дня; `null` — обычная заметка. */
  daily: atom(t.maybe(t.string)),
  createdAt: atom(t.number),
  updatedAt: atom(t.number),
});

/** Корень ленда: каталог заметок по id. Ничего другого у модуля пока нет. */
export const NotesModel = model(scope('root'), {
  notes: parts(t.string, 'notes/note'),
});

declare module '@sync/core' {
  interface Models {
    'notes/note': typeof NoteModel;
    'notes/root': typeof NotesModel;
  }
}

export type NotesDoc = Doc<'notes/root'>;

// ── Снимки: документ → доменный тип ──────────────────────────────────────────

export function readNote(id: string, doc: Doc<'notes/note'>): Note {
  const note: Note = {
    id,
    title: doc.title(),
    body: doc.body(),
    tags: parseTags(doc.tags()),
    pinned: doc.pinned(),
    archived: doc.archived(),
    createdAt: doc.createdAt(),
    updatedAt: doc.updatedAt(),
  };
  const daily = doc.daily();
  if (daily !== null) note.daily = daily;
  return note;
}

// ── Запись: доменный тип → документ ──────────────────────────────────────────
// Запись равного значения юнитов не порождает, поэтому «сохранить заметку
// целиком» дёшево и не шумит в ленде — сравнивать поля руками не нужно.

export function writeNote(doc: Doc<'notes/note'>, note: Note): void {
  doc.title(note.title);
  doc.body(note.body);
  doc.tags(formatTags(note.tags));
  doc.pinned(note.pinned);
  doc.archived(note.archived);
  doc.daily(note.daily ?? null);
  doc.createdAt(note.createdAt);
  doc.updatedAt(note.updatedAt);
}
