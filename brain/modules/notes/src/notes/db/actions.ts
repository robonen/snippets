import { newId } from '@brain/module-kit';
import { todayISO } from '@brain/std';
import type { Space } from '@sync/core';
import { EMPTY_BODY } from '../entities/body';
import type { Note } from '../entities/note';
import { NotesModel, readNote, writeNote } from './models';

/**
 * Операции над заметками — обычными функциями от `Space`, а не хуками.
 *
 * Так они доступны обеим сторонам контракта: экраны берут их через
 * `db/composables.ts`, а команды палитры зовут прямо — у `ModuleCommand.run`
 * есть `ctx.space`, но нет ни компонента, ни setup-контекста.
 *
 * ─── Заметка живёт по АДРЕСУ ────────────────────────────────────────────────
 *
 * Ключ заметки чеканится ДО того, как появится документ: ссылка «Новая» ведёт
 * на свободный адрес, и заметка заводится первой записью по нему. Это не
 * кокетство, а следствие того, что у модуля нет своего роутера: перехода
 * «создали → перешли» не бывает, бывает переход по ссылке, и данные догоняют.
 *
 * Побочный эффект приятный: заметка, в которую не написали ни буквы, не
 * создаётся вовсе — ни в ленде, ни в списке. Убирать за собой не приходится.
 */

/** Что задаёт создающий; остальное добирается значениями по умолчанию. */
export type NoteDraft = Partial<Omit<Note, 'id'>>;

const DAILY_PREFIX = 'daily:';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

/** Свободный адрес под новую заметку. Документа по нему ещё нет. */
export function newNoteId(): string {
  return newId();
}

/**
 * Адрес заметки дня чеканится из даты, а не выдаётся случайным.
 *
 * Это ровно тот случай, когда одинаковый ключ нужен: два устройства, открывшие
 * «Заметку дня» оффлайн, сойдутся в ОДИН документ, а со случайными id получили
 * бы две заметки на один день и молча разъехались.
 */
export function dailyId(date: string): string {
  return `${DAILY_PREFIX}${date}`;
}

/** Дата, если адрес принадлежит заметке дня. Форма проверяется: `daily:чушь` — не день. */
export function dailyDateOf(id: string): string | undefined {
  if (!id.startsWith(DAILY_PREFIX)) return undefined;
  const date = id.slice(DAILY_PREFIX.length);
  return ISO_DATE.test(date) ? date : undefined;
}

/**
 * Заготовка заметки по адресу — то, что экран показывает, пока в ленде ничего
 * нет. Адрес заметки дня сам говорит, что это за заметка, поэтому заголовок и
 * дата берутся из него.
 *
 * Заголовок заметки дня — ISO-дата: он стабилен и адресуем из текста
 * (`[[2026-08-24]]`), тогда как «Сегодня» назавтра стало бы враньём. Человеку
 * дата показывается через `noteLabel` — на экране, а не в данных.
 */
export function blankNote(id: string, now: number = Date.now()): Note {
  const date = dailyDateOf(id);
  return {
    id,
    title: date ?? '',
    body: EMPTY_BODY,
    tags: [],
    pinned: false,
    archived: false,
    ...(date !== undefined && { daily: date }),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Сохранить заметку целиком, подняв метку правки. Документ заводится, если по
 * адресу его ещё не было.
 *
 * Целиком, а не патчем: форма экрана и так держит все поля, а «победил
 * последний писавший» у атомов работает по полю — соседняя вкладка потеряет
 * только то поле, которое правила одновременно.
 */
export function saveNote(space: Space, note: Note, now: number = Date.now()): Note {
  return put(space, { ...note, updatedAt: now });
}

export function removeNote(space: Space, id: string): void {
  space.root(NotesModel).notes.delete(id);
}

/**
 * Вернуть удалённую заметку такой, какой она была, — «Отменить» в сообщении об
 * удалении.
 *
 * Метка правки НЕ поднимается: восстановление возвращает заметку на её место в
 * списке, а не выносит наверх как только что написанную.
 */
export function restoreNote(space: Space, note: Note): Note {
  return put(space, note);
}

/** Убрать с глаз или вернуть обратно. */
export function archiveNote(space: Space, note: Note, archived: boolean, now: number = Date.now()): Note {
  return saveNote(space, { ...note, archived }, now);
}

/** Приписка к заголовку копии: без неё две одинаковые строки в списке неразличимы. */
const COPY_SUFFIX = ' (копия)';

/**
 * Копия заметки под новым адресом.
 *
 * Что копия НЕ наследует: закрепление, архив и признак дня. Закрепление — про
 * место в списке, а не про содержимое; второй заметки того же дня не бывает —
 * адрес дня чеканится из даты, и копия становится обычной заметкой.
 */
export function duplicateNote(space: Space, note: Note, now: number = Date.now()): Note {
  return put(space, {
    id: newNoteId(),
    title: `${noteTitleOr(note)}${COPY_SUFFIX}`,
    body: note.body,
    // Свой массив, а не общий с оригиналом: два снимка не должны править друг друга.
    tags: [...note.tags],
    pinned: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
  });
}

function noteTitleOr(note: Note): string {
  return note.title === '' ? (note.daily ?? 'Без названия') : note.title;
}

/** Есть ли уже документ по адресу: заготовка не должна затирать написанное. */
export function noteExists(space: Space, id: string): boolean {
  return space.root(NotesModel).notes.has(id);
}

/** Завести заметку по готовому адресу — экран уже знает, куда пойдёт. */
export function createNoteAt(space: Space, id: string, draft: NoteDraft = {}, now: number = Date.now()): Note {
  return put(space, { ...blankNote(id, now), ...draft, id });
}

/** Завести заметку сразу — для команды палитры, у которой нет экрана. */
export function createNote(space: Space, draft: NoteDraft = {}, now: number = Date.now()): Note {
  return createNoteAt(space, newNoteId(), draft, now);
}

/** Заметка дня: открыть, если есть, иначе завести. Идемпотентно по дате. */
export function dailyNote(space: Space, date: string = todayISO(), now: number = Date.now()): Note {
  const root = space.root(NotesModel);
  const id = dailyId(date);
  if (root.notes.has(id)) return readNote(id, root.notes(id));
  return put(space, blankNote(id, now));
}

function put(space: Space, note: Note): Note {
  const root = space.root(NotesModel);
  space.edit(() => {
    writeNote(root.notes(note.id), note);
  });
  return note;
}
