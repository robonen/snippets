import { chunkFromWire } from '@brain/sync-wire';
import { HTTPError, defineEventHandler, getQuery } from 'nitro/h3';
import { useJournal, withLand } from '../../../utils/journal';
import { chunkOfRequest, landOfRequest } from '../../../utils/request';

/**
 * Фолбэк: оптимистичная компакция обычным HTTP (docs/04-server.md §3).
 *
 * `?if=N` — журнал заменяется одним куском, только если в нём ровно N кусков.
 * Отказ — 409 с текущей головой, и это НЕ ошибка: клиент, отставший от сервера,
 * просто дочитает хвост и пошлёт компактный кусок обычным `POST`. Сервер при
 * этом подрастёт, но состояние сойдётся — применение кусков идемпотентно.
 */
export default defineEventHandler(async (event) => {
  const land = await landOfRequest(event);
  const ifHead = Number(getQuery(event).if);
  if (!Number.isInteger(ifHead) || ifHead < 0) {
    throw new HTTPError({ status: 400, message: '«if» — неотрицательное целое' });
  }

  const chunk = await chunkOfRequest(event);
  if (chunkFromWire(chunk) === null) {
    throw new HTTPError({ status: 400, message: 'кусок короче нонса с меткой' });
  }

  const journal = useJournal();
  return withLand(land, async () => {
    const out = await journal.replace(land, ifHead, chunk);
    if (!out.ok) event.res.status = 409;
    return { head: out.head };
  });
});
