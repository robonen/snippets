// Секрет ленда: один симметричный ключ на ленд (docs/07 §4).
//
// ─── Почему 16 байт, а не 32 ─────────────────────────────────────────────────
//
// Секрет обязан влезать в `gift.code` — 16 байт по формату (docs/03 §2, порт
// раскладки baza). Спецификация docs/07 в одном месте говорит «AES-256», но
// формат сильнее пожелания: расширять gift ради 256-битного ключа значит ломать
// ADR-005 на ровном месте, а 128 бит AES — за пределом перебора и сегодня, и в
// обозримом «завтра». Расхождение записано здесь и в docs/07, а не замолчано.
//
// Ключ импортируется НЕэкспортируемым: сырые байты секрета живут только у того,
// кто их чеканил или получил gift'ом, — хранение и обёртка сырых байт это работа
// связки ключей приложения, ядру она не принадлежит.

import type { SubtleKey } from './keys'

const SECRET_BITS = 128

/** Длина сырого секрета ленда — ровно `gift.code` (docs/03 §2). */
export const SECRET_BYTES = 16

/** Свежий секрет ленда: 16 случайных байт из платформенного CSPRNG. */
export function mintSecret(): Uint8Array {
  const raw = new Uint8Array(SECRET_BYTES)
  crypto.getRandomValues(raw)
  return raw
}

/**
 * Сырые байты секрета — в ключ AES-GCM для {@link sealPack}/{@link openPack}.
 *
 * @throws {Error} на секрете не той длины — до похода в WebCrypto, чтобы место
 * отказа называло формат, а не «importKey failed».
 */
export function secretKey(raw: Uint8Array): Promise<SubtleKey> {
  if (raw.length !== SECRET_BYTES) {
    throw new Error(`секрет ленда — ${SECRET_BYTES} Б (gift.code), пришло ${raw.length}`)
  }
  return crypto.subtle.importKey('raw', raw as Uint8Array<ArrayBuffer>, { name: 'AES-GCM', length: SECRET_BITS }, false, [
    'encrypt',
    'decrypt',
  ])
}
