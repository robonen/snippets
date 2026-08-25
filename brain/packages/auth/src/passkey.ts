import { kekFromPrf } from './crypto';

/**
 * Край WebAuthn: позвать платформу и вернуть байты.
 *
 * Слой намеренно ТОНКИЙ и без логики. В Node он не запускается, значит,
 * тестами не покрывается, — и всё, что можно из него вынести, вынесено в
 * `crypto.ts`, где проверяется. Здесь остаются только вызовы браузера и разбор
 * их результата.
 *
 * ⚠️ Матрица поддержки PRF по браузерам и менеджерам паролей на момент
 * написания не подтверждена свежими источниками (docs/01-security.md §4).
 * Поэтому код НИКОГДА не полагается на PRF молча: его наличие проверяется, а
 * отсутствие — законный сценарий, а не ошибка.
 */

export interface PasskeyOptions {
  /** Домен-владелец ключа. На проде — ровно домен приложения. */
  readonly rpId: string;
  readonly rpName: string;
  /** Стабильный идентификатор пользователя, не меняющийся между входами. */
  readonly userHandle: Uint8Array;
  readonly userName: string;
  /** Челлендж от сервера. Свой на каждую операцию. */
  readonly challenge: Uint8Array;
}

export interface RegisteredPasskey {
  readonly credentialId: Uint8Array;
  /** Ответ платформы целиком — уходит на сервер для проверки. */
  readonly response: AuthenticatorAttestationResponse;
  /** Умеет ли этот ключ PRF. Если нет — доступ к данным только через фразу. */
  readonly prf: boolean;
}

/** Доступен ли WebAuthn вообще: старый браузер, http:// или встроенный webview. */
export function isSupported(): boolean {
  return typeof PublicKeyCredential === 'function'
    && typeof navigator.credentials?.create === 'function';
}

/** Есть ли на устройстве встроенный авторизатор — Touch ID, Windows Hello, Android. */
export async function hasPlatformAuthenticator(): Promise<boolean> {
  if (!isSupported()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  }
  catch {
    return false;
  }
}

/**
 * Создать passkey.
 *
 * `residentKey: 'required'` — ключ обязан храниться на устройстве и быть
 * находимым: без этого вход требовал бы поля с именем, а приложение на одного
 * человека такое поле только раздражает.
 *
 * `userVerification: 'required'` — биометрия или PIN обязательны: иначе
 * найденный разблокированный ключ сам по себе становится входом.
 */
export async function register(options: PasskeyOptions): Promise<RegisteredPasskey> {
  const credential = await navigator.credentials.create({
    publicKey: {
      rp: { id: options.rpId, name: options.rpName },
      user: {
        id: bufferOf(options.userHandle),
        name: options.userName,
        displayName: options.userName,
      },
      challenge: bufferOf(options.challenge),
      // ES256 и RS256 — то, что понимают все авторизаторы.
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: {
        residentKey: 'required',
        requireResidentKey: true,
        userVerification: 'required',
      },
      // Пустой `eval` спрашивает: «PRF вообще умеешь?» Значение вывода на
      // регистрации не нужно — многие авторизаторы его здесь и не дают.
      extensions: { prf: {} },
    },
  }) as PublicKeyCredential | null;

  if (credential === null) throw new Error('создание ключа отменено');

  return {
    credentialId: new Uint8Array(credential.rawId),
    response: credential.response as AuthenticatorAttestationResponse,
    prf: credential.getClientExtensionResults().prf?.enabled === true,
  };
}

export interface Assertion {
  readonly credentialId: Uint8Array;
  readonly response: AuthenticatorAssertionResponse;
  /** Вывод PRF, если авторизатор его дал. */
  readonly prfOutput: Uint8Array | null;
}

/**
 * Войти. Без списка `allowCredentials` — платформа сама предложит подходящий
 * ключ (discoverable credential).
 *
 * `prfSalt` заказывает вывод PRF в том же обращении: отдельного «дай ключ»
 * не существует, и без соли здесь второй раз просить биометрию пришлось бы
 * ради каждого открытия.
 */
export async function authenticate(
  options: Pick<PasskeyOptions, 'rpId' | 'challenge'>,
  prfSalt?: Uint8Array,
): Promise<Assertion> {
  const credential = await navigator.credentials.get({
    publicKey: {
      rpId: options.rpId,
      challenge: bufferOf(options.challenge),
      userVerification: 'required',
      ...(prfSalt !== undefined && {
        extensions: { prf: { eval: { first: bufferOf(prfSalt) } } },
      }),
    },
  }) as PublicKeyCredential | null;

  if (credential === null) throw new Error('вход отменён');

  const first = credential.getClientExtensionResults().prf?.results?.first;
  return {
    credentialId: new Uint8Array(credential.rawId),
    response: credential.response as AuthenticatorAssertionResponse,
    prfOutput: first === undefined ? null : viewOf(first),
  };
}

/**
 * KEK из вошедшего passkey — или `null`, если авторизатор PRF не поддержал.
 *
 * `null` возвращается, а не бросается, намеренно: это не сбой, а известный
 * сценарий, в котором приложение обязано предложить фразу восстановления.
 */
export async function kekFromAssertion(
  assertion: Assertion,
  hkdfSalt: Uint8Array,
): Promise<Uint8Array | null> {
  if (assertion.prfOutput === null) return null;
  return kekFromPrf(assertion.prfOutput, hkdfSalt);
}

/**
 * Вывод PRF приходит как `BufferSource`: спека допускает и буфер, и вид на
 * него, и браузеры пользуются этим по-разному.
 */
function viewOf(value: BufferSource): Uint8Array {
  return value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

function bufferOf(value: Uint8Array): ArrayBuffer {
  if (value.byteOffset === 0 && value.byteLength === value.buffer.byteLength) {
    return value.buffer as ArrayBuffer;
  }
  return value.slice().buffer as ArrayBuffer;
}
