import { decodeBytes, encodeBytes } from '@brain/auth';
import type { Space } from '@sync/core';
import type { Keyring, Sealed, WrappedDek } from '@brain/auth';
import { KeysModel } from './keys-land';

/**
 * Сейф пространства (модель crus: зашифрованный ключ лежит в базе, вход —
 * паролем). Две половины, обе шифртекст, и обе несут отпечаток мастера:
 *
 *   блоб    — секреты лендов, запечатанные мастером. Связка — синхронизируемое
 *             состояние пространства: секрет нового ленда доезжает до всех сам;
 *   фраза   — мастер, завёрнутый KEK'ом фразы восстановления: вход с любого
 *             устройства одной фразой, первое для этого не нужно онлайн.
 *
 * Отпечатки обязаны совпадать: иначе фраза открывала бы мастер, которым блоб
 * не открыть. Кто вправе публиковать блоб, решает оркестровка (`space.ts`).
 */

/** Запись сейфа одна на пространство. */
const VAULT_ID = 'space';

/** Метка фразовой обёртки мастера: AAD `wrapDek` привязывает kind и label. */
export const SPACE_PHRASE_LABEL = 'space';

export interface SpaceVault {
  /** Мастер под KEK'ом фразы. `null` — фразовый вход не опубликован. */
  readonly phrase: WrappedDek | null;
  /** Секреты под мастером. `null` — связку ещё не публиковали. */
  readonly ring: Sealed | null;
  /** Отпечатки мастеров половин. Пустая строка — половины ещё нет. */
  readonly wrapMaster: string;
  readonly ringMaster: string;
  /** pub устройства, опубликовавшего блоб. Пусто — блоба нет. */
  readonly ringBy: string;
}

const EMPTY: SpaceVault = { phrase: null, ring: null, wrapMaster: '', ringMaster: '', ringBy: '' };

export function readVault(space: Space): SpaceVault {
  const root = space.root(KeysModel);
  if (!root.vault.has(VAULT_ID)) return EMPTY;
  const doc = root.vault(VAULT_ID);
  return {
    phrase: doc.cipher() === ''
      ? null
      : {
          kind: 'passphrase',
          label: SPACE_PHRASE_LABEL,
          salt: decodeBytes(doc.salt()),
          nonce: decodeBytes(doc.nonce()),
          cipher: decodeBytes(doc.cipher()),
        },
    ring: doc.ringCipher() === ''
      ? null
      : { nonce: decodeBytes(doc.ringNonce()), cipher: decodeBytes(doc.ringCipher()) },
    wrapMaster: doc.wrapMaster(),
    ringMaster: doc.ringMaster(),
    ringBy: doc.ringBy(),
  };
}

/** Опубликовать связку: секреты под мастером, с отпечатком и публикатором. */
export async function publishRing(space: Space, ring: Keyring, by: string): Promise<void> {
  const sealed = await ring.sealedSecrets();
  const root = space.root(KeysModel);
  space.edit(() => {
    const doc = root.vault(VAULT_ID);
    doc.ringNonce(encodeBytes(sealed.nonce));
    doc.ringCipher(encodeBytes(sealed.cipher));
    doc.ringMaster(ring.masterId());
    doc.ringBy(by);
    doc.at(Date.now());
  });
}

/** Опубликовать мастер под KEK'ом фразы — вход в пространство одной фразой. */
export function publishPhraseWrap(space: Space, wrapped: WrappedDek, masterId: string): void {
  const root = space.root(KeysModel);
  space.edit(() => {
    const doc = root.vault(VAULT_ID);
    doc.salt(encodeBytes(wrapped.salt));
    doc.nonce(encodeBytes(wrapped.nonce));
    doc.cipher(encodeBytes(wrapped.cipher));
    doc.wrapMaster(masterId);
    doc.at(Date.now());
  });
}

/** Стереть фразовую обёртку — после смены мастера она открывала бы пустоту. */
export function clearPhraseWrap(space: Space): void {
  const root = space.root(KeysModel);
  if (!root.vault.has(VAULT_ID)) return;
  space.edit(() => {
    const doc = root.vault(VAULT_ID);
    doc.salt('');
    doc.nonce('');
    doc.cipher('');
    doc.wrapMaster('');
  });
}
