import { open, unwrapDek } from './crypto';
import type { WrappedDek } from './crypto';

/**
 * Прежний конверт DEK/KEK — ТОЛЬКО для одноразового переезда.
 *
 * До ревизии 3 шифрование стояло на границе диска: пачка ленда запечатывалась
 * целиком одним DEK (AAD `brain/land/<ленд>`), куски лежали в сундуке
 * `brain-sealed` как `nonce(12) ‖ cipher`. Теперь payload шифрует само ядро, и
 * этот модуль существует ровно затем, чтобы старые установки открыли свои куски
 * один последний раз (`apps/web/src/security/migrate-legacy.ts`). Новых
 * вызывающих у него быть не должно; уедет вместе с миграцией.
 */

const NONCE_BYTES = 12;

/** Снять старую обёртку DEK — тем же KEK, что и раньше. */
export function unwrapLegacyDek(wrapped: WrappedDek, kek: Uint8Array | CryptoKey): Promise<Uint8Array> {
  return unwrapDek(wrapped, kek);
}

/** Распечатать кусок старого сундука: `nonce ‖ cipher` под AAD адреса ленда. */
export function openLegacyChunk(dek: Uint8Array, land: string, chunk: Uint8Array): Promise<Uint8Array> {
  if (chunk.length < NONCE_BYTES + 16) {
    throw new Error(`кусок ${chunk.length} Б короче нонса с меткой GCM — это не кусок сундука`);
  }
  return open(
    dek,
    { nonce: chunk.subarray(0, NONCE_BYTES), cipher: chunk.subarray(NONCE_BYTES) },
    new TextEncoder().encode(`brain/land/${land}`),
  );
}
