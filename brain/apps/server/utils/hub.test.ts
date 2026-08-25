import {
  LAND_ROOT,
  Land,
  Link,
  diffOf,
  facesFromPack,
  fixedClock,
  helloPack,
  mintSecret,
  openPack,
  packDecode,
  packEncode,
  packPart,
  sealPack,
  secretKey,
} from '@sync/core';
import { createStorage } from 'unstorage';
import type { Driver } from 'unstorage';
import { describe, expect, it } from 'vitest';
import { createHub } from './hub';
import type { Hub } from './hub';

const LAND = Link.land(Link.peer(new Uint8Array(8).fill(0xd7)), new Uint8Array(8));

function device(session: number): Land {
  return new Land(Link.peer(new Uint8Array(8).fill(0x11)), fixedClock(1000), { session });
}

function valuesOf(land: Land): unknown[] {
  return land.order(LAND_ROOT).map(view => view.value);
}

/** Пачка ленда целиком — как её собирает клиентский движок. */
function packOf(land: Land): Uint8Array {
  const part = land.part();
  return packEncode([[LAND, packPart({ units: part.units, balls: part.balls })]]);
}

/** Встречная дельта клиента на фейсы из ответа сервера. */
function deltaFor(land: Land, reply: Uint8Array): Uint8Array | null {
  for (const [, part] of packDecode(reply)) {
    if (part.faces.length === 0) continue;
    const delta = diffOf(land.part(), facesFromPack(part.faces));
    if (delta.units.length === 0) return null;
    return packEncode([[LAND, packPart({ units: delta.units, balls: delta.balls })]]);
  }
  return null;
}

/** Полный «коннект» клиента: привет → влить дельту → дослать своё. */
async function converse(hub: Hub, land: Land, open?: (pack: Uint8Array) => Promise<Uint8Array>): Promise<void> {
  const hello = await hub.receive(helloPack(land, LAND));
  expect(hello.reply).not.toBeNull();
  const reply = hello.reply as Uint8Array;
  land.adopt(open === undefined ? reply : await open(reply));

  const push = deltaFor(land, reply);
  if (push !== null) await hub.receive(open === undefined ? push : push);
}

describe('hub', () => {
  it('два устройства сходятся через сервер', async () => {
    const hub = createHub(createStorage(), 5);
    const one = device(0x000010);
    const two = device(0x800010);

    const first = one.post(LAND_ROOT, LAND_ROOT, 'с первого');
    await converse(hub, one);

    await converse(hub, two);
    expect(valuesOf(two)).toEqual(['с первого']);

    two.post(LAND_ROOT, first.self, 'со второго');
    const out = await hub.receive(packOf(two));
    // Принятое вещается соседям по ленду; отправителю эха нет — это дело publish.
    expect(out.spread).toHaveLength(1);
    expect(out.lands).toContain(LAND.str);

    await converse(hub, one);
    expect(valuesOf(one)).toEqual(['с первого', 'со второго']);
  });

  it('образ переживает рестарт: новый хаб над тем же хранилищем отдаёт всё', async () => {
    const storage = createStorage();
    const hub = createHub(storage, 5);
    const one = device(0x10);
    one.post(LAND_ROOT, LAND_ROOT, 'до рестарта');
    await hub.receive(packOf(one));
    await hub.flush();

    const reborn = createHub(storage, 5);
    const two = device(0x800010);
    await converse(reborn, two);
    expect(valuesOf(two)).toEqual(['до рестарта']);
  });

  it('flush дописывает отложенное, и пир сервера стабилен между рестартами', async () => {
    const storage = createStorage();
    const hub = createHub(storage, 60_000); // отложка заведомо не успеет сама
    const one = device(0x10);
    one.post(LAND_ROOT, LAND_ROOT, 'x');
    await hub.receive(packOf(one));
    expect(await storage.getItemRaw(`land:${LAND.str}`)).toBeFalsy();
    await hub.flush();
    expect(await storage.getItemRaw(`land:${LAND.str}`)).toBeTruthy();

    const peer = new Uint8Array((await storage.getItemRaw('peer')) as Uint8Array);
    const reborn = createHub(storage, 5);
    await reborn.receive(helloPack(device(0x20), LAND));
    expect(new Uint8Array((await storage.getItemRaw('peer')) as Uint8Array)).toEqual(peer);
  });

  it('сервер без ключа возит запечатанные ленды, устройства их читают', async () => {
    const hub = createHub(createStorage(), 5);
    const key = await secretKey(mintSecret());
    const one = device(0x000010);
    const two = device(0x800010);

    one.post(LAND_ROOT, LAND_ROOT, 'личное — серверу не видно');
    await hub.receive(await sealPack(packOf(one), key));

    const hello = await hub.receive(helloPack(two, LAND));
    two.adopt(await openPack(hello.reply as Uint8Array, key));
    expect(valuesOf(two)).toEqual(['личное — серверу не видно']);

    // На хранилище сервера открытого текста нет.
    await hub.flush();
  });

  it('переживает драйвер без сырых байтов — профиль cloudflare-kv-http', async () => {
    // KV-драйвер умеет только строки: ядро unstorage возит raw base64-фолбэком.
    // Хаб обязан не заметить разницы — на этом держится продакшен-хранилище.
    const cells = new Map<string, string>();
    const stringOnly = {
      name: 'string-only',
      hasItem: (key: string) => cells.has(key),
      getItem: (key: string) => cells.get(key) ?? null,
      setItem: (key: string, value: string) => void cells.set(key, String(value)),
      removeItem: (key: string) => void cells.delete(key),
      getKeys: () => [...cells.keys()],
      clear: () => void cells.clear(),
    } as unknown as Driver;

    const storage = createStorage({ driver: stringOnly });
    const hub = createHub(storage, 5);
    const one = device(0x10);
    one.post(LAND_ROOT, LAND_ROOT, 'через строковый носитель');
    await hub.receive(packOf(one));
    await hub.flush();

    // На носителе именно СТРОКИ — сработал base64-фолбэк, а не нативный raw.
    expect(cells.get(`land:${LAND.str}`)).toMatch(/^base64:/);

    const reborn = createHub(storage, 5);
    const two = device(0x800010);
    await converse(reborn, two);
    expect(valuesOf(two)).toEqual(['через строковый носитель']);
  });

  it('мусор с провода — исключение наружу, состояние нетронуто', async () => {
    const hub = createHub(createStorage(), 5);
    await expect(hub.receive(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).rejects.toThrow();

    const two = device(0x20);
    const hello = await hub.receive(helloPack(two, LAND));
    // Сервер называется пустым фейсом — данных мусор не оставил.
    expect(hello.reply).not.toBeNull();
    expect(two.adopt(hello.reply as Uint8Array)).toBe(0);
  });
});
