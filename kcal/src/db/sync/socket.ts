import { helloPack } from '@sync/core';
import type { Land, LandId } from '@sync/core';
import { absorbPack } from './protocol';

/**
 * Транспорт 2 — WebSocket (docs/server-sync.md §2.4): та же пачка, но живьём.
 *
 * Кадры БИНАРНЫЕ в обе стороны: в сокет уходит тот же `Uint8Array`, что и в тело
 * POST, обратно — `ArrayBuffer` (`binaryType`). Ни base64, ни JSON: пачка и так
 * компактный бинарь, любая текстовая обёртка раздула бы её на треть и добавила
 * бы работы на обоих концах.
 *
 * Реконнект — норма, а не авария: на Vercel соединение живёт не дольше
 * `maxDuration` функции, а телефон рвёт сокет при каждой блокировке экрана.
 * Поэтому привет уходит на КАЖДОМ подключении — он и лечит всё, что пропущено,
 * пока сокета не было.
 */

export interface SocketOptions {
  readonly land: Land;
  readonly id: LandId;
  /** База сервера; пустая строка — свой origin. */
  readonly url?: string;
  readonly token: string;
  /** Инжект для тестов. */
  readonly factory?: (url: string) => WebSocket;
  /** Сообщить оркестратору, что связь появилась или пропала. */
  readonly onLive?: (live: boolean) => void;
  readonly report?: (error: unknown) => void;
}

export interface SocketSync {
  /** Отправить пачку. `false` — сокета нет, зовите HTTP. */
  send(bytes: Uint8Array): boolean;
  /** Привет прямо сейчас, если соединение живо. */
  hello(): boolean;
  readonly live: () => boolean;
  close(): void;
}

/**
 * Отправка бинарного кадра. Каст — из-за типов lib.dom: `send` объявлен под
 * `ArrayBufferView<ArrayBuffer>`, а пачки ядра — `Uint8Array<ArrayBufferLike>`;
 * в рантайме WebSocket принимает любой типизированный массив как есть.
 */
function sendBinary(socket: WebSocket, bytes: Uint8Array): void {
  socket.send(bytes as unknown as ArrayBufferView<ArrayBuffer>);
}

/** Отступы реконнекта, мс. Дальше — по последнему, пока не выйдет связь. */
const BACKOFF = [1_000, 2_000, 5_000, 10_000, 30_000] as const;

/** `https://host` → `wss://host`; пустая база → свой origin. */
export function socketUrl(base: string, id: LandId, token: string): string {
  const origin = base === ''
    ? globalThis.location.origin.replace(/^http/, 'ws')
    : base.replace(/\/$/, '').replace(/^http/, 'ws');
  // Токен — в query: браузерный WebSocket не умеет ставить свои заголовки
  // на рукопожатие (единственная причина, по которой секрет виден в адресе).
  return `${origin}/sync/${id.str}?token=${encodeURIComponent(token)}`;
}

export function socketSync(options: SocketOptions): SocketSync {
  const { land, id, token } = options;
  const make = options.factory ?? ((url: string) => new WebSocket(url));
  const report = options.report ?? (() => {});
  const address = socketUrl(options.url ?? '', id, token);

  let socket: WebSocket | null = null;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const isOpen = () => socket !== null && socket.readyState === 1;

  function scheduleReconnect(): void {
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
    catch (error) {
      report(error);
      scheduleReconnect();
      return;
    }
    socket = next;
    // Кадры приходят бинарём — иначе браузер отдал бы Blob и каждую пачку
    // пришлось бы разворачивать асинхронно.
    next.binaryType = 'arraybuffer';

    next.addEventListener('open', () => {
      attempt = 0;
      options.onLive?.(true);
      // Привет на каждом коннекте: он закрывает всё, что пропущено за обрыв.
      sendBinary(next, helloPack(land, id));
    });

    next.addEventListener('message', (event: MessageEvent) => {
      const data = event.data as ArrayBuffer | string;
      if (typeof data === 'string') return; // текстовых кадров в протоколе нет
      const answer = absorbPack(land, id, new Uint8Array(data));
      if (answer !== null && isOpen()) sendBinary(next, answer);
    });

    next.addEventListener('close', () => {
      socket = null;
      options.onLive?.(false);
      scheduleReconnect();
    });

    // Ошибку не логируем: за ней всегда идёт `close`, там и реконнект.
    next.addEventListener('error', () => {});
  }

  connect();

  return {
    send(bytes) {
      if (!isOpen()) return false;
      sendBinary(socket as WebSocket, bytes);
      return true;
    },
    hello() {
      if (!isOpen()) return false;
      sendBinary(socket as WebSocket, helloPack(land, id));
      return true;
    },
    live: isOpen,
    close() {
      closed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      socket?.close();
      socket = null;
    },
  };
}
