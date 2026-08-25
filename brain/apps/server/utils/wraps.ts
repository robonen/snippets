import { useStorage } from './storage';
import type { Storage } from 'unstorage';

/**
 * Обёртки ключа на сервере (`/account/wraps`, docs/01-security.md §2/§4).
 *
 * Сервер здесь ПОЛНОСТЬЮ слеп (план Р5): `blob` — непрозрачные байты, внутри
 * которых клиент упаковал соль, нонс и шифртекст (`packages/auth/src/wire.ts`,
 * `packWrap`/`unpackWrap`) — сервер их не разбирает и не обязан знать формат.
 * Единственное, что здесь проверяется, — транспортная форма: `kind` обязан
 * быть одним из видов, которым разрешено покидать устройство (обёртка ключа
 * устройства бесполезна вне его и не выгружается вовсе — план Р5), `label` и
 * `blob` не пусты.
 */

export type WrapKind = 'passkey' | 'passphrase';

export interface StoredWrap {
  readonly label: string;
  readonly kind: WrapKind;
  /** base64url — непрозрачные байты обёртки. */
  readonly blob: string;
}

export function isWrapKind(value: unknown): value is WrapKind {
  return value === 'passkey' || value === 'passphrase';
}

function isStoredWrap(value: unknown): value is StoredWrap {
  const v = value as Partial<StoredWrap> | null;
  return typeof v === 'object' && v !== null
    && typeof v.label === 'string' && v.label !== ''
    && isWrapKind(v.kind)
    && typeof v.blob === 'string' && v.blob !== '';
}

export async function listWraps(storage: Storage = useStorage()): Promise<StoredWrap[]> {
  const out: StoredWrap[] = [];
  for (const key of await storage.getKeys('wrap')) {
    const found: unknown = await storage.getItem(key);
    if (isStoredWrap(found)) out.push(found);
  }
  return out;
}

/**
 * Заместить набор обёрток ЦЕЛИКОМ — клиент владеет истиной, сервер лишь
 * зеркалит (контракт `PUT /account/wraps`, docs/04-server.md «Аккаунт и вход»).
 *
 * Не идеально атомарно (unstorage не даёт транзакции по нескольким ключам), но
 * это не отзыв доступа сам по себе — обёртки лишь СОПРОВОЖДАЮТ реальный отзыв
 * (новый DEK, перепечатанные ленды), и обрыв посередине PUT оставляет самое
 * страшное, что может остаться, — на сервере одновременно старая и новая копия
 * какой-то обёртки того же способа доступа. Следующий успешный PUT (клиент
 * повторит после сетевой ошибки) её домоет.
 */
export async function replaceWraps(next: readonly StoredWrap[], storage: Storage = useStorage()): Promise<void> {
  const before = new Set(await storage.getKeys('wrap'));
  const after = new Set<string>();
  for (const wrap of next) {
    const key = `wrap:${wrap.label}`;
    after.add(key);
    await storage.setItem(key, wrap);
  }
  for (const key of before) {
    if (!after.has(key)) await storage.removeItem(key);
  }
}
