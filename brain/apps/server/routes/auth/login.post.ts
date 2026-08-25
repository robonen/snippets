import { Buffer } from 'node:buffer';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { HTTPError, defineEventHandler, deleteCookie, getCookie, readBody, setCookie } from 'nitro/h3';
import { bumpCounter, credentialOf } from '../../utils/credentials';
import { CHALLENGE_COOKIE, CHALLENGE_PATH, consumeChallenge } from '../../utils/challenges';
import { publicOrigin, rpId } from '../../utils/origin';
import { SESSION_COOKIE, createSession } from '../../utils/sessions';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';

/**
 * Вход по passkey (docs/04-server.md «Аккаунт и вход»).
 *
 * Счётчик подписей: `verifyAuthenticationResponse` САМ бросает при регрессе
 * (`counter > 0 || credential.counter > 0`, `counter <= credential.counter`) —
 * проверено по исходнику установленной версии, не по внешней доке (у passkey,
 * которые всегда репортуют 0, это не регресс, а норма: 0/0 не бросает). Здесь
 * остаётся не разбирать эту логику руками, а поймать бросок, отказать и
 * оставить след в логе — счётчик реально ловит клона.
 */
export default defineEventHandler(async (event) => {
  const challenge = await consumeChallenge(getCookie(event, CHALLENGE_COOKIE), 'login');
  deleteCookie(event, CHALLENGE_COOKIE, { path: CHALLENGE_PATH });
  if (challenge === null) {
    throw new HTTPError({ status: 400, message: 'challenge не найден или истёк — начните вход заново' });
  }

  const response = await readBody<AuthenticationResponseJSON>(event);
  if (response === undefined) {
    throw new HTTPError({ status: 400, message: 'пустое тело' });
  }

  const stored = await credentialOf(response.id);
  if (stored === null) {
    throw new HTTPError({ status: 401, message: 'такой credential не зарегистрирован' });
  }

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: publicOrigin(),
    expectedRPID: rpId(),
    requireUserVerification: true,
    credential: {
      id: stored.id,
      publicKey: new Uint8Array(Buffer.from(stored.publicKey, 'base64url')),
      counter: stored.counter,
      transports: [...stored.transports],
    },
  }).catch((error: unknown) => {
    // Сюда попадает и регресс счётчика — след в логе обязателен (контракт).
    console.error('[brain] вход по passkey отклонён:', error);
    throw new HTTPError({ status: 401, message: error instanceof Error ? error.message : 'подпись не проверена' });
  });

  if (!verification.verified) {
    console.error('[brain] вход по passkey отклонён: verified=false');
    throw new HTTPError({ status: 401, message: 'подпись не проверена' });
  }

  await bumpCounter(stored.id, verification.authenticationInfo.newCounter);

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
