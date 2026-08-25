import { atom, list, model, parts, t } from '@sync/core';
import { scoped } from '@brain/module-kit';
import type { Doc } from '@sync/core';
import { LINK_STATUSES } from '../entities/link';
import type { Bookmark } from '../entities/link';

/**
 * Модели закладок на `@sync/core`: схема — данные, документ — объект каналов,
 * поле — атом.
 *
 * Имена несут префикс модуля: реестр `Models` один на приложение, и без
 * префикса `link` столкнулся бы с чужим `link` при первом же новом модуле.
 *
 * Теги — `list`, а не строка «a,b,c»: список сливается ПОЭЛЕМЕНТНО, и тег,
 * добавленный на телефоне, переживёт тег, добавленный в это же время на
 * ноутбуке. Строка проиграла бы одну правку целиком по LWW.
 */

const scope = scoped('bookmarks');

export const LinkModel = model(scope('link'), {
  url: atom(t.string),
  title: atom(t.string),
  note: atom(t.maybe(t.string)),
  tags: list(t.string),
  status: atom(t.enum(LINK_STATUSES).or('unread')),
  addedAt: atom(t.number),
  readAt: atom(t.maybe(t.number)),
});

/** Корень ленда: каталог ссылок по id. */
export const BookmarksModel = model(scope('root'), {
  links: parts(t.string, 'bookmarks/link'),
});

declare module '@sync/core' {
  interface Models {
    'bookmarks/link': typeof LinkModel;
    'bookmarks/root': typeof BookmarksModel;
  }
}

// ── Снимки: документ → доменный тип ──────────────────────────────────────────
// Опциональность домена (`undefined`) отображается в `null` модели и обратно:
// у каналов один сентинел, а доменный тип не обязан знать про хранилище.

export function readLink(id: string, doc: Doc<'bookmarks/link'>): Bookmark {
  const link: Bookmark = {
    id,
    url: doc.url(),
    title: doc.title(),
    tags: [...doc.tags()],
    status: doc.status(),
    addedAt: doc.addedAt(),
  };
  const note = doc.note();
  if (note !== null) link.note = note;
  const readAt = doc.readAt();
  if (readAt !== null) link.readAt = readAt;
  return link;
}

// ── Запись: доменный тип → документ ──────────────────────────────────────────
// Запись равного значения юнитов не порождает, поэтому «сохранить форму
// целиком» дёшево и не шумит в ленде.

export function writeLink(doc: Doc<'bookmarks/link'>, link: Bookmark): void {
  doc.url(link.url);
  doc.title(link.title);
  doc.note(link.note ?? null);
  doc.tags.set(link.tags);
  doc.status(link.status);
  doc.addedAt(link.addedAt);
  doc.readAt(link.readAt ?? null);
}
