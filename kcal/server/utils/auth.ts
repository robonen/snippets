/**
 * Авторизация до S6 (подписей юнитов): один общий секрет.
 *
 * Личный дневник — один пользователь, поэтому токен сравнивается с env, а не с
 * базой. Появятся пользователи — здесь же появится «токен → разрешённые ленды»;
 * роуты уже спрашивают доступ к КОНКРЕТНОМУ ленду, менять их не придётся.
 *
 * Сервер без токена в окружении отказывает всем: молчаливый «открытый» режим —
 * это ровно тот класс дефектов, от которого проект лечится весь путь.
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
