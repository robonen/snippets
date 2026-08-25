import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { useStorage } from './storage';
import type { AuthenticatorTransportFuture } from '@simplewebauthn/server';
import type { Storage } from 'unstorage';

/**
 * WebAuthn credentials — то, что контракт называет «credential_id, COSE-ключ,
 * sign_count, user_handle, label устройства» (docs/04-server.md «Аккаунт и вход»).
 *
 * Сервер здесь НЕ слеп: в отличие от лендов (`journal.ts`, «сервер видит только
 * шифртекст»), проверка подписи passkey — его прямая работа, и её обязан делать
 * `@simplewebauthn/server` (план Р3) — CBOR/COSE/подписи руками не разбираются.
 * Этот файл хранит только РЕЗУЛЬТАТ проверки: публичный ключ и счётчик, не сам
 * секрет — секрета у сервера как не было, так и нет (приватный ключ credential'а
 * никогда не покидает авторизатор).
 */

export interface StoredCredential {
  readonly id: string;
  /** COSE public key, как его отдаёт `verifyRegistrationResponse` — base64url. */
  readonly publicKey: string;
  /** Счётчик подписей. Регресс при входе — отказ (`routes/auth/login.post.ts`). */
  readonly counter: number;
  /**
   * Тип из `@simplewebauthn/server`, а не голый `string[]`: та же форма нужна
   * назад, нетронутой, в `credential.transports` при `verifyAuthenticationResponse`
   * (`routes/auth/login.post.ts») — заведя свой тип здесь, пришлось бы каст на
   * обратном пути, а он спрятал бы реальное рассогласование форм, если оно
   * когда-нибудь возникнет.
   */
  readonly transports: readonly AuthenticatorTransportFuture[];
  readonly userHandle: string;
  readonly label: string;
  readonly createdAt: number;
}

function isStoredCredential(value: unknown): value is StoredCredential {
  const v = value as Partial<StoredCredential> | null;
  return typeof v === 'object' && v !== null
    && typeof v.id === 'string'
    && typeof v.publicKey === 'string'
    && typeof v.counter === 'number'
    && Array.isArray(v.transports)
    && typeof v.userHandle === 'string'
    && typeof v.label === 'string'
    && typeof v.createdAt === 'number';
}

/**
 * `user.id` аккаунта — ОДИН на все credentials этого сервера, заводится при
 * первой регистрации и переживает процесс.
 *
 * Не по одному на регистрацию: сервер — личное пространство одного человека
 * (docs/04-server.md §0), и общий `user.id` у всех его passkey — то, что
 * WebAuthn ждёт от «нескольких аутентификаторов одного аккаунта» по спеке;
 * разный `user.id` на каждый credential заставил бы платформу считать их
 * учётками разных людей.
 */
export async function accountUserHandle(storage: Storage = useStorage()): Promise<Uint8Array> {
  const key = 'account:userHandle';
  const found = await storage.getItem<string>(key);
  if (typeof found === 'string' && found !== '') return new Uint8Array(Buffer.from(found, 'base64url'));

  const fresh = randomBytes(16);
  await storage.setItem(key, fresh.toString('base64url'));
  return new Uint8Array(fresh);
}

export async function saveCredential(credential: StoredCredential, storage: Storage = useStorage()): Promise<void> {
  await storage.setItem(`credential:${credential.id}`, credential);
}

export async function credentialOf(id: string, storage: Storage = useStorage()): Promise<StoredCredential | null> {
  const found: unknown = await storage.getItem(`credential:${id}`);
  return isStoredCredential(found) ? found : null;
}

/** Переписать счётчик подписей после успешного входа. */
export async function bumpCounter(id: string, counter: number, storage: Storage = useStorage()): Promise<void> {
  const key = `credential:${id}`;
  const found: unknown = await storage.getItem(key);
  if (!isStoredCredential(found)) return;
  await storage.setItem(key, { ...found, counter } satisfies StoredCredential);
}
