/**
 * Авторизация до Э2 (passkey-вход): один общий секрет, как у kcal.
 *
 * Личное пространство — один пользователь, поэтому токен сравнивается с env, а
 * не с базой. Появится passkey-вход (Э2) — здесь же появится «сессия →
 * разрешённые ленды»; роуты уже спрашивают доступ на КАЖДУЮ операцию, менять их
 * не придётся.
 *
 * Сервер без токена в окружении отказывает всем: молчаливый «открытый» режим —
 * это ровно тот класс дефектов, от которого проект лечится весь путь.
 *
 * Токен даёт доступ к БАЙТАМ, не к данным: ленды на сервере лежат шифртекстом
 * (docs/01-security.md §2, У2), и утёкший токен раскрывает размеры и времена,
 * но не содержимое.
 */
export function authorized(header: string | undefined | null): boolean {
  const secret = process.env.SYNC_TOKEN;
  if (secret === undefined || secret === '') return false;
  if (header === undefined || header === null) return false;
  const given = header.startsWith('Bearer ') ? header.slice(7) : header;
  return timingSafeEqualText(given, secret);
}

/** Сравнение без ранних выходов: длина утечь может, содержимое — нет. */
function timingSafeEqualText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
