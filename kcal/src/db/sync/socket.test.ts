import { afterEach, describe, expect, it, vi } from 'vitest';
import { Land, Link, diffOf, exchange, fixedClock, packEncode, packPart } from '@sync/core';
import type { LandId } from '@sync/core';
import { ROOT } from '../models.test-helpers';
import { socketUrl } from './socket';
import { syncServer } from './index';

/**
 * Клиент против НАСТОЯЩЕЙ серверной логики: сокет подделан, но за ним стоит
 * `exchange` из ядра — тот же код, что в роуте nitro, включая вещание соседям.
 * Проверяется протокол целиком, без сети.
 */

const LAND = Link.land(Link.peer(new Uint8Array(8).fill(0xf1)), new Uint8Array(8));

function peerOf(fill: number): Link {
  return Link.peer(new Uint8Array(8).fill(fill));
}

/**
 * Сервер-релей на поддельных сокетах: держит ленд, отвечает по протоколу и
 * вещает принятое остальным подписчикам — ровно как `peer.publish`.
 */
function relay(id: LandId) {
  const land = new Land(peerOf(0x5e), fixedClock(5000));
  const peers = new Set<FakeSocket>();
  /** Все кадры, прошедшие через сервер, — для проверки бинарности. */
  const frames: unknown[] = [];

  class FakeSocket implements Partial<WebSocket> {
    static opened: FakeSocket[] = [];
    readyState: 0 | 1 | 2 | 3 = 0;
    binaryType: BinaryType = 'blob';
    readonly url: string;
    readonly sent: Uint8Array[] = [];
    #listeners = new Map<string, Set<(event: unknown) => void>>();

    constructor(url: string) {
      this.url = url;
      FakeSocket.opened.push(this);
    }

    addEventListener(type: string, handler: (event: unknown) => void): void {
      const set = this.#listeners.get(type) ?? new Set();
      set.add(handler);
      this.#listeners.set(type, set);
    }

    emit(type: string, event: unknown = {}): void {
      for (const handler of this.#listeners.get(type) ?? []) handler(event);
    }

    /** Соединение установилось: подписываем на ленд и будим клиента. */
    accept(): void {
      this.readyState = 1;
      peers.add(this);
      this.emit('open');
    }

    /** Кадр от клиента: применяем, отвечаем, вещаем соседям. */
    send(data: unknown): void {
      frames.push(data);
      const bytes = data as Uint8Array;
      this.sent.push(bytes);
      const out = exchange(land, id, bytes);
      if (out.taken > 0) {
        for (const other of peers) {
          if (other !== this) other.deliver(bytes);
        }
      }
      if (out.reply !== null) this.deliver(out.reply);
    }

    /** Кадр серверу→клиенту: только ArrayBuffer, как настоящий binaryType. */
    deliver(bytes: Uint8Array): void {
      const copy = bytes.slice();
      this.emit('message', { data: copy.buffer });
    }

    close(): void {
      this.readyState = 3;
      peers.delete(this);
      this.emit('close');
    }
  }

  return { land, FakeSocket, frames };
}

/** Всё содержимое ленда одной пачкой — «правка соседа», пришедшая на сервер. */
function fullPack(land: Land, id: LandId): Uint8Array {
  const delta = diffOf(land.part(), new Map());
  return packEncode([[id, packPart({ units: delta.units, balls: delta.balls })]]);
}

function device(session: number): Land {
  const land = new Land(peerOf(0x21), fixedClock(4000), { session });
  land.track();
  return land;
}

const values = (land: Land) => land.order(ROOT).map(view => view.value);
const settle = async () => {
  for (let i = 0; i < 4; i++) await new Promise<void>(resolve => setTimeout(resolve, 0));
};

/** fetch, который валит тест: в сокетных сценариях HTTP трогать не должны. */
const forbiddenFetch: typeof fetch = () => {
  throw new Error('HTTP не должен использоваться, пока жив сокет');
};

afterEach(() => {
  vi.useRealTimers();
});

describe(socketUrl, () => {
  it('переводит схему в ws и кладёт токен в query', () => {
    expect(socketUrl('https://kcal.app', LAND, 'сек рет')).toBe(
      `wss://kcal.app/sync/${LAND.str}?token=${encodeURIComponent('сек рет')}`,
    );
  });
});

describe('живой транспорт', () => {
  it('на подключении шлёт привет и добирает чужое', async () => {
    const server = relay(LAND);
    // На сервере уже есть правка с другого устройства.
    const other = device(0x000700);
    other.post(ROOT, ROOT, 'с другого устройства');
    exchange(server.land, LAND, fullPack(other, LAND));

    const a = device(0x800700);
    const sync = syncServer({
      land: a,
      id: LAND,
      url: 'https://x',
      token: 't',
      fetcher: forbiddenFetch,
      socketFactory: url => new server.FakeSocket(url) as unknown as WebSocket,
      intervalMs: 60_000,
    });

    server.FakeSocket.opened[0]?.accept();
    await settle();

    expect(values(a)).toEqual(['с другого устройства']);
    expect(sync.live()).toBeTruthy();
    sync.close();
  });

  it('своя правка уезжает кадром и доходит до соседа мгновенно', async () => {
    const server = relay(LAND);
    const a = device(0x000700);
    const b = device(0x800700);

    const syncA = syncServer({ land: a, id: LAND, url: 'https://x', token: 't', fetcher: forbiddenFetch, socketFactory: url => new server.FakeSocket(url) as unknown as WebSocket, intervalMs: 60_000 });
    const syncB = syncServer({ land: b, id: LAND, url: 'https://x', token: 't', fetcher: forbiddenFetch, socketFactory: url => new server.FakeSocket(url) as unknown as WebSocket, intervalMs: 60_000 });
    server.FakeSocket.opened.forEach(socket => socket.accept());
    await settle();

    a.post(ROOT, ROOT, 'борщ');
    await settle();

    // Ни одного HTTP-запроса не понадобилось: forbiddenFetch бы бросил.
    expect(values(server.land)).toEqual(['борщ']);
    expect(values(b)).toEqual(['борщ']);

    syncA.close();
    syncB.close();
  });

  it('кадры бинарные в обе стороны — ни строк, ни JSON', async () => {
    const server = relay(LAND);
    const a = device(0x000700);
    const sync = syncServer({ land: a, id: LAND, url: 'https://x', token: 't', fetcher: forbiddenFetch, socketFactory: url => new server.FakeSocket(url) as unknown as WebSocket, intervalMs: 60_000 });
    server.FakeSocket.opened[0]?.accept();
    a.post(ROOT, ROOT, 'бинарь');
    await settle();

    expect(server.frames.length).toBeGreaterThan(0);
    for (const frame of server.frames) expect(frame).toBeInstanceOf(Uint8Array);
    // Клиент обязан просить ArrayBuffer, иначе браузер отдаст Blob.
    expect(server.FakeSocket.opened[0]?.binaryType).toBe('arraybuffer');

    sync.close();
  });

  it('обрыв — реконнект по отступу, и новый привет закрывает пропуск', async () => {
    vi.useFakeTimers();
    const server = relay(LAND);
    const a = device(0x000700);
    const sync = syncServer({ land: a, id: LAND, url: 'https://x', token: 't', fetcher: forbiddenFetch, socketFactory: url => new server.FakeSocket(url) as unknown as WebSocket, intervalMs: 60_000 });
    server.FakeSocket.opened[0]?.accept();
    await vi.advanceTimersByTimeAsync(0);

    // Пока связи нет, сосед успел записать своё.
    server.FakeSocket.opened[0]?.close();
    expect(sync.live()).toBeFalsy();
    const other = device(0x400700);
    other.post(ROOT, ROOT, 'записано во время обрыва');
    exchange(server.land, LAND, fullPack(other, LAND));

    // Первый отступ — секунда.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(server.FakeSocket.opened).toHaveLength(2);
    server.FakeSocket.opened[1]?.accept();
    await vi.advanceTimersByTimeAsync(0);

    expect(values(a)).toEqual(['записано во время обрыва']);
    sync.close();
  });

  it('нет сокета — работает POST', async () => {
    const server = relay(LAND);
    const a = device(0x000700);
    let posts = 0;
    const fetcher: typeof fetch = (_input, init) => {
      posts += 1;
      const out = exchange(server.land, LAND, init?.body as Uint8Array);
      if (out.reply === null) return Promise.resolve(new Response(null, { status: 204 }));
      const bin = out.reply.slice();
      return Promise.resolve(new Response(bin.buffer as ArrayBuffer, { status: 200 }));
    };

    // Фабрика бросает — ровно как заблокированный прокси.
    const sync = syncServer({
      land: a,
      id: LAND,
      url: 'https://x',
      token: 't',
      fetcher,
      socketFactory: () => {
        throw new Error('сокеты запрещены');
      },
      intervalMs: 60_000,
      report: () => {},
    });

    a.post(ROOT, ROOT, 'через запасной путь');
    await settle();

    expect(sync.live()).toBeFalsy();
    expect(posts).toBeGreaterThan(0);
    expect(values(server.land)).toEqual(['через запасной путь']);
    sync.close();
  });

  it('на старте не тянет дельту дважды: HTTP молчит, пока поднимается сокет', async () => {
    vi.useFakeTimers();
    const server = relay(LAND);
    const a = device(0x000700);
    // Считаем запросы, а не бросаем: брошенное поглотил бы `report`, и проверка
    // молчала бы ровно там, где должна кричать.
    let posts = 0;
    const counting: typeof fetch = () => {
      posts += 1;
      return Promise.resolve(new Response(null, { status: 204 }));
    };
    const sync = syncServer({ land: a, id: LAND, url: 'https://x', token: 't', fetcher: counting, socketFactory: url => new server.FakeSocket(url) as unknown as WebSocket, intervalMs: 60_000 });

    // Сокет поднялся за 50 мс — раньше, чем сработал бы запасной HTTP-привет.
    await vi.advanceTimersByTimeAsync(50);
    server.FakeSocket.opened[0]?.accept();
    await vi.advanceTimersByTimeAsync(5_000);

    // Единственный привет — кадром; HTTP не понадобился ни разу.
    expect(server.frames).toHaveLength(1);
    expect(posts).toBe(0);
    expect(sync.live()).toBeTruthy();
    sync.close();
  });

  it('сокет не поднялся — запасной привет уходит по HTTP', async () => {
    vi.useFakeTimers();
    const server = relay(LAND);
    const a = device(0x000700);
    let posts = 0;
    const fetcher: typeof fetch = (_input, init) => {
      posts += 1;
      const out = exchange(server.land, LAND, init?.body as Uint8Array);
      if (out.reply === null) return Promise.resolve(new Response(null, { status: 204 }));
      const bin = out.reply.slice();
      return Promise.resolve(new Response(bin.buffer as ArrayBuffer, { status: 200 }));
    };
    // Сокет создаётся, но никогда не открывается — как при молчащем прокси.
    const sync = syncServer({ land: a, id: LAND, url: 'https://x', token: 't', fetcher, socketFactory: url => new server.FakeSocket(url) as unknown as WebSocket, intervalMs: 60_000 });

    await vi.advanceTimersByTimeAsync(999);
    expect(posts).toBe(0);
    await vi.advanceTimersByTimeAsync(2);
    expect(posts).toBeGreaterThan(0);
    sync.close();
  });

  it('после close ни кадров, ни реконнектов', async () => {
    vi.useFakeTimers();
    const server = relay(LAND);
    const a = device(0x000700);
    const sync = syncServer({ land: a, id: LAND, url: 'https://x', token: 't', fetcher: forbiddenFetch, socketFactory: url => new server.FakeSocket(url) as unknown as WebSocket, intervalMs: 60_000 });
    server.FakeSocket.opened[0]?.accept();
    await vi.advanceTimersByTimeAsync(0);

    sync.close();
    const framesBefore = server.frames.length;
    const socketsBefore = server.FakeSocket.opened.length;

    a.post(ROOT, ROOT, 'после закрытия');
    await vi.advanceTimersByTimeAsync(60_000);

    expect(server.frames).toHaveLength(framesBefore);
    expect(server.FakeSocket.opened).toHaveLength(socketsBefore);
  });
});
