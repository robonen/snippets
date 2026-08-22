import type { Land, LandId } from '@sync/core';
import { httpSync } from './http';
import { socketSync } from './socket';

/**
 * Синхронизация с сервером-релеем: два транспорта, один протокол.
 *
 * Живой путь — WebSocket: правка с другого устройства приезжает сразу, потому
 * что сервер вещает принятое соседям по ленду. POST остаётся страховкой и
 * работает всегда: им уходит всё, что не влезло в сокет (его нет, он рвётся,
 * его режет прокси), и им же идут редкие приветы «на всякий случай».
 *
 * Расписание приветов тупое и надёжное: старт, возврат вкладки, появление сети,
 * таймер. Пока сокет жив, таймерные приветы не нужны — сокет уже принёс всё, —
 * но один привет на возврат вкладки мы шлём всегда: телефон мог проспать обрыв,
 * о котором браузер сообщить не успел.
 */

export interface SyncServerOptions {
  readonly land: Land;
  readonly id: LandId;
  /** База сервера. Пустая строка — свой origin: сервер живёт в этом же приложении. */
  readonly url?: string;
  readonly token: string;
  /** Период страховочных приветов; по умолчанию 30 с. */
  readonly intervalMs?: number;
  /** Выключить живой транспорт (тесты, прокси без сокетов). */
  readonly socket?: boolean;
  /** Инжекты для тестов. */
  readonly fetcher?: typeof fetch;
  readonly socketFactory?: (url: string) => WebSocket;
  readonly report?: (error: unknown) => void;
}

export interface ServerSync {
  /** Привет прямо сейчас — не дожидаясь расписания. */
  nudge(): Promise<void>;
  /** Жив ли живой транспорт (для отладки и тестов). */
  live(): boolean;
  close(): void;
}

export function syncServer(options: SyncServerOptions): ServerSync {
  const { land, id } = options;
  const report = options.report ?? ((error: unknown) => console.warn('[kcal] сервер недоступен:', error));

  const http = httpSync(options);
  const socket = options.socket === false
    ? null
    : socketSync({ ...options, factory: options.socketFactory, report });

  let closed = false;
  let busy: Promise<void> = Promise.resolve();

  /** HTTP-обмены строго по одному: иначе сервер читает-сливает-пишет вперемешку. */
  function enqueue(work: () => Promise<void>): Promise<void> {
    const run = busy.then(work, work).catch((error) => {
      if (!closed) report(error);
    });
    busy = run;
    return run;
  }

  const nudge = (): Promise<void> => {
    if (closed) return Promise.resolve();
    // Сокет жив — привет уходит по нему, HTTP не трогаем.
    if (socket?.hello() === true) return Promise.resolve();
    return enqueue(() => http.hello());
  };

  // Свои записи уезжают краном ленда, батчем на микрозадачу. Чужое (из канала
  // вкладок или с сервера) кран не отдаёт — эха между транспортами нет.
  const untap = land.tap(id, (pack) => {
    if (closed) return;
    if (socket?.send(pack) === true) return;
    void enqueue(() => http.send(pack));
  });

  const timer = setInterval(() => {
    // Пока сокет жив, страховочные приветы не нужны — он уже всё принёс.
    if (socket?.live() !== true) void nudge();
  }, options.intervalMs ?? 30_000);

  // Первый привет ждёт сокет: он поднимается за десятки миллисекунд и приносит
  // ту же дельту сам. Без паузы старт стоил бы двух полных дельт — по HTTP и
  // следом кадром (на большом ленде это лишние сотни килобайт мобильного
  // трафика). Сокета нет — привет уходит сразу.
  const FIRST_HELLO_MS = 1_000;
  const first = socket === null
    ? null
    : setTimeout(() => {
        if (socket.live() !== true) void nudge();
      }, FIRST_HELLO_MS);

  const wake = () => void nudge();
  const visible = () => {
    if (document.visibilityState === 'visible') void nudge();
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', visible);
  if (typeof window !== 'undefined') globalThis.addEventListener('online', wake);

  if (socket === null) void nudge();

  return {
    nudge,
    live: () => socket?.live() ?? false,
    close() {
      closed = true;
      untap();
      if (first !== null) clearTimeout(first);
      socket?.close();
      clearInterval(timer);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', visible);
      if (typeof window !== 'undefined') globalThis.removeEventListener('online', wake);
    },
  };
}
