import { exchange } from '@sync/core';
import { createError, defineEventHandler, getHeader, getRouterParam, readRawBody, setResponseHeader, setResponseStatus } from 'nitro/h3';
import { authorized } from '../../utils/auth';
import { loadLand, parseLandId, saveLand, withLand } from '../../utils/store';

/**
 * Базовый транспорт: пачка вошла — пачка вышла (kcal/docs/server-sync.md §2.3).
 *
 * Работает на любом serverless без длинных соединений: клиент шлёт привет
 * фейсами при старте и по расписанию, пачку крана — после записи; в ответ
 * получает дельту с фейсами сервера и досылает встречную.
 */
export default defineEventHandler(async (event) => {
  if (!authorized(getHeader(event, 'authorization'))) {
    throw createError({ statusCode: 401, statusMessage: 'нет доступа' });
  }

  const id = parseLandId(getRouterParam(event, 'land'));
  if (id === null) {
    throw createError({ statusCode: 400, statusMessage: 'ленд не разбирается' });
  }

  const body = await readRawBody(event, false);
  if (body === undefined || body.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'пустая пачка' });
  }

  return withLand(id, async () => {
    const land = await loadLand(id);
    const out = exchange(land, id, new Uint8Array(body));
    if (out.taken > 0) await saveLand(id, land);

    if (out.reply === null) {
      setResponseStatus(event, 204);
      return null;
    }
    setResponseHeader(event, 'content-type', 'application/octet-stream');
    return out.reply;
  });
});
