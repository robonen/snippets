import { defineEventHandler } from 'nitro/h3';
import { hasSession } from '../../utils/request';

/**
 * Есть ли действующая сессия. Всегда 200 — это опрос состояния, а не ворота:
 * клиент зовёт его, чтобы решить, показывать ли форму входа, и 401 здесь был
 * бы тем же ответом с лишней семантикой ошибки.
 */
export default defineEventHandler(async event => ({ authenticated: await hasSession(event) }));
