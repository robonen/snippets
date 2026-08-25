// Секрет ленда: один симметричный ключ на ленд (docs/07 §4).
//
// Почему 16 байт, а не 32: секрет должен помещаться в `gift.code`, а это ровно
// 16 байт формата (docs/03 §2, раскладка из baza). docs/07 в одном месте
// упоминает AES-256, но менять формат ради этого не стоит: AES-128 практически
// не перебираем. Расхождение зафиксировано здесь и в docs/07.
//
// Ключ импортируется неэкспортируемым: сырые байты секрета есть только у того,
// кто его создал или получил при подключении устройства. Хранение и обёртка
// сырых байт — задача связки ключей приложения, а не ядра.

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
    throw new Error(`land secret is ${SECRET_BYTES} B (gift.code), got ${raw.length}`)
  }
  return crypto.subtle.importKey('raw', raw as Uint8Array<ArrayBuffer>, { name: 'AES-GCM', length: SECRET_BITS }, false, [
    'encrypt',
    'decrypt',
  ])
}
