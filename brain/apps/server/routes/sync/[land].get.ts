import { encodeChunkList } from '@brain/sync-wire';
import { HTTPError, defineEventHandler, getQuery } from 'nitro/h3';
import { useJournal, withLand } from '../../utils/journal';
import { landOfRequest } from '../../utils/request';

/**
 * Фолбэк: дочитать журнал обычным HTTP (docs/04-server.md §3).
 *
 * Существует ровно затем, зачем POST-роут у kcal: работать там, где сокета нет
 * или он не поднялся — сеть за прокси, дым-скрипт, ранний старт. Семантика та
 * же, что у кадра `HELLO`: отдать `[from..head)` и назвать голову.
 *
 * Тело — повторяющиеся `[len:u32be][chunk]`, голова — заголовком `x-head`.
 * Голова именно заголовком, потому что она нужна и на пустом хвосте: «ты
 * догнал» и «сервер пуст» — разные ответы с одинаковым телом.
 */
export default defineEventHandler(async (event) => {
  const land = await landOfRequest(event);
  const from = Number(getQuery(event).from ?? 0);
  if (!Number.isInteger(from) || from < 0) {
    throw new HTTPError({ status: 400, message: '«from» — неотрицательное целое' });
  }

  const journal = useJournal();
  return withLand(land, async () => {
    const head = await journal.head(land);
    // `from` больше головы — клиент видел журнал, которого больше нет (чужая
    // компакция): отдаём всё с начала, применение идемпотентно.
    const chunks = await journal.read(land, Math.min(from, head));
    event.res.headers.set('content-type', 'application/octet-stream');
    event.res.headers.set('x-head', String(head));
    return encodeChunkList(chunks);
  });
});
