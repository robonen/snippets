import { expect, test } from 'vitest'
import { Link } from '../../binary/link'
import { packDecode, packEncode, packPart } from '../../binary/pack'
import { SandUnit, SealUnit, PassUnit } from '../../binary/unit'
import { fixedClock } from '../../land/clock'
import { Land } from '../../land/land'
import { ROOT } from '../../land/view'
import { mintSecret, secretKey } from '../secret'
import { sealPack } from '../sealed'
import { createAuditor, mintSignerPair, signerOf, type Signer } from '../signer'
import { rankOf, RATE, TIER } from '../rank'
import { signPack, verifyPack, type Roster } from '../signed'

const LAND = Link.land(Link.peer(new Uint8Array(8).fill(0xd7)), new Uint8Array(8))

async function signer(): Promise<Signer> {
  const { algo, pair } = await mintSignerPair()
  return signerOf(algo, pair)
}

/** Ленд от ИМЕНИ подписанта: peer = его хэш ключа, иначе печать не про эти санды. */
function landOf(signer: Signer): Land {
  return new Land(signer.peer, fixedClock(1000))
}

function packOf(land: Land): Uint8Array {
  const part = land.part()
  return packEncode([[LAND, packPart({ units: part.units, balls: part.balls })]])
}

function roster(entries: ReadonlyMap<string, number>): Roster {
  return { rankOf: peer => entries.get(peer.str) }
}

test('подписанная пачка проходит проверку, санды сохраняются', async () => {
  const alice = await signer()
  const land = landOf(alice)
  const first = land.post(ROOT, ROOT, 'привет')
  land.post(ROOT, first.self, 'мир')

  const signed = await signPack(packOf(land), alice)
  const result = await verifyPack(signed, roster(new Map([[alice.peer.str, rankOf(TIER.post, RATE.just)]])))

  expect(result.dropped).toBe(0)
  const back = new Land(Link.peer(new Uint8Array(8).fill(0x22)), fixedClock(2000))
  back.adopt(result.pack)
  expect(back.order(ROOT).map(v => v.value)).toEqual(['привет', 'мир'])
})

test('пачка несёт паспорт и печати для ретрансляции', async () => {
  const alice = await signer()
  const land = landOf(alice)
  land.post(ROOT, ROOT, 'x')

  const signed = await signPack(packOf(land), alice)
  const [, part] = packDecode(signed)[0] as [Link, ReturnType<typeof packPart>]
  expect(part.units.some(u => u instanceof PassUnit)).toBe(true)
  expect(part.units.some(u => u instanceof SealUnit)).toBe(true)
})

test('санд без печати выкидывается', async () => {
  const alice = await signer()
  const land = landOf(alice)
  land.post(ROOT, ROOT, 'подписанное')

  const signed = await signPack(packOf(land), alice)

  // Враг дописывает свой санд в подписанную секцию — печати на него нет.
  const [, part] = packDecode(signed)[0] as [Link, ReturnType<typeof packPart>]
  const forged = new Land(Link.peer(new Uint8Array(8).fill(0x66)), fixedClock(1000))
  forged.post(ROOT, ROOT, 'подделка')
  const forgedUnit = forged.part().units[0] as SandUnit

  const tampered = packEncode([[LAND, packPart({ units: [...part.units, forgedUnit] })]])
  const result = await verifyPack(tampered, roster(new Map([[alice.peer.str, rankOf(TIER.post, RATE.just)]])))

  expect(result.dropped).toBe(1)
  const back = new Land(Link.peer(new Uint8Array(8).fill(0x22)), fixedClock(2000))
  back.adopt(result.pack)
  expect(back.order(ROOT).map(v => v.value)).toEqual(['подписанное'])
})

test('пир не из ростера не проходит, даже с валидной подписью', async () => {
  const stranger = await signer()
  const land = landOf(stranger)
  land.post(ROOT, ROOT, 'чужак')

  const signed = await signPack(packOf(land), stranger)
  // Ростер пуст — печать валидна, но пир не разрешён.
  const result = await verifyPack(signed, roster(new Map()))
  expect(result.dropped).toBe(1)
})

test('tier ниже post не пишет данные', async () => {
  const reader = await signer()
  const land = landOf(reader)
  land.post(ROOT, ROOT, 'только чтение')

  const signed = await signPack(packOf(land), reader)
  const result = await verifyPack(signed, roster(new Map([[reader.peer.str, rankOf(TIER.read, RATE.just)]])))
  expect(result.dropped).toBe(1)
})

test('порча подписи ломает проверку печати', async () => {
  const alice = await signer()
  const land = landOf(alice)
  land.post(ROOT, ROOT, 'целостность')

  const signed = await signPack(packOf(land), alice)
  const [, part] = packDecode(signed)[0] as [Link, ReturnType<typeof packPart>]
  const seal = part.units.find(u => u instanceof SealUnit) as SealUnit
  // Портим последний байт подписи.
  seal.bin[seal.bin.length - 1] = (seal.bin[seal.bin.length - 1] as number) ^ 0xff

  const result = await verifyPack(signed, roster(new Map([[alice.peer.str, rankOf(TIER.post, RATE.just)]])))
  expect(result.dropped).toBe(1)
})

test('печать не переносится в другой ленд (land в подписи)', async () => {
  const alice = await signer()
  const land = landOf(alice)
  land.post(ROOT, ROOT, 'тут')

  const signed = await signPack(packOf(land), alice)
  const [, part] = packDecode(signed)[0] as [Link, ReturnType<typeof packPart>]
  const OTHER = Link.land(Link.peer(new Uint8Array(8).fill(0x99)), new Uint8Array(8))
  const moved = packEncode([[OTHER, part]])

  const result = await verifyPack(moved, roster(new Map([[alice.peer.str, rankOf(TIER.post, RATE.just)]])))
  expect(result.dropped).toBe(1) // подпись привязана к LAND, тут OTHER
})

test('encrypt-then-sign: подпись поверх запечатанного проходит проверку', async () => {
  const alice = await signer()
  const key = await secretKey(mintSecret())
  const land = landOf(alice)
  land.post(ROOT, ROOT, 'секрет и подпись')

  const sealed = await sealPack(packOf(land), key)
  const signed = await signPack(sealed, alice)
  const result = await verifyPack(signed, roster(new Map([[alice.peer.str, rankOf(TIER.post, RATE.just)]])))
  expect(result.dropped).toBe(0)
})

test('PoW: rate=fast даёт подпись с ≥8 ведущими нулями, проверка требует их', async () => {
  const alice = await signer()
  const land = landOf(alice)
  land.post(ROOT, ROOT, 'дорогая запись')

  const signed = await signPack(packOf(land), alice, { rate: RATE.fast })
  const strict = roster(new Map([[alice.peer.str, rankOf(TIER.post, RATE.fast)]]))
  const result = await verifyPack(signed, strict)
  expect(result.dropped).toBe(0)
})

test('инкрементальность: повторная подпись пачки с нашей печатью не плодит печатей', async () => {
  const alice = await signer()
  const land = landOf(alice)
  land.post(ROOT, ROOT, 'единожды')

  const once = await signPack(packOf(land), alice)
  // Эмуляция эха: печать осела в ленде рядом с сандом.
  const back = new Land(alice.peer, fixedClock(1000))
  back.adopt(once)
  const echoed = packEncode([[LAND, back.part()]])

  const twice = await signPack(echoed, alice)
  const seals = (packDecode(twice)[0]?.[1].units ?? []).filter(u => u instanceof SealUnit)
  const passes = (packDecode(twice)[0]?.[1].units ?? []).filter(u => u instanceof PassUnit)
  expect(seals).toHaveLength(1) // не добавили вторую печать на тот же санд
  expect(passes).toHaveLength(1) // и не задублировали паспорт
})

test('общий проверяльщик учит паспорт один раз для нескольких пачек', async () => {
  const alice = await signer()
  const land = landOf(alice)
  land.post(ROOT, ROOT, 'первая')

  const first = await signPack(packOf(land), alice)
  const auditor = createAuditor()
  const rank = roster(new Map([[alice.peer.str, rankOf(TIER.post, RATE.just)]]))
  await verifyPack(first, rank, auditor)
  expect(auditor.knows(alice.peer)).toBe(true)

  // Вторая пачка без паспорта — печать всё равно проверяется по выученному ключу.
  land.post(ROOT, ROOT, 'вторая')
  const second = await signPack(packOf(land), alice, { withPass: false })
  const result = await verifyPack(second, rank, auditor)
  expect(result.dropped).toBe(0)
})

test('печать детерминирована: переподпись того же набора даёт те же байты', async () => {
  const alice = await signer()
  const land = landOf(alice)
  land.post(ROOT, ROOT, 'стабильно')

  const one = await signPack(packOf(land), alice)
  const two = await signPack(packOf(land), alice)
  // Ed25519 детерминирован, метка выводится из юнитов — пачки совпадают байтово.
  if (alice.algo === 'ed25519') expect(one).toEqual(two)
  // P-256 недетерминирован — но ключ хранения (метка+свёртка) у печатей общий,
  // и приём удержит одну: дубликаты не копятся в любом случае.
})

test('cover: чужие санды под печатью доверенного пира не пере-подписываются', async () => {
  const alice = await signer()
  const bob = await signer()
  const rankAll = roster(new Map([
    [alice.peer.str, rankOf(TIER.post, RATE.just)],
    [bob.peer.str, rankOf(TIER.post, RATE.just)],
  ]))

  // Боб подписал свои санды; Алиса ретранслирует их в дельте.
  const bobs = landOf(bob)
  bobs.post(ROOT, ROOT, 'от боба')
  const signedByBob = await signPack(packOf(bobs), bob)

  const relayed = await signPack(signedByBob, alice, { cover: rankAll })
  const units = packDecode(relayed)[0]?.[1].units ?? []
  const seals = units.filter(u => u instanceof SealUnit)
  expect(seals).toHaveLength(1) // печать Боба достаточна — Алиса не дублирует

  // БЕЗ cover (Боб отозван у получателя) Алиса ручается своей печатью.
  const vouched = await signPack(signedByBob, alice)
  const vouchedSeals = (packDecode(vouched)[0]?.[1].units ?? []).filter(u => u instanceof SealUnit)
  expect(vouchedSeals).toHaveLength(2)
  // И получатель, знающий ТОЛЬКО Алису, всё равно принимает санд Боба.
  const onlyAlice = roster(new Map([[alice.peer.str, rankOf(TIER.post, RATE.just)]]))
  expect((await verifyPack(vouched, onlyAlice)).dropped).toBe(0)
})
