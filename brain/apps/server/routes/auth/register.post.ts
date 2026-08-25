import { Buffer } from 'node:buffer';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { HTTPError, defineEventHandler, deleteCookie, getCookie, readBody, setCookie } from 'nitro/h3';
import { accountUserHandle, saveCredential } from '../../utils/credentials';
import { labelFromUserAgent } from '../../utils/agent';
import { CHALLENGE_COOKIE, CHALLENGE_PATH, consumeChallenge } from '../../utils/challenges';
import { publicOrigin, rpId } from '../../utils/origin';
import { bearerOrSession } from '../../utils/request';
import { SESSION_COOKIE, createSession } from '../../utils/sessions';
import type { RegistrationResponseJSON } from '@simplewebauthn/server';

/**
 * Завершение регистрации нового passkey (docs/04-server.md «Аккаунт и вход»).
 *
 * Тело — РОВНО attestation-ответ (без обёртки полями вроде label: контракт
 * зафиксирован как «тело — attestation response», и ярлык устройства заведомо
 * выводится из `user-agent`, `utils/agent.ts`, а не спрашивается отдельно).
 *
 * Проверка подписи — целиком на `@simplewebauthn/server` (план Р3): CBOR/COSE
 * руками здесь не разбирается ни байта.
 */
export default defineEventHandler(async (event) => {
  // Ворота теми же условиями, что открыли `/auth/register/options`: возможность
  // ДОЙТИ до этой ручки уже доказана challenge-cookie (её мог получить только
  // прошедший `bearerOrSession`), но перепроверка ничего не стоит и закрывает
  // окно между `GET options` и этим `POST` (сессия могла погаснуть между ними).
  if (!(await bearerOrSession(event))) {
    throw new HTTPError({ status: 401, message: 'нет доступа' });
  }

  const challenge = await consumeChallenge(getCookie(event, CHALLENGE_COOKIE), 'register');
  deleteCookie(event, CHALLENGE_COOKIE, { path: CHALLENGE_PATH });
  if (challenge === null) {
    throw new HTTPError({ status: 400, message: 'challenge не найден или истёк — начните привязку заново' });
  }

  const response = await readBody<RegistrationResponseJSON>(event);
  if (response === undefined) {
    throw new HTTPError({ status: 400, message: 'пустое тело' });
  }

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: publicOrigin(),
    expectedRPID: rpId(),
    requireUserPresence: true,
    requireUserVerification: true,
  }).catch((error: unknown) => {
    throw new HTTPError({ status: 400, message: error instanceof Error ? error.message : 'подпись не проверена' });
  });

  if (!verification.verified) {
    throw new HTTPError({ status: 400, message: 'подпись не проверена' });
  }

  // `user.id`, который отдали в options, — стабильное значение аккаунта, а не
  // то, что эхом возвращает attestation (create() его вообще не отдаёт назад:
  // мы его выбрали, нам его и помнить).
  const userHandle = await accountUserHandle();
  const { credential } = verification.registrationInfo;

  await saveCredential({
    id: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString('base64url'),
    counter: credential.counter,
    transports: credential.transports ?? [],
    userHandle: Buffer.from(userHandle).toString('base64url'),
    label: labelFromUserAgent(event.req.headers.get('user-agent')),
    createdAt: Date.now(),
  });

  const session = await createSession();
  setCookie(event, SESSION_COOKIE, session.id, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: session.maxAgeSeconds,
  });

  return { ok: true };
});
