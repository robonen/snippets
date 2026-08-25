import { dayTitle } from '@brain/std';

/**
 * Заметка как доменный объект: плоская запись, с которой работают экраны,
 * поиск и расчёты. Как она лежит в ленде — дело `db/models.ts`.
 */
export interface Note {
  id: string;
  /**
   * Заголовок. Пустой — законное состояние: заметка заводится с курсором в теле,
   * а не с обязательной формой. Он же адрес для `[[…]]`, поэтому его правка
   * меняет и то, кто на заметку ссылается.
   */
  title: string;
  /** Тело в markdown. Временное представление — см. `db/models.ts`. */
  body: string;
  /** Нормализованные теги, порядок — как ввели. */
  tags: string[];
  pinned: boolean;
  /**
   * Убрана с глаз, но не удалена.
   *
   * Архив — не «мягкое удаление»: удалённое восстанавливать нечем, архивное
   * лежит целым и находится на своей вкладке. Разница видна в выдаче: архивная
   * заметка не приходит ни в список, ни в поиск оболочки, ни в упоминания —
   * иначе «убрал с глаз» ничего не убирало бы.
   */
  archived: boolean;
  /** Дата дня (YYYY-MM-DD) у заметки дня; у обычной заметки поля нет. */
  daily?: string;
  createdAt: number;
  updatedAt: number;
}

/** Подпись заметки без заголовка. Пустая строка в списке выглядела бы поломкой. */
export const UNTITLED = 'Без названия';

/**
 * Как заметка подписана на экране.
 *
 * У заметки дня заголовок — ISO-дата: он стабилен и адресуем из текста
 * (`[[2026-08-24]]`), а «Сегодня» назавтра стало бы враньём. Человеку дата
 * показывается человеческой — но только показывается, в данные это не течёт.
 */
export function noteLabel(note: Note, today?: string): string {
  if (note.daily !== undefined && note.title === note.daily) return dayTitle(note.daily, today);
  return note.title === '' ? UNTITLED : note.title;
}

// ── Что показывает список ────────────────────────────────────────────────────

/** По чему упорядочен список. Закрепление сильнее любого из порядков. */
export type NoteSort = 'updated' | 'created' | 'title';

/**
 * Какую часть коллекции смотрим.
 *
 * `pinned` — не сортировка, а именно срез: «что я отложил» — самостоятельный
 * вопрос, и отвечать на него прокруткой общего списка значит не отвечать.
 */
export type NoteScope = 'active' | 'pinned' | 'archived';

export interface NoteFilter {
  readonly query?: string;
  /**
   * Теги сужают выдачу (И), а не расширяют (ИЛИ): фильтр по тегам — способ
   * добраться до одной заметки, и второй выбранный тег обязан приближать к ней,
   * а не удваивать список.
   */
  readonly tags?: readonly string[];
  readonly scope?: NoteScope;
  readonly sort?: NoteSort;
}

/**
 * Порядок списка: закреплённые сверху, дальше — по выбранному ключу.
 *
 * Хвост сравнения — `createdAt` и `id`: `keys()` отдаёт ключи в порядке
 * вставки, а он у двух устройств разный, и без явного добития порядок списка
 * зависел бы от того, чей юнит приехал первым.
 *
 * По названию сравниваются ЗАГОЛОВКИ, а не подписи из `noteLabel`: тот
 * подставляет «Сегодня» и «Без названия», и список упорядочился бы по словам,
 * которых в данных нет, — а назавтра сам собой переехал бы.
 */
export function sortNotes(notes: readonly Note[], sort: NoteSort = 'updated'): Note[] {
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (sort === 'title') {
      // Безымянные — в конец: в алфавите пустой строке место в начале, а в
      // списке «Без названия» наверху выглядит как сбой сортировки.
      const byEmpty = Number(a.title === '') - Number(b.title === '');
      if (byEmpty !== 0) return byEmpty;
      const byTitle = a.title.toLowerCase().localeCompare(b.title.toLowerCase(), 'ru');
      if (byTitle !== 0) return byTitle;
    }
    if (sort !== 'created' && a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
    if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
    if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
    return a.id.localeCompare(b.id);
  });
}

export function inScope(note: Note, scope: NoteScope): boolean {
  if (scope === 'archived') return note.archived;
  if (scope === 'pinned') return note.pinned && !note.archived;
  return !note.archived;
}

/** Есть ли у заметки ВСЕ перечисленные теги. */
export function hasTags(note: Note, tags: readonly string[]): boolean {
  return tags.every(tag => note.tags.includes(tag));
}

/**
 * Совпадение с запросом по заголовку и тегам. Тело не ищется: его разбор — уже
 * полнотекстовый поиск, и делать его наивным `includes` по всем заметкам значит
 * обещать больше, чем даёшь.
 */
export function matchesQuery(note: Note, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;

  // «#работа» — явный поиск по тегу: решётка в заголовке всё равно не живёт.
  if (needle.startsWith('#')) {
    const tag = needle.slice(1);
    return tag !== '' && note.tags.some(item => item.includes(tag));
  }

  return note.title.toLowerCase().includes(needle)
    || note.tags.some(item => item.includes(needle));
}

/**
 * Отфильтрованный и упорядоченный список — то, что показывает экран.
 *
 * Срез по умолчанию — `active`: архив не приходит ни в один запрос, пока его не
 * попросили явно. Это единственное место, где решается, видна ли архивная
 * заметка, — поэтому его же зовёт и выдача в общий поиск оболочки.
 */
export function selectNotes(notes: readonly Note[], filter: NoteFilter = {}): Note[] {
  const { query = '', tags = [], scope = 'active', sort = 'updated' } = filter;
  return sortNotes(
    notes.filter(note => inScope(note, scope) && hasTags(note, tags) && matchesQuery(note, query)),
    sort,
  );
}

/** Поиск по активным заметкам — короткая форма `selectNotes` для одного запроса. */
export function searchNotes(notes: readonly Note[], query: string): Note[] {
  return selectNotes(notes, { query });
}

/**
 * Совпадает ли содержимое двух снимков.
 *
 * Нужно автосохранению: открытие заметки заполняет поля формы и выглядит как
 * правка, а запись без изменений подняла бы `updatedAt` и увела заметку наверх
 * списка просто потому, что её прочитали.
 */
export function sameContent(a: Note, b: Note): boolean {
  return a.title === b.title
    && a.body === b.body
    && a.pinned === b.pinned
    && a.archived === b.archived
    && a.tags.length === b.tags.length
    && a.tags.every((tag, index) => tag === b.tags[index]);
}

const SNIPPET_LIMIT = 140;

/**
 * Первая содержательная строка тела для списка.
 *
 * Разметка снимается грубо и только с начала строки: это подпись под
 * заголовком, а не рендер markdown — полноценный вывод приедет с редактором.
 */
export function noteSnippet(body: string, limit: number = SNIPPET_LIMIT): string {
  for (const raw of body.split('\n')) {
    const line = raw.replace(/^[\s>#*\-+]+/u, '').replaceAll(/\[\[|\]\]/gu, '').trim();
    if (line === '') continue;
    return line.length > limit ? `${line.slice(0, limit).trimEnd()}…` : line;
  }
  return '';
}

export interface NoteStats {
  readonly words: number;
  readonly chars: number;
}

/**
 * Сколько написано. Слова — куски между пробелами, символы — кодовые точки.
 *
 * Кодовые точки, а не `length`: у строки с эмодзи и составными буквами
 * `length` считает суррогатные пары, и счётчик показал бы вдвое больше, чем
 * человек набрал.
 */
export function noteStats(body: string): NoteStats {
  const words = body.split(/\s+/u).filter(word => word !== '').length;
  return { words, chars: [...body].length };
}
