// Дым: два устройства синхронизируются через настоящий сервер.
// Запуск: node smoke.mjs http://localhost:3000  (сервер поднят с SYNC_TOKEN=dev-secret)
import { Land, Link, packEncode, packDecode, packPart, diffOf, facesFromPack, helloPack, LAND_ROOT } from '@sync/core';

const base = process.argv[2] ?? 'http://localhost:5173';
const TOKEN = process.env.SYNC_TOKEN ?? 'dev-secret';
const LAND = Link.land(Link.peer(crypto.getRandomValues(new Uint8Array(8))), new Uint8Array(8));
const ROOT = LAND_ROOT;

const clock = { now: () => Math.floor(Date.now() / 1000) };
const peer = Link.peer(new Uint8Array(8).fill(0x42));

async function post(bytes) {
  const res = await fetch(`${base}/sync/${LAND.str}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/octet-stream' },
    body: bytes,
  });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Один цикл синхронизации устройства: привет → применить дельту → дослать своё. */
async function syncOnce(land) {
  const reply = await post(helloPack(land, LAND));
  if (reply === null) return;
  let faces = null;
  for (const [pid, part] of packDecode(reply)) {
    if (pid.str !== LAND.str) continue;
    if (part.units.length > 0) land.apply(part.units, part.balls);
    if (part.faces.length > 0) faces = facesFromPack(part.faces);
  }
  if (faces !== null) {
    const delta = diffOf(land.part(), faces);
    if (delta.units.length > 0) {
      await post(packEncode([[LAND, packPart({ units: delta.units, balls: delta.balls })]]));
    }
  }
}

const values = (land) => land.order(ROOT).map((v) => v.value);

// Устройство A пишет и синхронизируется.
const a = new Land(peer, clock, { session: 0x000100 });
const first = a.post(ROOT, ROOT, 'с устройства A');
a.post(ROOT, first.self, 'длинное значение, которое уезжает в ball: ' + 'х'.repeat(80));
await syncOnce(a);

// Устройство B приходит пустым и получает всё с сервера.
const b = new Land(peer, clock, { session: 0x800100 });
await syncOnce(b);
console.log('B получил:', JSON.stringify(values(b)));

// B пишет своё, A забирает следующим циклом.
b.post(ROOT, ROOT, 'с устройства B');
await syncOnce(b);
await syncOnce(a);
console.log('A получил:', JSON.stringify(values(a)));

// Неверный токен обязан отлетать.
const bad = await fetch(`${base}/sync/${LAND.str}`, { method: 'POST', headers: { authorization: 'Bearer wrong' }, body: new Uint8Array([1]) });
console.log('чужой токен →', bad.status);

const okA = values(a).length === 3 && values(b).length >= 2;
console.log(okA && bad.status === 401 ? 'ДЫМ ПРОШЁЛ' : 'ДЫМ ПРОВАЛЕН');
process.exit(okA && bad.status === 401 ? 0 : 1);
