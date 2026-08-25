import { computed } from 'vue';
import type { ComputedRef } from 'vue';
import { useDoc, useSpace, useValue } from '@sync/vue';
import { withStatus } from '../entities/link';
import type { Bookmark, LinkStatus } from '../entities/link';
import { BookmarksModel, readLink, writeLink } from './models';

/**
 * Хуки закладок поверх моста `@sync/vue`.
 *
 * Снимок ЦЕЛОЙ коллекции, а не подписка на строку: закладок сотни, один файбер
 * на каталог дешевле файбера на запись. И главное — фильтры по статусу и тегам
 * живут на Vue-рефах, а файберный наблюдатель Vue-рефов не видит.
 */

/** Все закладки, новые сверху. */
export function useLinks(): ComputedRef<Bookmark[]> {
  const root = useDoc(BookmarksModel);
  const snapshot = useValue(() => root.links.keys().map(id => readLink(id, root.links(id))));
  return computed(() => [...(snapshot.value ?? [])].sort((a, b) => b.addedAt - a.addedAt));
}

// ── Запись ───────────────────────────────────────────────────────────────────
// Мутаций как понятия нет: запись — прямой вызов каналов в транзакции
// (`space.edit`: одна метка времени и один сброс на всё).

export interface BookmarksActions {
  saveLink(link: Bookmark): void;
  setStatus(link: Bookmark, status: LinkStatus, now?: number): void;
  removeLink(id: string): void;
}

export function useActions(): BookmarksActions {
  const space = useSpace();
  const root = useDoc(BookmarksModel);

  return {
    saveLink(link) {
      space.edit(() => writeLink(root.links(link.id), link));
    },
    setStatus(link, status, now = Date.now()) {
      space.edit(() => writeLink(root.links(link.id), withStatus(link, status, now)));
    },
    removeLink(id) {
      root.links.delete(id);
    },
  };
}
