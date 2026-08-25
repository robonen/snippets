import { landOk } from '@brain/sync-wire';
import { HTTPError, getCookie, getRouterParam } from 'nitro/h3';
import { authorized } from './auth';
import { SESSION_COOKIE, sessionValid } from './sessions';
import type { H3Event } from 'nitro/h3';

/**
 * Общие проверки входа HTTP-роутов: сессия, Bearer, адрес ленда.
 *
 * `getHeader`/`createError`/`readRawBody` из h3 v2 помечены `@deprecated` в
 * пользу `event.req.headers.get()`/`new HTTPError()`/`event.req.arrayBuffer()` —
 * здесь и далее используются новые формы.
 */

/** Действующая сессия этого запроса — по cookie (план Р2). Нет cookie — `false`, не отказ. */
export async function hasSession(event: H3Event): Promise<boolean> {
  return sessionValid(getCookie(event, SESSION_COOKIE));
}

/**
 * Bearer ИЛИ сессия — общий вход для синка (docs/04-server.md «Синк-маршруты
 * … принимают cookie ИЛИ прежний Bearer») и для регистрации нового credential'а:
 * `SYNC_TOKEN` открывает регистрацию ПЕРВОГО устройства, когда сессии ещё нет и
 * взяться ей неоткуда; для уже вошедшего устройства, добавляющего себе ещё один
 * passkey, действующая сессия — тот же самый допуск, повторно вводить общий
 * секрет незачем (план Р2, «(а) воротами регистрации первого устройства»).
 */
export async function bearerOrSession(event: H3Event): Promise<boolean> {
  if (authorized(event.req.headers.get('authorization'))) return true;
  return hasSession(event);
}

/**
 * Вход синк-роутов: Bearer-или-сессия, потом адрес ленда.
 *
 * Обе проверки вместе и в этом порядке: неавторизованному незачем узнавать, что
 * адрес ленда разобрался, — это уже ответ на вопрос «какие ленды у вас есть».
 */
export async function landOfRequest(event: H3Event): Promise<string> {
  if (!(await bearerOrSession(event))) {
    throw new HTTPError({ status: 401, message: 'нет доступа' });
  }
  const land = getRouterParam(event, 'land');
  if (land === undefined || !landOk(land)) {
    throw new HTTPError({ status: 400, message: 'ленд не разбирается' });
  }
  return land;
}

/** Тело запроса как байты. Пустое тело — брак: кусок журнала не бывает пустым. */
export async function chunkOfRequest(event: H3Event): Promise<Uint8Array> {
  const body = new Uint8Array(await event.req.arrayBuffer());
  if (body.length === 0) {
    throw new HTTPError({ status: 400, message: 'пустой кусок' });
  }
  return body;
}
