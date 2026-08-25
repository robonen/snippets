import { decodeBytes, encodeBytes } from '@brain/auth';
import type { WrappedDek } from '@brain/auth';
import type { Doc, Space } from '@sync/core';
import { MetaModel } from '../db/meta';

/**
 * Обёртки ключа в ленде: чтение, запись, удаление.
 *
 * Слой существует ради одного перевода — байты ↔ base64url. Атом держит
 * строку, а криптография работает с байтами, и делать это преобразование в
 * каждом вызывающем месте значило бы рано или поздно перепутать сторону.
 */

export function listWraps(space: Space): WrappedDek[] {
  const root = space.root(MetaModel);
  return root.keys.keys().map(id => readWrap(id, root.keys(id)));
}

export function saveWrap(space: Space, wrapped: WrappedDek): void {
  const root = space.root(MetaModel);
  space.edit(() => {
    const doc = root.keys(wrapped.label);
    doc.kind(wrapped.kind);
    doc.label(wrapped.label);
    doc.salt(encodeBytes(wrapped.salt));
    doc.nonce(encodeBytes(wrapped.nonce));
    doc.cipher(encodeBytes(wrapped.cipher));
    if (doc.createdAt() === 0) doc.createdAt(Date.now());
  });
}

/**
 * Убрать способ доступа.
 *
 * ВНИМАНИЕ: это лишь половина отзыва. Пока данные не перешифрованы под новым
 * DEK, снятая ранее копия обёртки продолжает подходить (docs/01-security.md §7).
 * Перешифрование приедет вместе с сервером.
 */
export function dropWrap(space: Space, label: string): void {
  space.root(MetaModel).keys.delete(label);
}

function readWrap(id: string, doc: Doc<'meta/key'>): WrappedDek {
  return {
    kind: doc.kind(),
    label: doc.label() === '' ? id : doc.label(),
    salt: decodeBytes(doc.salt()),
    nonce: decodeBytes(doc.nonce()),
    cipher: decodeBytes(doc.cipher()),
  };
}
