import { computed } from 'vue';
import { useDoc, useSpace, useSync } from '@sync/vue';
import type { ComputedRef } from 'vue';
import type { Space } from '@sync/core';
import { sortNotes } from '../entities/note';
import type { Note } from '../entities/note';
import { archiveNote, duplicateNote, removeNote, restoreNote, saveNote } from './actions';
import { NotesModel, readNote } from './models';

/**
 * Хуки заметок поверх моста `@sync/vue`.
 *
 * Снимок всей коллекции, а не подписка на строку: заметок сотни, один файбер на
 * каталог дешевле файбера на заметку, а поиск и упоминания всё равно смотрят на
 * весь список. Фильтр, сортировка и срез живут на Vue-рефах — файберный
 * наблюдатель Vue-рефов не видит.
 *
 * Пространство передаётся аргументом ради виджета: карточку «Заметка дня»
 * рисует ОБОЛОЧКА на экране «Сегодня», а не хост модуля, и `provideSpace` над
 * ней не звучал — `useSpace()` там бросил бы.
 */

export interface NotesState {
  /**
   * ВСЕ заметки, включая архивные: срез выбирает экран через `selectNotes`.
   * Прятать архив здесь значило бы завести второй хук ради вкладки «Архив».
   */
  readonly list: ComputedRef<Note[]>;
  /** Гидрация закончилась: «пусто» уже значит пусто, а не «ленд ещё едет». */
  readonly ready: ComputedRef<boolean>;
}

export function useNotes(space?: Space): NotesState {
  const root = useDoc(NotesModel, undefined, space);
  const state = useSync(() => root.notes.keys().map(id => readNote(id, root.notes(id))));
  return {
    list: computed(() => sortNotes(state.data.value ?? [])),
    ready: computed(() => state.data.value !== undefined && !state.pending.value),
  };
}

export interface NoteActions {
  /** Записать заметку по её адресу, заведя документ, если его ещё не было. */
  save(note: Note): Note;
  remove(id: string): void;
  /** Вернуть удалённую как была — «Отменить» в сообщении об удалении. */
  restore(note: Note): Note;
  archive(note: Note, archived: boolean): Note;
  duplicate(note: Note): Note;
}

export function useActions(): NoteActions {
  const space = useSpace();
  return {
    save: note => saveNote(space, note),
    remove: (id) => {
      removeNote(space, id);
    },
    restore: note => restoreNote(space, note),
    archive: (note, archived) => archiveNote(space, note, archived),
    duplicate: note => duplicateNote(space, note),
  };
}
