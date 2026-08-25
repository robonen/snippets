/**
 * HTTP-край сервера аккаунта: `/auth/*` и `/account/*` (docs/04-server.md
 * «Аккаунт и вход»). Только провод — байты в JSON и обратно, `credentials:
 * 'same-origin'` явно (единый origin, план Р1, но cookie отправится и без
 * этого — явность здесь документирует намерение, а не чинит поведение).
 *
 * Ни крипты, ни WebAuthn-DOM-типов здесь нет: их порождает и разбирает
 * `security/account.ts`, а этот файл про них ничего не знает — та же граница,
 * что у `sync/socket.ts` (сокет тоже не знает, что внутри кадра).
 */

/** Опции create(), которых не хватает `passkey.ts`'s `register()` (план Р-4). */
export interface RegisterOptions {
  readonly rpId: string;
  readonly rpName: string;
  readonly origin: string;
  /** base64url. */
  readonly userHandle: string;
  readonly userName: string;
  /** base64url. */
  readonly challenge: string;
}

export interface LoginOptions {
  readonly rpId: string;
  /** base64url. */
  readonly challenge: string;
}

export type RemoteWrapKind = 'passkey' | 'passphrase';

export interface RemoteWrap {
  readonly label: string;
  readonly kind: RemoteWrapKind;
  /** base64url — непрозрачные байты, сервер их не читает (план Р5). */
  readonly blob: string;
}

function endpoint(base: string, path: string): string {
  const origin = base === '' ? '' : base.replace(/\/+$/, '');
  return `${origin}${path}`;
}

/**
 * Тело неуспешного ответа — `{ status, message }` (`new HTTPError(...)` на
 * сервере, `apps/server/utils/*`). Сообщение сервера читается, когда оно есть:
 * «challenge истёк» человеку полезнее, чем голое «400».
 */
async function checked(res: Response, fallback: string): Promise<Response> {
  if (res.ok) return res;
  let message = fallback;
  try {
    const body = await res.clone().json() as { message?: unknown };
    if (typeof body.message === 'string' && body.message !== '') message = body.message;
  }
  catch {
    // Тело не JSON (502 от прокси, пустой ответ) — остаёмся на fallback.
  }
  throw new Error(message);
}

export async function fetchRegisterOptions(base: string, token: string): Promise<RegisterOptions> {
  const res = await fetch(endpoint(base, '/auth/register/options'), {
    headers: { authorization: `Bearer ${token}` },
    credentials: 'same-origin',
  });
  return (await checked(res, 'не удалось начать регистрацию')).json() as Promise<RegisterOptions>;
}

/** `response` — JSON-форма attestation-ответа, собранная в `security/account.ts`. */
export async function submitRegister(base: string, token: string, response: unknown): Promise<void> {
  const res = await fetch(endpoint(base, '/auth/register'), {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(response),
  });
  await checked(res, 'регистрация не принята');
}

export async function fetchLoginOptions(base: string): Promise<LoginOptions> {
  const res = await fetch(endpoint(base, '/auth/login/options'), { credentials: 'same-origin' });
  return (await checked(res, 'не удалось начать вход')).json() as Promise<LoginOptions>;
}

/** `response` — JSON-форма assertion-ответа. PRF-секрет в неё не кладётся никогда. */
export async function submitLogin(base: string, response: unknown): Promise<void> {
  const res = await fetch(endpoint(base, '/auth/login'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(response),
  });
  await checked(res, 'вход не принят');
}

export async function logout(base: string): Promise<void> {
  await fetch(endpoint(base, '/auth/logout'), { method: 'POST', credentials: 'same-origin' });
}

export async function fetchAuthenticated(base: string): Promise<boolean> {
  const res = await fetch(endpoint(base, '/auth/session'), { credentials: 'same-origin' });
  if (!res.ok) return false;
  const body = await res.json() as { authenticated?: unknown };
  return body.authenticated === true;
}

export async function fetchWraps(base: string): Promise<RemoteWrap[]> {
  const res = await fetch(endpoint(base, '/account/wraps'), { credentials: 'same-origin' });
  return (await checked(res, 'не удалось получить обёртки ключа')).json() as Promise<RemoteWrap[]>;
}

/** Замещает набор обёрток на сервере ЦЕЛИКОМ (контракт `PUT`, docs/04-server.md). */
export async function putWraps(base: string, wraps: readonly RemoteWrap[]): Promise<void> {
  const res = await fetch(endpoint(base, '/account/wraps'), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(wraps),
  });
  await checked(res, 'не удалось сохранить обёртки ключа');
}
