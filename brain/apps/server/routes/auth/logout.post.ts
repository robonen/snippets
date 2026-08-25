import { defineEventHandler, deleteCookie, getCookie } from 'nitro/h3';
import { SESSION_COOKIE, destroySession } from '../../utils/sessions';

/**
 * Выход: гасит сессию НА СЕРВЕРЕ (`docs/04-server.md` «Аккаунт и вход») — не
 * только стирает cookie в браузере, иначе снятая раньше копия cookie
 * продолжила бы работать. Идемпотентно: нет сессии — тоже 200, повторный
 * вызов (двойной клик, повтор после сетевой ошибки) не должен быть отказом.
 */
export default defineEventHandler(async (event) => {
  await destroySession(getCookie(event, SESSION_COOKIE));
  deleteCookie(event, SESSION_COOKIE, { path: '/' });
  return { ok: true };
});
