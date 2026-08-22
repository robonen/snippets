// Дым WebSocket: два устройства на живом сокете, вещание между ними.
import { Land, Link, packEncode, packDecode, packPart, diffOf, facesFromPack, helloPack, LAND_ROOT } from '@sync/core';

const base = process.argv[2] ?? 'ws://localhost:5173';
const LAND = Link.land(Link.peer(crypto.getRandomValues(new Uint8Array(8))), new Uint8Array(8));
const ROOT = LAND_ROOT;
const clock = { now: () => Math.floor(Date.now() / 1000) };
const peer = Link.peer(new Uint8Array(8).fill(0x43));

function connect(land) {
  const ws = new WebSocket(`${base}/sync/${LAND.str}?token=${process.env.SYNC_TOKEN ?? 'dev-secret'}`);
  ws.binaryType = 'arraybuffer';
  ws.onmessage = (event) => {
    for (const [pid, part] of packDecode(new Uint8Array(event.data))) {
      if (pid.str !== LAND.str) continue;
      if (part.units.length > 0) land.apply(part.units, part.balls);
      if (part.faces.length > 0) {
        const delta = diffOf(land.part(), facesFromPack(part.faces));
        if (delta.units.length > 0) {
          ws.send(packEncode([[LAND, packPart({ units: delta.units, balls: delta.balls })]]));
        }
      }
    }
  };
  return new Promise((done) => {
    ws.onopen = () => { ws.send(helloPack(land, LAND)); done(ws); };
  });
}

const values = (land) => land.order(ROOT).map((v) => v.value);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const a = new Land(peer, clock, { session: 0x000200 });
a.post(ROOT, ROOT, 'по сокету от A');
const wsA = await connect(a);
await wait(300);

const b = new Land(peer, clock, { session: 0x800200 });
const wsB = await connect(b);
await wait(300);
console.log('B после привета:', JSON.stringify(values(b)));

// Живое вещание: B шлёт юниты — A обязан услышать ЧЕРЕЗ сервер (peer.publish).
const two = b.post(ROOT, ROOT, 'вещание от B');
const delta = diffOf(b.part(), new Map());
wsB.send(packEncode([[LAND, packPart({
  units: delta.units.filter((u) => u.time() >= two.time),
  balls: delta.balls,
})]]));
await wait(400);
console.log('A после вещания:', JSON.stringify(values(a)));

// Чужой токен на апгрейде.
const bad = new WebSocket(`${base}/sync/${LAND.str}?token=wrong`);
const badResult = await new Promise((done) => {
  bad.onerror = () => done('отвергнут');
  bad.onopen = () => done('ПРИНЯТ');
});
console.log('чужой токен →', badResult);

const ok = values(b).length >= 1 && values(a).some((v) => v === 'вещание от B') && badResult === 'отвергнут';
console.log(ok ? 'WS-ДЫМ ПРОШЁЛ' : 'WS-ДЫМ ПРОВАЛЕН');
wsA.close(); wsB.close();
process.exit(ok ? 0 : 1);
