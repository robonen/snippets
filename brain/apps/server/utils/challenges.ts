import { randomBytes } from 'node:crypto';
import { useStorage } from './storage';
import type { Storage } from 'unstorage';

/**
 * WebAuthn challenge — одноразовый, TTL 5 минут (docs/04-server.md «Аккаунт и вход»).
 *
 * Челлендж и его идентификатор — РАЗНЫЕ случайные значения намеренно: первый
 * едет в теле ответа `…/options` и в подписи авторизатора, второй — в отдельной
 * короткоживущей cookie (`brain_challenge`), которой follow-up `POST` находит
 * запись обратно. Один и тот же секрет на две роли (порядок можно наблюдать в
 * заголовках) связал бы их без нужды — тот же довод, что у HKDF `info` в
 * `packages/auth/src/crypto.ts`.
 *
 * Область cookie — `/auth`: она не должна ездить на `/sync` и `/account`, ей
 * там нечего делать.
 */

export const CHALLENGE_COOKIE = 'brain_challenge';
export const CHALLENGE_PATH = '/auth';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export type ChallengeKind = 'register' | 'login';

interface ChallengeRecord {
  readonly kind: ChallengeKind;
  /** base64url — то же значение, что ушло в опции create()/get(). */
  readonly challenge: string;
  readonly expiresAt: number;
}

function isRecord(value: unknown): value is ChallengeRecord {
  return typeof value === 'object' && value !== null
    && typeof (value as ChallengeRecord).kind === 'string'
    && typeof (value as ChallengeRecord).challenge === 'string'
    && typeof (value as ChallengeRecord).expiresAt === 'number';
}

export async function issueChallenge(
  kind: ChallengeKind,
  storage: Storage = useStorage(),
): Promise<{ id: string; challenge: string; maxAgeSeconds: number }> {
  const id = randomBytes(16).toString('base64url');
  const challenge = randomBytes(32).toString('base64url');
  const record: ChallengeRecord = { kind, challenge, expiresAt: Date.now() + CHALLENGE_TTL_MS };
  await storage.setItem(`challenge:${id}`, record);
  return { id, challenge, maxAgeSeconds: Math.floor(CHALLENGE_TTL_MS / 1000) };
}

/**
 * Забрать челлендж по id из cookie — и СРАЗУ стереть, независимо от исхода
 * проверок ниже: одноразовый значит одноразовый даже при неудаче, иначе
 * провалившаяся церемония давала бы право на повтор тем же challenge'ем.
 *
 * `null` — челленджа нет, не тот вид (пришли на `/auth/login` с id от
 * регистрации) или истёк. Вызывающий во всех трёх случаях отвечает одинаково:
 * «начните заново» — различать их незачем, а посвящать в детали отказа
 * непрошедшего проверку — ни к чему.
 */
export async function consumeChallenge(
  id: string | undefined | null,
  kind: ChallengeKind,
  storage: Storage = useStorage(),
): Promise<string | null> {
  if (id === undefined || id === null || id === '') return null;
  const key = `challenge:${id}`;
  const found: unknown = await storage.getItem(key);
  await storage.removeItem(key);

  if (!isRecord(found)) return null;
  if (found.kind !== kind) return null;
  if (Date.now() > found.expiresAt) return null;
  return found.challenge;
}
