import { describe, expect, it } from 'vitest';
import { Land, Link, exchange, fixedClock } from '@sync/core';
import type { LandId } from '@sync/core';
import { ROOT } from '../models.test-helpers';
import { syncServer } from '@/db/sync';

/**
 * Клиент против НАСТОЯЩЕЙ серверной логики: fetch подделан, но за ним стоит
 * `exchange` из ядра — тот же код, что в Nitro-роуте. Проверяется протокол
 * целиком, без сети.
 */

const LAND = Link.land(Link.peer(new Uint8Array(8).fill(0xf1)), new Uint8Array(8));

function peerOf(fill: number): Link {
  return Link.peer(new Uint8Array(8).fill(fill));
}

function fakeServer(id: LandId) {
  const land = new Land(peerOf(0x5e), fixedClock(5000));
  let requests = 0;
  const fetcher: typeof fetch = (_input, init) => {
    requests += 1;
    const body = init?.body as Uint8Array;
    const out = exchange(land, id, body);
    if (out.reply === null) return Promise.resolve(new Response(null, { status: 204 }));
    const bin = out.reply.slice();
    return Promise.resolve(new Response(bin.buffer as ArrayBuffer, {
      status: 200,
      headers: { 'content-type': 'application/octet-stream' },
    }));
  };
  return { land, fetcher, requests: () => requests };
}

function device(session: number): Land {
  const land = new Land(peerOf(0x21), fixedClock(4000), { session });
  land.track();
  return land;
}

const values = (land: Land) => land.order(ROOT).map(view => view.value);
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe(syncServer, () => {
  it('офлайн-правки уезжают приветом, чужие приезжают дельтой', async () => {
    const remote = fakeServer(LAND);
    const a = device(0x000300);
    a.post(ROOT, ROOT, 'написано до подключения');

    const syncA = syncServer({ land: a, id: LAND, url: 'https://x', token: 't', fetcher: remote.fetcher, intervalMs: 60_000, socket: false });
    await syncA.nudge();
    expect(values(remote.land)).toEqual(['написано до подключения']);

    // Второе устройство с пустым лендом получает всё одним приветом.
    const b = device(0x800300);
    const syncB = syncServer({ land: b, id: LAND, url: 'https://x', token: 't', fetcher: remote.fetcher, intervalMs: 60_000, socket: false });
    await syncB.nudge();
    expect(values(b)).toEqual(['написано до подключения']);

    syncA.close();
    syncB.close();
  });

  it('живая запись уезжает краном без привета', async () => {
    const remote = fakeServer(LAND);
    const a = device(0x000300);
    const syncA = syncServer({ land: a, id: LAND, url: 'https://x', token: 't', fetcher: remote.fetcher, intervalMs: 60_000, socket: false });
    await syncA.nudge();
    const before = remote.requests();

    a.post(ROOT, ROOT, 'живая запись');
    await settle();
    await settle();

    expect(values(remote.land)).toEqual(['живая запись']);
    expect(remote.requests()).toBeGreaterThan(before);
    syncA.close();
  });

  it('после close ничего не шлётся', async () => {
    const remote = fakeServer(LAND);
    const a = device(0x000300);
    const syncA = syncServer({ land: a, id: LAND, url: 'https://x', token: 't', fetcher: remote.fetcher, intervalMs: 60_000, socket: false });
    await syncA.nudge();
    syncA.close();
    const before = remote.requests();

    a.post(ROOT, ROOT, 'после закрытия');
    await settle();
    await settle();
    expect(remote.requests()).toBe(before);
  });
});
