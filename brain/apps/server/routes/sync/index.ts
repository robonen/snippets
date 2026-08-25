import { chunkFromWire, decodeFrame, encodeFrame } from '@brain/sync-wire';
import { defineWebSocketHandler } from 'nitro/h3';
import { authorized } from '../../utils/auth';
import { useJournal, withLand } from '../../utils/journal';
import { publicOrigin } from '../../utils/origin';
import { SESSION_COOKIE, cookieFromHeader, sessionValid } from '../../utils/sessions';

/**
 * Живой транспорт: ОДИН WebSocket на все ленды (план, Р7).
 *
 * Ленд лежит в каждом кадре, а не в URL, — поэтому устройству хватает одного
 * соединения на всё пространство, а подписки заводятся по мере приветов.
 * Семантика операций та же, что у HTTP-фолбэка; сверх него — вещание: кусок,
 * принятый от одного устройства, уходит остальным подписчикам ленда сразу
 * (`peer.publish` не возвращает кадр отправителю — эха себе нет).
 *
 * Реконнект — норма жизни: телефон рвёт сокет при блокировке экрана. Клиент
 * шлёт `HELLO(seen)` на каждом коннекте, и журнал закрывает любой пропуск.
 *
 * Мусор с провода — молчаливый отказ, не исключение: кодек отвечает `null`,
 * а авторизованный клиент, шлющий брак, не повод ронять соединение остальных
 * лендов этого же устройства.
 */
export default defineWebSocketHandler({
  async upgrade(request) {
    // Origin — защита от cross-site WS hijacking (план Р2): HttpOnly-cookie
    // браузер приложит к рукопожатию САМ, на ЛЮБОЙ инициирующий origin — в
    // отличие от `authorization`-заголовка синка, который читает и подставляет
    // только наш собственный код. Сверяем со значением из окружения, а не с
    // `Host` — ему нельзя верить (`utils/origin.ts`). Проверяется на ОБОИХ
    // путях входа (и cookie, и Bearer): для браузера это НЕ лишняя проверка
    // (единственный настоящий WS-клиент здесь — `apps/web/src/sync/socket.ts`,
    // и он всегда шлёт verify Origin браузером), а curl/headless-скрипты по
    // задокументированному фолбэку остаются на HTTP (docs/04-server.md §3), где
    // Origin не проверяется вовсе.
    const origin = request.headers.get('origin');
    if (origin !== publicOrigin()) {
      return new Response('чужой origin', { status: 401 });
    }

    // Токен — в query, а не в заголовке: браузерный WebSocket не умеет ставить
    // свои заголовки на рукопожатие. Cookie едет на рукопожатии сама (единый
    // origin, план Р1) — читаем её тем же путём, что HTTP-роуты.
    const token = new URL(request.url).searchParams.get('token');
    const ok = authorized(token) || await sessionValid(cookieFromHeader(request.headers.get('cookie'), SESSION_COOKIE));
    if (!ok) {
      return new Response('нет доступа', { status: 401 });
    }
    // Явный undefined: `noImplicitReturns` требует одинаковости путей, а
    // «пропустить апгрейд» в crossws выражается именно отсутствием ответа.
    return undefined;
  },

  async message(peer, message) {
    const frame = decodeFrame(message.uint8Array());
    if (frame === null) return;

    const journal = useJournal();
    const land = frame.land;

    // `chunk`, `head` и `reject` сюда не попадают: это кадры сервера, и от
    // клиента они мусор.
    if (frame.op === 'hello') {
      // Подписка — до чтения журнала: кусок, дописанный соседом во время
      // ответа, либо попадёт в ответ, либо прилетит вещанием — но не мимо.
      peer.subscribe(topic(land));
      await withLand(land, async () => {
        const head = await journal.head(land);
        // `have` больше головы — клиент видел журнал, которого больше нет
        // (чужая компакция): отдаём всё с начала, применение идемпотентно.
        const from = Math.min(frame.have, head);
        for (const [at, chunk] of (await journal.read(land, from)).entries()) {
          peer.send(encodeFrame({ op: 'chunk', land, index: from + at, bytes: chunk }));
        }
        peer.send(encodeFrame({ op: 'head', land, count: head }));
      });
    }
    // Сервер слеп к содержимому, но форму куска протокол фиксирует: короче
    // нонса с меткой GCM кусков не бывает, и хранить такой мусор значило бы
    // отдать его потом всем устройствам.
    else if (frame.op === 'append' && chunkFromWire(frame.bytes) !== null) {
      await withLand(land, async () => {
        const head = await journal.append(land, frame.bytes);
        peer.send(encodeFrame({ op: 'head', land, count: head }));
        // Принятое — соседям по ленду: применение у них идемпотентно.
        peer.publish(topic(land), encodeFrame({ op: 'chunk', land, index: head - 1, bytes: frame.bytes }));
      });
    }
    else if (frame.op === 'replace' && chunkFromWire(frame.bytes) !== null) {
      await withLand(land, async () => {
        const out = await journal.replace(land, frame.ifHead, frame.bytes);
        peer.send(
          out.ok
            ? encodeFrame({ op: 'head', land, count: out.head })
            : encodeFrame({ op: 'reject', land, head: out.head }),
        );
        // Успешную компакцию НЕ вещаем: заменить журнал мог только клиент,
        // видевший его целиком, — подписчикам в этом куске нет ничего нового,
        // а отставшие обнаружат смену головы приветом и перечитают.
      });
    }
  },
});

function topic(land: string): string {
  return `land:${land}`;
}
