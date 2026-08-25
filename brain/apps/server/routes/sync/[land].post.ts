import { chunkFromWire } from '@brain/sync-wire';
import { HTTPError, defineEventHandler } from 'nitro/h3';
import { useJournal, withLand } from '../../utils/journal';
import { chunkOfRequest, landOfRequest } from '../../utils/request';

/**
 * Фолбэк: дописать кусок обычным HTTP (docs/04-server.md §3).
 *
 * Тело — кусок как есть (`nonce(12) || cipher`), ответ — новая голова. Вещания
 * здесь нет: подписки живут на сокете, а отставшие увидят кусок ближайшим
 * приветом — журнал закрывает пропуск сам.
 */
export default defineEventHandler(async (event) => {
  const land = await landOfRequest(event);
  const chunk = await chunkOfRequest(event);
  if (chunkFromWire(chunk) === null) {
    throw new HTTPError({ status: 400, message: 'кусок короче нонса с меткой' });
  }

  const journal = useJournal();
  return withLand(land, async () => ({ head: await journal.append(land, chunk) }));
});
