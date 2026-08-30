import { decodeBytes, encodeBytes } from '@brain/auth';
import type { WrappedDek } from '@brain/auth';

/**
 * Обёртки мастера связки — в localStorage ЭТОГО устройства.
 *
 * Раньше обёртки жили в открытом мета-ленде, чтобы доезжать до второго
 * устройства. Больше не нужно: каждое устройство заворачивает мастер СВОИМИ
 * способами доступа (его passkey, его ключ устройства), а между устройствами
 * секреты едут ECDH-обёртками внутри пространства (`security/grants.ts`).
 * Секрета здесь нет — без KEK обёртка бесполезна, — поэтому localStorage
 * честен: синхронно читается на старте и не тянет за собой ленд.
 */

const KEY = 'brain.keys.wraps';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

interface StoredWrap {
  readonly kind: WrappedDek['kind'];
  readonly label: string;
  readonly salt: string;
  readonly nonce: string;
  readonly cipher: string;
}

export function listWraps(store: Store = localStorage): WrappedDek[] {
  const raw = store.getItem(KEY);
  if (raw === null) return [];
  return (JSON.parse(raw) as StoredWrap[]).map(wrap => ({
    kind: wrap.kind,
    label: wrap.label,
    salt: decodeBytes(wrap.salt),
    nonce: decodeBytes(wrap.nonce),
    cipher: decodeBytes(wrap.cipher),
  }));
}

export function saveWrap(wrapped: WrappedDek, store: Store = localStorage): void {
  const rest = listWraps(store).filter(wrap => wrap.label !== wrapped.label);
  writeAll([...rest, wrapped], store);
}

export function dropWrap(label: string, store: Store = localStorage): void {
  writeAll(listWraps(store).filter(wrap => wrap.label !== label), store);
}

function writeAll(wraps: readonly WrappedDek[], store: Store): void {
  store.setItem(KEY, JSON.stringify(wraps.map(wrap => ({
    kind: wrap.kind,
    label: wrap.label,
    salt: encodeBytes(wrap.salt),
    nonce: encodeBytes(wrap.nonce),
    cipher: encodeBytes(wrap.cipher),
  } satisfies StoredWrap))));
}
