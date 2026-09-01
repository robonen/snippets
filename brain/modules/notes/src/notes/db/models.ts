import { atom, model, parts, t } from '@sync/core';
import { scoped } from '@brain/module-kit';
import type { Doc, Type } from '@sync/core';
import { formatTags, parseTags } from '../lib/tags';
import { EMPTY_BODY } from '../entities/body';
import type { NoteBody } from '../entities/body';
import type { Note } from '../entities/note';

/**
 * Модели заметок на `@sync/core`: схема — данные, документ — объект каналов,
 * поле — атом. Снимки (`readNote`/`writeNote`) переводят документ в плоский
 * доменный тип, а `undefined` домена — в `null` модели: у каналов один сентинел.
 *
 * ─── Тело заметки: документ редактора одним атомом ──────────────────────────
 *
 * `body` — документ writekit (`entities/body.ts`) целиком, на проводе — JSON.
 * Никакого промежуточного текстового формата: что редактор показал, то и
 * легло. Цена одного атома честная: две вкладки, правившие тело одновременно,
 * сойдутся не побуквенно, а «победил последний писавший». Побуквенно сойдётся
 * CRDT самого редактора, когда в ленде будут лежать его op-лог и снапшоты
 * (docs/00-plan.md, Р6) — это следующий шаг, и он не про схему, а про
 * транспорт и компакцию.
 */

/**
 * Линза тела: документ ↔ JSON-строка.
 *
 * Своя линза, а не `t.string` с разбором в снимке: атом обязан знать свой тип,
 * иначе «пустое» и мусор от чужого пира каждая читалка различала бы по-своему.
 * Чтение не бросает никогда (контракт линз ядра): не JSON и не документ —
 * `null`, ядро запишет Issue и подставит пустое тело.
 */
const bodyType: Type<NoteBody> = {
  name: 'notes/body',
  blank: EMPTY_BODY,
  decode(raw) {
    if (typeof raw !== 'string') return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isBody(parsed) ? parsed : null;
    }
    catch {
      return null;
    }
  },
  encode(value) {
    return JSON.stringify(value);
  },
  or(blank) {
    return { ...bodyType, blank };
  },
};

function isBody(value: unknown): value is NoteBody {
  return typeof value === 'object' && value !== null
    && (value as { type?: unknown }).type === 'doc'
    && Array.isArray((value as { content?: unknown }).content);
}

/** Имя модуля: из него чеканится адрес ленда, префикс моделей и путь маршрутов. */
export const NOTES_ID = 'notes';

const scope = scoped(NOTES_ID);

export const NoteModel = model(scope('note'), {
  title: atom(t.string),
  body: atom(bodyType),
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
