import { defineWebSocketHandler } from 'nitro';
import { authorized } from '../utils/auth';
import { serverConfig } from '../utils/config';
import { syncHub } from '../utils/instance';

/**
 * Живой транспорт: ОДИН WebSocket на все ленды.
 *
 * Кадр = пачка формата ядра `@sync/core` — адрес ленда лежит в заголовке её
 * секции, поэтому своего кадрового протокола у сервера нет (прежний
 * `@brain/sync-wire` умер вместе со слепым журналом). Семантика в `utils/hub.ts`;
 * здесь — авторизация рукопожатия, подписки и доставка.
 *
 * Реконнект — норма жизни: телефон рвёт сокет при блокировке экрана. Клиент
 * шлёт свои фейсы на каждом коннекте, и дельта закрывает любой пропуск.
 */
export default defineWebSocketHandler({
  upgrade(request) {
    const config = serverConfig();

    // Сверка Origin — только при явно заданном PUBLIC_ORIGIN (см.
    // nitro.config.ts: с токеном в query она опциональное ужесточение, а не
    // основа защиты). Сверяем с конфигом, а не с `Host` — ему нельзя верить.
    if (config.publicOrigin !== '') {
      const origin = request.headers.get('origin');
      if (origin !== config.publicOrigin) {
        return new Response('foreign origin', { status: 401 });
      }
    }

    // Токен — в query: браузерный WebSocket не умеет ставить свои заголовки на
    // рукопожатие.
    if (!authorized(new URL(request.url).searchParams.get('token'), config.syncToken)) {
      return new Response('access denied', { status: 401 });
    }
    // Явный undefined: «пропустить апгрейд» в crossws — отсутствие ответа.
    return undefined;
  },

  async message(peer, message) {
    let out;
    try {
      out = await syncHub().receive(message.uint8Array());
    }
    catch {
      // Мусор с провода — молчаливый отказ, не исключение: авторизованный
      // клиент, пославший брак, не повод ронять соединение остальных лендов.
      return;
    }

    // Подписка на каждый упомянутый ленд — до отправки ответа: юнит соседа,
    // принятый во время ответа, либо попадёт в дельту, либо прилетит вещанием.
    for (const land of out.lands) peer.subscribe(`land:${land}`);

    if (out.reply !== null) peer.send(out.reply);
    // Принятое — соседям по ленду; `publish` не возвращает кадр отправителю.
    for (const [land, pack] of out.spread) peer.publish(`land:${land}`, pack);
  },
});
