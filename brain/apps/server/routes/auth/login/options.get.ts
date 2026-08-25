import { defineEventHandler, setCookie } from 'nitro/h3';
import { CHALLENGE_COOKIE, CHALLENGE_PATH, issueChallenge } from '../../../utils/challenges';
import { rpId } from '../../../utils/origin';

/**
 * Начало входа: discoverable credential (docs/01-security.md §3) —
 * `allowCredentials` пуст, платформа сама предлагает подходящий ключ. Без
 * ворот: войти пробует любой, у кого есть passkey этого RP, а решает
 * авторизатор биометрией/PIN (`userVerification: 'required'` — задаёт клиент,
 * `packages/auth/src/passkey.ts`), не сервер на этом шаге.
 */
export default defineEventHandler(async (event) => {
  const { id, challenge, maxAgeSeconds } = await issueChallenge('login');

  setCookie(event, CHALLENGE_COOKIE, id, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: CHALLENGE_PATH,
    maxAge: maxAgeSeconds,
  });

  return { challenge, rpId: rpId() };
});
