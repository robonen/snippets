import { exchange } from '@sync/core';
import { defineWebSocketHandler } from 'nitro/h3';
import { authorized } from '../../utils/auth';
import { loadLand, parseLandId, saveLand, withLand } from '../../utils/store';
import type { LandId } from '@sync/core';

/** Ленд из адреса соединения: последний сегмент пути, без query. */
function landOfUrl(url: string | undefined): LandId | null {
  if (url === undefined) return null;
  try {
    return parseLandId(new URL(url).pathname.split('/').pop());
  }
  catch {
    return null;
  }
}

/**
 * Живой транспорт: WebSocket (kcal/docs/server-sync.md §2.4).
 *
 * Протокол тот же, что у POST-роута, плюс вещание: свежие юниты, принятые от
 * одного устройства, уходят остальным подписчикам этого ленда В ЭТОМ инстансе
 * (`peer.publish`). Между инстансами Vercel вещания нет — там устройства
 * добирают дельту приветами по расписанию; Redis pub/sub — следующий шаг, и он
 * записан в доке, а не притворён сделанным.
 *
 * Реконнект — норма жизни (на Vercel соединение живёт не дольше maxDuration
 * функции): клиент шлёт привет на каждом коннекте, и протокол закрывает любые
 * пропуски.
 */
export default defineWebSocketHandler({
  upgrade(request) {
    // Токен — в query, а не в заголовке: браузерный WebSocket не умеет ставить
    // свои заголовки на рукопожатие. Для HTTP-роута остаётся `authorization`.
    const token = new URL(request.url).searchParams.get('token');
    if (!authorized(token)) {
      return new Response('нет доступа', { status: 401 });
    }
    // Явный undefined: `noImplicitReturns` требует одинаковости путей, а
    // «пропустить апгрейд» в crossws выражается именно отсутствием ответа.
    return undefined;
  },

  open(peer) {
    const id = landOfUrl(peer.request.url);
    if (id === null) {
      peer.close(1008, 'ленд не разбирается');
      return;
    }
    peer.subscribe(`land:${id.str}`);
  },

  async message(peer, message) {
    const id = landOfUrl(peer.request.url);
    if (id === null) return;

    const bytes = message.uint8Array();
    await withLand(id, async () => {
      const land = await loadLand(id);
      const out = exchange(land, id, bytes);
      if (out.taken > 0) {
        await saveLand(id, land);
        // Принятое — соседям по ленду: пачка как пришла, применение идемпотентно.
        peer.publish(`land:${id.str}`, bytes);
      }
      if (out.reply !== null) peer.send(out.reply);
    });
  },
});
