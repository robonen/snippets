/**
 * Авторизация личного сервера: один общий секрет.
 *
 * Функция ЧИСТАЯ — секрет приходит аргументом (маршруты берут его из
 * `serverConfig()`), поэтому она гоняется vitest'ом без рантайма nitro.
 *
 * Сервер с пустым секретом отказывает всем: молчаливый «открытый» режим —
 * ровно тот класс дефектов, от которого проект лечится весь путь.
 *
 * Токен даёт доступ к БАЙТАМ, не к данным: payload юнитов запечатан ключами,
 * которых на сервере нет (docs/01-security.md §3). Утёкший токен раскрывает
 * метаданные и шифртекст, но не содержимое.
 */
export function authorized(header: string | undefined | null, secret: string): boolean {
  if (secret === '') return false;
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
