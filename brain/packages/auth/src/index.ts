/**
 * `@brain/auth` — доступ: связка ключей лендов, passkey, фраза восстановления.
 *
 * Шифрование ДАННЫХ здесь больше не живёт: payload юнитов запечатывает само
 * ядро `@sync/core` (уровень юнита, заголовки открыты — docs/01-security.md
 * ревизия 3). Пакету остались ключи: 16-байтовые секреты лендов в связке,
 * мастер связки в обёртках способов доступа, вывод KEK из WebAuthn PRF и из
 * фразы, неизвлекаемый ключ устройства.
 *
 * Граница внутри пакета проведена по проверяемости: `crypto`, `recovery` и
 * `keyring` — чистая логика над WebCrypto, гоняется в Node и покрыта тестами;
 * `passkey` и `device` — тонкие края над платформой без собственной логики.
 */

export {
  createSalt,
  decodeBytes,
  encodeBytes,
  kekFromPassphrase,
  kekFromPrf,
  randomBytes,
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

export {
  createKeyring,
  decodeGrant,
  decodeSecrets,
  dropKeyring,
  keyringFromMaterial,
  openSpaceVault,
  unlockKeyring,
} from './keyring';
export type { Keyring, RingStore, SpaceMaterial } from './keyring';

export {
  authenticate,
  hasPlatformAuthenticator,
  isSupported,
  kekFromAssertion,
  register,
} from './passkey';
export type { Assertion, PasskeyOptions, RegisteredPasskey } from './passkey';

export { openLegacyChunk, unwrapLegacyDek } from './legacy';
