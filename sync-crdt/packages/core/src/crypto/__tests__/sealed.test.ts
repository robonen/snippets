import { expect, test } from 'vitest'
import { Link } from '../../binary/link'
import { packDecode, packEncode, packPart } from '../../binary/pack'
import { SAND_AT, SandUnit } from '../../binary/unit'
import { fixedClock } from '../../land/clock'
import { Land } from '../../land/land'
import { ROOT } from '../../land/view'
import { memoryStore } from '../../store/memory'
import { diffOf, facesFromPack } from '../../wire/face'
import { exchange, helloPack } from '../../wire/exchange'
import { mintSecret, secretKey } from '../secret'
import { CryptoError, openPack, sealPack } from '../sealed'
import { sealedStore } from '../store'
import type { SubtleKey } from '../keys'

const LAND = Link.land(Link.peer(new Uint8Array(8).fill(0xd7)), new Uint8Array(8))
const OTHER = Link.land(Link.peer(new Uint8Array(8).fill(0x99)), new Uint8Array(8))

function peerOf(fill: number): Link {
  return Link.peer(new Uint8Array(8).fill(fill))
}

function device(fill: number, session = 0): Land {
  return new Land(peerOf(fill), fixedClock(1000), { session })
}

function valuesOf(land: Land): unknown[] {
  return land.order(ROOT).map((view) => view.value)
}

/** Пачка ленда целиком — как её собирает провод. */
function packOf(land: Land): Uint8Array {
  const part = land.part()
  return packEncode([[LAND, packPart({ units: part.units, balls: part.balls })]])
}

async function landKey(): Promise<SubtleKey> {
  return secretKey(mintSecret())
}

// ── Тождества ────────────────────────────────────────────────────────────────

test('seal → open restores the pack byte for byte: inline, boundary, ball, tombstone', async () => {
  const land = device(0x11)
  const first = land.post(ROOT, ROOT, 'короткое')
  // 47…62 Б открытого — после метки GCM уезжает в ball и обязано вернуться.
  const edge = land.post(ROOT, first.self, 'я'.repeat(30))
  // Честный ball и в открытой форме.
  const big = land.post(ROOT, edge.self, 'много '.repeat(100))
  land.post(ROOT, big.self, 'на снос')
  land.remove(big.self)

  const key = await landKey()
  const plain = packOf(land)
  const sealed = await sealPack(plain, key)
  const opened = await openPack(sealed, key)

  expect(opened).toEqual(plain)
})

test('sealing is deterministic: two seals of the same pack match byte for byte', async () => {
  const land = device(0x11)
  land.post(ROOT, ROOT, 'значение')

  const key = await landKey()
  const plain = packOf(land)
  expect(await sealPack(plain, key)).toEqual(await sealPack(plain, key))
})

test('identical values on different nodes encrypt to different bytes (the nonce is unique)', async () => {
  // Два сеанса одного пира — худший для нонса случай (ADR-017): одинаковые
  // значения, местами одинаковые метки времени.
  const one = device(0x11, 0x000010)
  const two = device(0x11, 0x800010)
  for (let i = 0; i < 20; i++) {
    one.post(ROOT, ROOT, 'повтор')
    two.post(ROOT, ROOT, 'повтор')
  }
  two.apply(packDecode(packOf(one))[0]?.[1].units ?? [])

  const key = await landKey()
  const sealed = await sealPack(packOf(two), key)

  const payloads = new Set<string>()
  let sands = 0
  for (const [, part] of packDecode(sealed)) {
    for (const unit of part.units) {
      if (!(unit instanceof SandUnit)) continue
      sands += 1
      payloads.add(unit.bytes().join(','))
    }
  }
  expect(sands).toBe(40)
  expect(payloads.size).toBe(40)
})

test('no plaintext in a sealed pack', async () => {
  const land = device(0x11)
  land.post(ROOT, ROOT, 'сугубо личное признание')

  const key = await landKey()
  const sealed = await sealPack(packOf(land), key)

  const needle = new TextEncoder().encode('личное')
  const haystack = sealed.join(',')
  expect(haystack.includes(needle.join(','))).toBe(false)
})

// ── Слепой пир ───────────────────────────────────────────────────────────────

test('a peer without the key merges and relays the sealed land', async () => {
  const key = await landKey()

  const one = device(0x11, 0x000010)
  const two = device(0x11, 0x800010)
  const first = one.post(ROOT, ROOT, 'с первого')
  two.adopt(packOf(one))

  // Сервер: свой пир, НИКАКОГО ключа. Живёт на запечатанных юнитах.
  const server = new Land(peerOf(0x5e), fixedClock(2000))
  exchange(server, LAND, await sealPack(packOf(one), key))
  expect(server.size()).toBe(1)

  // Второе устройство здоровается, сервер отвечает запечатанной дельтой.
  const hello = exchange(server, LAND, helloPack(two, LAND))
  expect(hello.reply).not.toBeNull()
  const applied = two.adopt(await openPack(hello.reply as Uint8Array, key))
  expect(applied).toBe(0) // юнит первого уже влит выше — эхо гаснет

  // Встречная правка уезжает на сервер запечатанной и доходит до первого.
  two.post(ROOT, first.self, 'со второго')
  const delta = diffOf(two.part(), facesFromPack(packDecode(hello.reply as Uint8Array)[0]?.[1].faces ?? []))
  const push = exchange(
    server,
    LAND,
    await sealPack(packEncode([[LAND, packPart({ units: delta.units, balls: delta.balls })]]), key),
  )
  expect(push.taken).toBe(1)

  const refresh = exchange(server, LAND, helloPack(one, LAND))
  one.adopt(await openPack(refresh.reply as Uint8Array, key))
  expect(valuesOf(one)).toEqual(['с первого', 'со второго'])
  expect(valuesOf(two)).toEqual(['с первого', 'со второго'])
})

// ── Отказы ───────────────────────────────────────────────────────────────────

test('corruption of any payload byte is caught', async () => {
  const land = device(0x11)
  land.post(ROOT, ROOT, 'целостность')

  const key = await landKey()
  const sealed = await sealPack(packOf(land), key)

  // Портим первый байт payload единственного санда — через окно юнита в пачку.
  // Хвост выравнивания портить бессмысленно: он вне шифртекста и вне связки.
  const [, part] = packDecode(sealed)[0] as [Link, ReturnType<typeof packPart>]
  const sand = part.units.find((unit) => unit instanceof SandUnit) as SandUnit
  sand.bin[SAND_AT.payload] = (sand.bin[SAND_AT.payload] as number) ^ 0xff
  await expect(openPack(sealed, key)).rejects.toThrow(CryptoError)
})

test('a foreign key does not open', async () => {
  const land = device(0x11)
  land.post(ROOT, ROOT, 'секрет')

  const sealed = await sealPack(packOf(land), await landKey())
  await expect(openPack(sealed, await landKey())).rejects.toThrow(CryptoError)
})

test('ciphertext of one land cannot be passed off as another', async () => {
  const land = device(0x11)
  land.post(ROOT, ROOT, 'не переносится')

  const key = await landKey()
  const sealed = await sealPack(packOf(land), key)

  // Те же юниты, но под заголовком другого ленда: связка в AAD не сойдётся.
  const [, part] = packDecode(sealed)[0] as [Link, ReturnType<typeof packPart>]
  const relabeled = packEncode([[OTHER, part]])
  await expect(openPack(relabeled, key)).rejects.toThrow(CryptoError)
})

test('a plaintext pack does not pass itself off as sealed', async () => {
  const land = device(0x11)
  land.post(ROOT, ROOT, 'x') // payload короче метки GCM

  await expect(openPack(packOf(land), await landKey())).rejects.toThrow(/does not look sealed/)
})

test('a value at the ball cap does not fit after encryption — an honest refusal', async () => {
  const land = device(0x11)
  land.post(ROOT, ROOT, 'q'.repeat(65530))

  await expect(sealPack(packOf(land), await landKey())).rejects.toThrow(/cap/)
})

test('openPack with onDrop skips a poisoned unit and keeps the rest', async () => {
  // Устройство до подключения запечатало юнит СВОИМ секретом и залило на
  // сервер; после присоединения этот секрет никому не известен. Сервер (пир
  // без ключа) честно несёт оба юнита в одной дельте — отравленный обязан
  // выбыть поодиночке, иначе один мусорный юнит глушил бы дельту навсегда.
  const key = await landKey()
  const foreign = await landKey()

  const one = device(0x11, 0x000010)
  const two = device(0x22, 0x800010)
  one.post(ROOT, ROOT, 'наше')
  two.post(ROOT, ROOT, 'чужое до подключения')

  const server = new Land(peerOf(0x5e), fixedClock(2000))
  server.adopt(await sealPack(packOf(one), key))
  server.adopt(await sealPack(packOf(two), foreign))
  const mixed = packOf(server)

  const drops: CryptoError[] = []
  const opened = await openPack(mixed, key, (error) => drops.push(error))
  expect(drops).toHaveLength(1)

  const reader = device(0x77)
  reader.adopt(opened)
  expect(valuesOf(reader)).toEqual(['наше'])

  // Контракт без onDrop прежний: бросок на первом же несовпадении.
  await expect(openPack(mixed, key)).rejects.toThrow(CryptoError)
})

// ── Хранилище ────────────────────────────────────────────────────────────────

test('sealedStore: ciphertext on the medium, the land reads after restart', async () => {
  const key = await landKey()
  const inner = memoryStore()
  const store = sealedStore(inner, { secretOf: () => key })

  const land = device(0x11)
  land.track()
  land.post(ROOT, ROOT, 'переживёт перезапуск')
  await store.save(LAND, land.flush(LAND))

  // На внутреннем носителе открытого текста нет, но юнит там есть.
  const raw = await inner.load(LAND)
  expect(raw.join(',').includes(new TextEncoder().encode('перезапуск').join(','))).toBe(false)
  const blind = device(0x77)
  expect(blind.adopt(raw.slice())).toBe(1)

  // «Перезапуск»: свежий ленд поднимается через обёртку и читает значение.
  const next = device(0x11)
  next.adopt(await store.load(LAND))
  expect(valuesOf(next)).toEqual(['переживёт перезапуск'])
})

test('sealedStore: a land without a secret travels as is', async () => {
  const inner = memoryStore()
  const store = sealedStore(inner, { secretOf: () => null })

  const land = device(0x11)
  land.track()
  land.post(ROOT, ROOT, 'открытый ленд')
  await store.save(LAND, land.flush(LAND))

  const next = device(0x11)
  next.adopt(await store.load(LAND))
  expect(valuesOf(next)).toEqual(['открытый ленд'])
})
