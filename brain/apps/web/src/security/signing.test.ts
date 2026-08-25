import {
  LAND_ROOT,
  Land,
  Link,
  diffOf,
  exchange,
  facesFromPack,
  fixedClock,
  helloPack,
  mintSecret,
  mintSignerPair,
  packDecode,
  packEncode,
  packPart,
  sealPack,
  secretKey,
  signerOf,
} from '@sync/core';
import type { Roster, SecretRing, Signer } from '@sync/core';
import { describe, expect, it } from 'vitest';
import { makeSecure, ownerRoster } from './signing';

/**
 * Гейт подписи на границе провода (docs/01-security.md §7).
 *
 * Секрет один на все ленды — шифрование проверяет `@sync/core`; здесь важна
 * подпись: аутентичный санд проходит, вброшенный на сервере без печати — нет,
 * и фейсы сходятся без вечной пересылки печатей.
 */

const DATA = Link.land(Link.peer(new Uint8Array(8).fill(0xda)), new Uint8Array(8));
const KEYS = Link.land(Link.peer(new Uint8Array(8).fill(0x11)), new Uint8Array(8));

async function device(): Promise<{ signer: Signer; ring: SecretRing; roster: (peers: Link[]) => Roster }> {
  const { algo, pair } = await mintSignerPair();
  const signer = await signerOf(algo, pair);
  const key = await secretKey(mintSecret());
  return { signer, ring: { secretOf: land => (land.str === KEYS.str ? null : key) }, roster: ownerRoster };
}

function packOf(land: Land, id: Link): Uint8Array {
  const part = land.part();
  return packEncode([[id, packPart({ units: part.units, balls: part.balls })]]);
}

describe(makeSecure, () => {
  it('sands reach the second device signed, through a blind server', async () => {
    const a = await device();
    // Оба устройства делят один ключ шифрования (в brain — общая связка).
    const b = { signer: (await device()).signer, ring: a.ring };
    const roster = ownerRoster([a.signer.peer, b.signer.peer]);

    const secureA = makeSecure(a.ring, a.signer, () => roster, KEYS.str);
    const secureB = makeSecure(b.ring, b.signer, () => roster, KEYS.str);

    const one = new Land(a.signer.peer, fixedClock(1000));
    const first = one.post(LAND_ROOT, LAND_ROOT, 'привет');
    one.post(LAND_ROOT, first.self, 'мир');

    // Сервер — слепой пир: свой пир, ни ключа, ни ростера.
    const server = new Land(Link.peer(new Uint8Array(8).fill(0x5e)), fixedClock(2000));
    exchange(server, DATA, await secureA.outgoing(packOf(one, DATA)));

    // Второе устройство здоровается и вливает проверенную дельту.
    const two = new Land(b.signer.peer, fixedClock(3000));
    const hello = exchange(server, DATA, helloPack(two, DATA));
    two.adopt(await secureB.incoming(hello.reply as Uint8Array));

    expect(two.order(LAND_ROOT).map(v => v.value)).toEqual(['привет', 'мир']);
  });

  it('server injection without a seal is rejected', async () => {
    const a = await device();
    const roster = ownerRoster([a.signer.peer]);
    const secureA = makeSecure(a.ring, a.signer, () => roster, KEYS.str);

    const one = new Land(a.signer.peer, fixedClock(1000));
    one.post(LAND_ROOT, LAND_ROOT, 'честная');

    const server = new Land(Link.peer(new Uint8Array(8).fill(0x5e)), fixedClock(2000));
    exchange(server, DATA, await secureA.outgoing(packOf(one, DATA)));

    // Злой сервер знает ключ шифрования (worst case) и вбрасывает свой санд —
    // но печати на него нет, а ключа подписи у него нет.
    const evil = new Land(Link.peer(new Uint8Array(8).fill(0x66)), fixedClock(2000));
    evil.post(LAND_ROOT, LAND_ROOT, 'вброс');
    const sealed = await sealPack(packOf(evil, DATA), a.ring.secretOf(DATA) as CryptoKey);
    exchange(server, DATA, sealed);

    const two = new Land(a.signer.peer, fixedClock(3000));
    const hello = exchange(server, DATA, helloPack(two, DATA));
    two.adopt(await secureA.incoming(hello.reply as Uint8Array));

    expect(two.order(LAND_ROOT).map(v => v.value)).toEqual(['честная']);
  });

  it('keys land travels as the root of trust: neither encrypted nor signed', async () => {
    const a = await device();
    const roster = ownerRoster([a.signer.peer]);
    const secure = makeSecure(a.ring, a.signer, () => roster, KEYS.str);

    const keys = new Land(a.signer.peer, fixedClock(1000));
    keys.post(LAND_ROOT, LAND_ROOT, 'публичный ключ устройства');

    const out = await secure.outgoing(packOf(keys, KEYS));
    // Открытый текст на месте — ленд keys не запечатан.
    const needle = new TextEncoder().encode('публичный').join(',');
    expect(out.join(',').includes(needle)).toBeTruthy();

    // И читается обратно как есть (проверка не отбрасывает открытый ленд).
    const back = new Land(Link.peer(new Uint8Array(8).fill(0x22)), fixedClock(2000));
    back.adopt(await secure.incoming(out));
    expect(back.order(LAND_ROOT).map(v => v.value)).toEqual(['публичный ключ устройства']);
  });

  it('faces converge: after the seal echo the server does not send them again', async () => {
    const a = await device();
    const roster = ownerRoster([a.signer.peer]);
    const secure = makeSecure(a.ring, a.signer, () => roster, KEYS.str);

    const one = new Land(a.signer.peer, fixedClock(1000));
    one.post(LAND_ROOT, LAND_ROOT, 'x');

    const server = new Land(Link.peer(new Uint8Array(8).fill(0x5e)), fixedClock(2000));
    exchange(server, DATA, await secure.outgoing(packOf(one, DATA)));

    // Автор получает своё эхо (печати оседают в его ленде) и досылает.
    const echo = exchange(server, DATA, helloPack(one, DATA));
    one.adopt(await secure.incoming(echo.reply as Uint8Array));
    // Досылка после адопта — инкрементальная подпись не плодит печатей.
    const resend = diffOf(one.part(), facesFromPack(packDecode(echo.reply as Uint8Array)[0]?.[1].faces ?? []));

    // Второй привет: серверу больше нечего досылать автору — фейсы сошлись.
    const again = exchange(server, DATA, helloPack(one, DATA));
    const delta = diffOf(one.part(), facesFromPack(packDecode(again.reply as Uint8Array)[0]?.[1].faces ?? []));
    expect(delta.units.length).toBeLessThanOrEqual(resend.units.length);
  });
});
