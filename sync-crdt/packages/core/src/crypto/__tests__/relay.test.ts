import { expect, test } from 'vitest'
import { Link } from '../../binary/link'
import { packEncode, packPart } from '../../binary/pack'
import { SealUnit, PassUnit } from '../../binary/unit'
import { fixedClock } from '../../land/clock'
import { Land } from '../../land/land'
import { ROOT } from '../../land/view'
import { exchange, helloPack } from '../../wire/exchange'
import { mintSecret, secretKey } from '../secret'
import { openPack, sealPack } from '../sealed'
import { mintSignerPair, signerOf, type Signer } from '../signer'
import { rankOf, RATE, TIER } from '../rank'
import { signPack, verifyPack, type Roster } from '../signed'

const LAND = Link.land(Link.peer(new Uint8Array(8).fill(0xd7)), new Uint8Array(8))

async function signer(): Promise<Signer> {
  const { algo, pair } = await mintSignerPair()
  return signerOf(algo, pair)
}

function roster(map: ReadonlyMap<string, number>): Roster {
  return { rankOf: peer => map.get(peer.str) }
}

function packOf(land: Land): Uint8Array {
  const part = land.part()
  return packEncode([[LAND, packPart({ units: part.units, balls: part.balls })]])
}

/**
 * Боевой конвейер отправки: sealPack (шифр) → signPack (подпись поверх шифра).
 * Порядок несущий — печать покрывает хэши ЗАПЕЧАТАННЫХ юнитов, поэтому на
 * приёме проверка идёт по шифртексту (verifyPack), и только потом openPack.
 */
async function send(land: Land, key: Awaited<ReturnType<typeof secretKey>>, s: Signer): Promise<Uint8Array> {
  return signPack(await sealPack(packOf(land), key), s)
}

async function receive(
  bin: Uint8Array,
  key: Awaited<ReturnType<typeof secretKey>>,
  rank: Roster,
): Promise<{ pack: Uint8Array, dropped: number }> {
  const verified = await verifyPack(bin, rank) // на ШИФРТЕКСТЕ
  return { pack: await openPack(verified.pack, key), dropped: verified.dropped }
}

test('seals reach the second device through a blind server', async () => {
  const alice = await signer()
  const key = await secretKey(mintSecret())
  const rank = roster(new Map([[alice.peer.str, rankOf(TIER.post, RATE.just)]]))

  const one = new Land(alice.peer, fixedClock(1000))
  const first = one.post(ROOT, ROOT, 'первая')
  one.post(ROOT, first.self, 'вторая')

  // Сервер: свой пир, НИ ключа, НИ ростера — просто пир ядра.
  const server = new Land(Link.peer(new Uint8Array(8).fill(0x5e)), fixedClock(2000))
  exchange(server, LAND, await send(one, key, alice))

  // Сервер сохранил и санды, и печати с паспортом — иначе ретрансляция потеряла
  // бы аутентичность.
  const stored = server.part().units
  expect(stored.some(u => u instanceof SealUnit)).toBe(true)
  expect(stored.some(u => u instanceof PassUnit)).toBe(true)

  // Второе устройство здоровается, сервер отдаёт запечатанную+подписанную дельту.
  const two = new Land(Link.peer(new Uint8Array(8).fill(0x22)), fixedClock(3000))
  const hello = exchange(server, LAND, helloPack(two, LAND))
  const got = await receive(hello.reply as Uint8Array, key, rank)

  expect(got.dropped).toBe(0)
  two.adopt(got.pack)
  expect(two.order(ROOT).map(v => v.value)).toEqual(['первая', 'вторая'])
})

test('a sand injected at the server without a seal is rejected by the second device', async () => {
  const alice = await signer()
  const key = await secretKey(mintSecret())
  const rank = roster(new Map([[alice.peer.str, rankOf(TIER.post, RATE.just)]]))

  const one = new Land(alice.peer, fixedClock(1000))
  one.post(ROOT, ROOT, 'честная')

  const server = new Land(Link.peer(new Uint8Array(8).fill(0x5e)), fixedClock(2000))
  exchange(server, LAND, await send(one, key, alice))

  // Злой сервер вбрасывает свой санд БЕЗ печати — подделка заголовка, которую
  // до S6 никто не ловил. Ключ шифрования он в этом тесте знает (worst case).
  const evil = new Land(Link.peer(new Uint8Array(8).fill(0x66)), fixedClock(2000))
  evil.post(ROOT, ROOT, 'вброс сервера')
  exchange(server, LAND, await sealPack(packOf(evil), key))

  const two = new Land(Link.peer(new Uint8Array(8).fill(0x22)), fixedClock(3000))
  const hello = exchange(server, LAND, helloPack(two, LAND))
  const got = await receive(hello.reply as Uint8Array, key, rank)

  expect(got.dropped).toBe(1) // вброс отвергнут
  two.adopt(got.pack)
  expect(two.order(ROOT).map(v => v.value)).toEqual(['честная'])
})
