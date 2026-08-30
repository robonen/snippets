import { atom, model, parts, t } from '@sync/core';
import type { Doc } from '@sync/core';

/**
 * Модели инбокса — собственный ленд оболочки.
 *
 * Отдельный от модулей ленд нужен именно инбоксу. Захват обязан работать
 * раньше решения, КУДА это ляжет: мысль, ссылка или строчка с телефона
 * попадают сюда, а разбор превращает их в заметку, задачу или закладку. Держи
 * инбокс в ленде заметок — и захват ссылки требовал бы включённых заметок.
 *
 * Имя модели с префиксом `meta/`, как у любого модуля: реестр `Models` один на
 * приложение, и оболочка в нём не привилегированный житель.
 */

export const InboxModel = model('meta/inbox', {
  /** Что захватили: текст, заголовок ссылки или расшифровка. */
  text: atom(t.string),
  /** Ссылка, если захват пришёл из шаринга. Пусто — значит, это просто текст. */
  url: atom(t.string),
  /** Откуда: «ручной ввод», «шаринг», имя приложения. */
  source: atom(t.string),
  createdAt: atom(t.number),
  /**
   * Момент разбора. Ноль — не разобрано.
   *
   * Разобранное не удаляется сразу: связь с тем, во что оно превратилось,
   * полезна в ревью недели, а удаление в CRDT необратимо.
   */
  filedAt: atom(t.number),
  /** Куда разобрали: id модуля. Пусто у неразобранного. */
  filedTo: atom(t.string),
});

export const MetaModel = model('meta/root', {
  inbox: parts(t.string, 'meta/inbox'),
});

declare module '@sync/core' {
  interface Models {
    'meta/inbox': typeof InboxModel;
    'meta/root': typeof MetaModel;
  }
}

export interface InboxItem {
  id: string;
  text: string;
  url?: string;
  source: string;
  createdAt: number;
  filedAt?: number;
  filedTo?: string;
}

export function readInbox(id: string, doc: Doc<'meta/inbox'>): InboxItem {
  const item: InboxItem = {
    id,
    text: doc.text(),
    source: doc.source(),
    createdAt: doc.createdAt(),
  };
  const url = doc.url();
  if (url !== '') item.url = url;
  const filedAt = doc.filedAt();
  if (filedAt > 0) {
    item.filedAt = filedAt;
    item.filedTo = doc.filedTo();
  }
  return item;
}

export function writeInbox(doc: Doc<'meta/inbox'>, item: InboxItem): void {
  doc.text(item.text);
  doc.url(item.url ?? '');
  doc.source(item.source);
  doc.createdAt(item.createdAt);
  doc.filedAt(item.filedAt ?? 0);
  doc.filedTo(item.filedTo ?? '');
}
