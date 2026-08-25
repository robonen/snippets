/**
 * `@brain/auth` — доступ и шифрование: конверт DEK/KEK, passkey, фраза
 * восстановления, замок.
 *
 * Разбор решений и модель угроз — docs/01-security.md. Граница внутри пакета
 * проведена по проверяемости: `crypto`, `recovery` и `vault` — чистая логика
 * над WebCrypto, гоняется в Node и покрыта тестами; `passkey` — тонкий край над
 * платформой, который в Node не запускается и потому не содержит логики.
 */

/*
 * Голых `seal`/`open`/`unwrapDek` наружу НЕТ намеренно. Снаружи данные ленда
 * шифруются только через `sealPack`/`openPack`, которые сами кладут адрес ленда
 * в AAD; публичный примитив позволял бы зашифровать пачку без этой привязки —
 * то есть обойти защиту от подстановки шифртекста одного ленда вместо другого
 * (docs/01-security.md §4).
 */
export {
  createDek,
  createDeviceKek,
  createSalt,
  decodeBytes,
  encodeBytes,
  kekFromPassphrase,
  kekFromPrf,
  randomBytes,
  wrapDek,
} from './crypto';
export type { Sealed, WrappedDek } from './crypto';

export { deviceKek, dropDeviceKek } from './device';

export {
  PHRASE_LENGTH,
  WORDS,
  createPhrase,
  isKnownPhrase,
  normalizePhrase,
  quizIndexes,
} from './recovery';

export { openWith, unlock } from './vault';
export type { OpenVault } from './vault';

export {
  authenticate,
  hasPlatformAuthenticator,
  isSupported,
  kekFromAssertion,
  register,
} from './passkey';
export type { Assertion, PasskeyOptions, RegisteredPasskey } from './passkey';

export { packWrap, unpackWrap } from './wire';
