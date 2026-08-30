import { useEventListener } from '@robonen/vue';
import type { Wire, WireHandlers } from './engine';

/**
 * Один WebSocket на ВСЕ ленды (план, Р7).
 *
 * Адрес ленда лежит в каждом кадре, поэтому мультиплексировать нечего:
 * соединение одно, сколько бы модулей ни было открыто. Кадры бинарные в обе
 * стороны — полезная нагрузка и так шифртекст, любая текстовая обёртка раздула
 * бы его примерно на треть.
 *
 * Реконнект — норма жизни, а не авария: телефон рвёт сокет при блокировке
 * экрана, ноутбук — при засыпании, домашний сервер — при перезапуске. Поэтому
 * обрыв НЕ пишется в консоль как ошибка: движок шлёт привет на каждом коннекте,
 * и протокол закрывает любой пропуск.
 */

/** Отступы реконнекта, мс. Дальше — по последнему, пока не выйдет связь. */
const BACKOFF = [1_000, 2_000, 5_000, 10_000, 30_000] as const;

export interface SocketOptions {
  /** База сервера: `https://brain.example.com` либо пустая строка — свой origin. */
  readonly url: string;
  /**
   * Фолбэк-токен (план Р2 «(б)»). Обычный путь — БЕЗ него: cookie сессии едет
   * на рукопожатии сама (единый origin, план Р1), и полю просто неоткуда
   * взяться — `sync/settings.ts` его больше не хранит. Параметр остаётся ради
   * скриптов и тестов, которым нужен явный Bearer поверх WS.
   */
  readonly token?: string;
  /** Инжект для тестов. */
  readonly factory?: (url: string) => WebSocket;
  /** Появилась связь или пропала — для индикатора в настройках. */
  readonly onLive?: (live: boolean) => void;
}

/**
 * `https://host` → `wss://host/sync`; пустая база — свой origin.
 *
 * `?token=` дописывается, только если он ЕСТЬ: пустой токен в query ничем не
 * отличался бы от отсутствующего для сервера (`authorized('')` лжёт «нет»), но
 * захламлял бы адрес и намекал бы на путь авторизации, которого в обычном
 * сценарии больше нет — вход теперь на cookie (план Р2).
 */
function socketUrl(base: string, token?: string): string {
  const origin = base === ''
    ? globalThis.location.origin.replace(/^http/, 'ws')
    : base.replace(/\/+$/, '').replace(/^http/, 'ws');
  if (token === undefined || token === '') return `${origin}/sync`;
  // Токен — в query: браузерный WebSocket не умеет ставить свои заголовки на
  // рукопожатие. Единственная причина, по которой секрет виден в адресе, — и
  // ровно поэтому по HTTP он ходит заголовком.
  return `${origin}/sync?token=${encodeURIComponent(token)}`;
}

export function socketWire(options: SocketOptions, handlers: WireHandlers): Wire {
  const make = options.factory ?? ((url: string) => new WebSocket(url));
  const address = socketUrl(options.url, options.token);

  let socket: WebSocket | null = null;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const isOpen = (): boolean => socket !== null && socket.readyState === 1;

  function later(): void {
    if (closed || timer !== null) return;
    const wait = BACKOFF[Math.min(attempt, BACKOFF.length - 1)] ?? 30_000;
    attempt += 1;
    timer = setTimeout(() => {
      timer = null;
      connect();
    }, wait);
  }

  function connect(): void {
    if (closed || socket !== null) return;

    let next: WebSocket;
    try {
      next = make(address);
    }
    catch {
      // Кривой адрес из настроек — не повод сдаваться молча: следующая попытка
      // подхватит исправленный, а состояние «связи нет» уже показано.
      options.onLive?.(false);
      later();
      return;
    }
    socket = next;
    // Кадры приходят бинарём: иначе браузер отдал бы Blob и каждый кусок
    // пришлось бы разворачивать асинхронно.
    next.binaryType = 'arraybuffer';

    next.addEventListener('open', () => {
      attempt = 0;
      options.onLive?.(true);
      handlers.open();
    });

    next.addEventListener('message', (event: MessageEvent) => {
      const data = event.data as ArrayBuffer | string;
      // Текстовых кадров в протоколе нет.
      if (typeof data === 'string') return;
      handlers.frame(new Uint8Array(data));
    });

    next.addEventListener('close', () => {
      socket = null;
      options.onLive?.(false);
      later();
    });

    // Ошибку не логируем: за ней всегда идёт `close`, там и реконнект.
    next.addEventListener('error', () => {});
  }

  // Сеть вернулась или вкладку разбудили — не ждать хвост отступа: телефон
  // после блокировки экрана иначе молчал бы до 30 секунд. Слушатели снимаются
  // в close(): движок пересобирает провод, и старый не должен оживать.
  const wake = (): void => {
    if (closed || socket !== null) return;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    attempt = 0;
    connect();
  };
  const unwatch: Array<() => void> = [];
  if (typeof globalThis.addEventListener === 'function') {
    unwatch.push(useEventListener(globalThis, 'online', wake));
  }
  const doc = globalThis.document as Document | undefined;
  if (doc !== undefined) {
    unwatch.push(useEventListener(doc, 'visibilitychange', () => {
      if (!doc.hidden) wake();
    }));
  }

  connect();

  return {
    send(frame) {
      if (!isOpen()) return false;
      // Каст — из-за типов lib.dom: `send` объявлен под
      // `ArrayBufferView<ArrayBuffer>`, а у нас `Uint8Array<ArrayBufferLike>`;
      // в рантайме WebSocket принимает любой типизированный массив как есть.
      (socket as WebSocket).send(frame as unknown as ArrayBufferView<ArrayBuffer>);
      return true;
    },
    close() {
      closed = true;
      for (const stop of unwatch) stop();
      if (timer !== null) clearTimeout(timer);
      timer = null;
      socket?.close();
      socket = null;
    },
  };
}
