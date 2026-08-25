import { Buffer } from 'node:buffer';
import { HTTPError, defineEventHandler, setCookie } from 'nitro/h3';
import { accountUserHandle } from '../../../utils/credentials';
import { CHALLENGE_COOKIE, CHALLENGE_PATH, issueChallenge } from '../../../utils/challenges';
import { bearerOrSession } from '../../../utils/request';
import { publicOrigin, rpId } from '../../../utils/origin';

/**
 * Начало регистрации нового passkey (docs/04-server.md «Аккаунт и вход»).
 *
 * Ворота — Bearer ИЛИ сессия (`bearerOrSession`, план Р2 «(а)»): `SYNC_TOKEN`
 * пускает регистрацию ПЕРВОГО устройства, когда сессии взяться неоткуда;
 * дальше — уже вошедшее устройство добавляет СЕБЕ ещё один passkey под своей
 * сессией, повторно вводить общий секрет незачем.
 *
 * Ответ — НЕ полный WebAuthn JSON options-объект (`pubKeyCredParams`,
 * `authenticatorSelection` и т.п.): их выбор целиком на клиенте, в
 * `packages/auth/src/passkey.ts` (`register()`, план Р-4 — эту церемонию не
 * переписывать). Сервер отдаёт РОВНО то, чего не хватает клиенту для вызова
 * `register()`: rp-identity, `userHandle` аккаунта и свежий challenge.
 */
export default defineEventHandler(async (event) => {
  if (!(await bearerOrSession(event))) {
    throw new HTTPError({ status: 401, message: 'нет доступа' });
  }

  const userHandle = await accountUserHandle();
  const { id, challenge, maxAgeSeconds } = await issueChallenge('register');

  setCookie(event, CHALLENGE_COOKIE, id, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: CHALLENGE_PATH,
    maxAge: maxAgeSeconds,
  });

  return {
    rpId: rpId(),
    rpName: 'brain',
    origin: publicOrigin(),
    userHandle: Buffer.from(userHandle).toString('base64url'),
    userName: 'brain',
    challenge,
  };
});
