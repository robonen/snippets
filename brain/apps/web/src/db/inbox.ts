import { computed } from 'vue';
import { useSpaces } from '@brain/module-kit';
import { useValue } from '@sync/vue';
import type { ComputedRef } from 'vue';
import type { Space } from '@sync/core';
import { MetaModel, readInbox, writeInbox } from './meta';
import type { InboxItem } from './meta';

/**
 * Инбокс поверх собственного ленда.
 *
 * Хуки берут пространство через `useSpaces().space(INBOX_ID)`, а не через
 * `useDoc()`: `useDoc` отдаёт пространство ТЕКУЩЕГО модуля, а инбокс общий и
 * доступен с любого экрана, включая экраны модулей.
 *
 * Ленд свой, а не мета: пойманные мысли и ссылки — пользовательские данные, и
 * они шифруются наравне с модульными (docs/01-security.md §4). В мета-ленде,
 * который лежит открытым, остались только обёртки ключа.
 */

/** Имя ленда инбокса. Из него же чеканится адрес — см. `landId`. */
export const INBOX_ID = 'inbox';

export function useInbox(): {
  pending: ComputedRef<InboxItem[]>;
  filed: ComputedRef<InboxItem[]>;
} {
  const space = useSpaces().space(INBOX_ID);
  const root = space.root(MetaModel);
  const snapshot = useValue(() => root.inbox.keys().map(id => readInbox(id, root.inbox(id))));

  const all = computed(() => [...(snapshot.value ?? [])].sort((a, b) => b.createdAt - a.createdAt));
  return {
    pending: computed(() => all.value.filter(item => item.filedAt === undefined)),
    filed: computed(() => all.value.filter(item => item.filedAt !== undefined)),
  };
}

export interface InboxActions {
  capture(input: { text: string; url?: string; source?: string }): string | null;
  file(id: string, moduleId: string): void;
  unfile(id: string): void;
  remove(id: string): void;
}

export function useInboxActions(): InboxActions {
  const space = useSpaces().space(INBOX_ID);
  return inboxActions(space);
}

/** То же вне компонента — для обработчика share target, которому нужен захват до отрисовки. */
export function inboxActions(space: Space): InboxActions {
  const root = space.root(MetaModel);

  return {
    capture({ text, url, source }) {
      const clean = text.trim();
      // Пустой захват — это промах по кнопке, а не запись: в CRDT удалить его
      // сложнее, чем не создавать.
      if (clean === '' && (url ?? '') === '') return null;

      const id = crypto.randomUUID();
      space.edit(() => {
        writeInbox(root.inbox(id), {
          id,
          text: clean,
          ...(url !== undefined && url !== '' && { url }),
          source: source ?? 'вручную',
          createdAt: Date.now(),
        });
      });
      return id;
    },
    file(id, moduleId) {
      if (!root.inbox.has(id)) return;
      space.edit(() => {
        const doc = root.inbox(id);
        doc.filedAt(Date.now());
        doc.filedTo(moduleId);
      });
    },
    unfile(id) {
      if (!root.inbox.has(id)) return;
      space.edit(() => {
        const doc = root.inbox(id);
        doc.filedAt(0);
        doc.filedTo('');
      });
    },
    remove(id) {
      root.inbox.delete(id);
    },
  };
}
