import fc from 'fast-check'
import { describe, expect, expectTypeOf, test } from 'vitest'
import { Link } from '../link'
import { packGolden as golden } from './golden'
import {
  FACE_AT,
  type LandId,
  PACK_AT,
  PACK_BYTES,
  PACK_MAGIC,
  type PackFace,
  type PackPart,
  type PackParts,
  PackError,
  type PackPool,
  packDecode,
  packEncode,
  packLength,
  packPart,
} from '../pack'
import {
  type AnyUnit,
  GiftUnit,
  PassUnit,
  SandUnit,
  SealUnit,
  UnitError,
  shotKey,
} from '../unit'

// ── Оснастка ─────────────────────────────────────────────────────────────────

function bytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

function hex(bin: Uint8Array): string {
  let out = ''
  for (const b of bin) out += b.toString(16).padStart(2, '0')
  return out
}

/** Байты, различимые глазом: `fill(3, 6)` → `030303030303`. */
function fill(value: number, size: number): Uint8Array {
  return new Uint8Array(size).fill(value)
}

const PEER_A = bytes('a0a1a2a3a4a5a6a7')
const PEER_B = bytes('b0b1b2b3b4b5b6b7')
const AREA = bytes('0102030405060708')

const peerA = Link.peer(PEER_A)
const peerB = Link.peer(PEER_B)
const landA = Link.land(peerA, AREA)
const landB = Link.peer(PEER_B)

const self = Link.pawn(Link.hole, bytes('010203040506'))
const head = Link.pawn(Link.hole, bytes('0b0c0d0e0f10'))
const lead = Link.pawn(Link.hole, bytes('111213141516'))

function sand(over: Partial<Parameters<typeof SandUnit.make>[0]> = {}): SandUnit {
  return SandUnit.make({ peer: peerA, time: 1, tick: 0, self, head, lead, value: 'hi', ...over })
}

/**
 * Большой санд и его `ball` — пара, которую кодек обязан видеть вместе.
 *
 * `shot` зависит и от метки, и от длины: ключ `balls` — это `shot`, и два санда
 * с одинаковым `shot`, но разной объявленной длиной значат «один ball двух
 * разных размеров». Такой вход кодек отвергает — и правильно делает.
 */
function bigSand(size: number, mark: number, over: Partial<Parameters<typeof SandUnit.makeBig>[0]> = {}): {
  unit: SandUnit
  ball: Uint8Array
  shot: Uint8Array
  key: string
} {
  const shot = fill(mark, 12)
  shot[0] = (size >>> 8) & 0xff
  shot[1] = size & 0xff
  const unit = SandUnit.makeBig({ peer: peerA, time: 7, tick: 1, self, head, lead, size, shot, ...over })
  return { unit, ball: fill(mark ^ 0xff, size), shot, key: shotKey(shot) }
}

const gift = GiftUnit.make({ peer: peerA, time: 2, tick: 0, mate: peerB, tier: 3, rate: 0 })
const seal = SealUnit.make({ peer: peerA, time: 3, tick: 0, hashes: [fill(0x11, 12)], sign: fill(0x22, 64) })
const pass = PassUnit.make({ peer: peerA, time: 4, tick: 0, algo: 'ed25519', key: fill(0x33, 32) })

function face(over: Partial<PackFace> = {}): PackFace {
  return { peer: peerA, time: 100, tick: 2, summ: 5, ...over }
}

/** Часть №`index` — с проверкой, что она вообще есть: `noUncheckedIndexedAccess`. */
function at(parts: PackParts, index: number): [LandId, PackPart] {
  const one = parts[index]
  if (one === undefined) throw new Error(`the pack has no part #${index}, only ${parts.length} total`)
  return one
}

/** Единственная часть пакета. */
function only(parts: PackParts): PackPart {
  expect(parts).toHaveLength(1)
  return at(parts, 0)[1]
}

/** Счётчик освобождённых слотов — минимальная реализация {@link PackPool}. */
function spyPool(): { calls: Array<[number, number]>, pool: PackPool } {
  const calls: Array<[number, number]> = []
  return { calls, pool: { release: (from, size) => void calls.push([from, size]) } }
}

const RUNS = { numRuns: 500 }

// ── Раскладка ────────────────────────────────────────────────────────────────

describe('layout', () => {
  test('offsets and sizes match the specification table (docs/03 §3)', () => {
    expect(PACK_AT).toEqual({ magic: 0, land: 4, faces: 20, pad: 22, body: 24 })
    expect(FACE_AT).toEqual({ peer: 0, tick: 8, time: 10, summ: 14, pad: 18 })
    expect(PACK_BYTES).toEqual({ head: 24, face: 24, magic: 4, land: 16, align: 8 })
    // 'LAND' в ASCII. Метка — она же признак вида слота: 0x4c не может быть
    // видом юнита (тем розданы 1…4) и не может быть свободным слотом (0).
    expect(PACK_MAGIC).toEqual([0x4c, 0x41, 0x4e, 0x44])
    expect(String.fromCharCode(...PACK_MAGIC)).toBe('LAND')
  })

  test('land header assembled by offsets', () => {
    const bin = packEncode([[landA, packPart()]])

    expect(bin.length).toBe(24)
    expect(hex(bin.subarray(0, 4))).toBe('4c414e44')
    expect(hex(bin.subarray(PACK_AT.land, PACK_AT.land + 16))).toBe(hex(PEER_A) + hex(AREA))
    expect(hex(bin.subarray(PACK_AT.faces, PACK_AT.faces + 2))).toBe('0000')
    expect(hex(bin.subarray(PACK_AT.pad, PACK_AT.body))).toBe('0000')
  })

  test('faceCount is written big-endian, like everything multi-byte in the format', () => {
    const faces: PackFace[] = []
    for (let i = 0; i < 0x0102; i++) faces.push(face({ time: i }))
    const bin = packEncode([[landA, packPart({ faces })]])

    expect(hex(bin.subarray(PACK_AT.faces, PACK_AT.faces + 2))).toBe('0102')
  })

  test('each face field reads from its offset in hand-built bytes', () => {
    // Байты выписаны здесь, а не получены кодировщиком: иначе тест проверял бы
    // согласие кода с самим собой, а не с таблицей офсетов.
    const bin = new Uint8Array(48)
    bin.set(bytes('4c414e44'), 0)
    bin.set(PEER_A, 4)
    bin.set(AREA, 12)
    bin.set(bytes('0001'), 20) // faceCount = 1, BE
    bin.set(PEER_B, 24 + FACE_AT.peer)
    bin.set(bytes('0203'), 24 + FACE_AT.tick) // tick, BE
    bin.set(bytes('04050607'), 24 + FACE_AT.time) // time, BE
    bin.set(bytes('08090a0b'), 24 + FACE_AT.summ) // summ, BE

    const parts = packDecode(bin)
    expect(parts).toHaveLength(1)

    const [land, part] = parts[0] as [LandId, ReturnType<typeof packPart>]
    expect(land.str).toBe(landA.str)
    expect(part.faces).toHaveLength(1)

    const one = part.faces[0] as PackFace
    expect(hex(one.peer.bin)).toBe(hex(PEER_B))
    expect(one.tick).toBe(0x0203)
    expect(one.time).toBe(0x04050607)
    expect(one.summ).toBe(0x08090a0b)
  })

  test('all sections are multiples of 8 — the arena rests on this (docs/06 §4)', () => {
    const { unit, ball, key } = bigSand(100, 0x44)
    const bin = packEncode([[landA, packPart({
      faces: [face(), face({ peer: peerB })],
      units: [sand(), gift, seal, pass, unit],
      balls: new Map([[key, ball]]),
    })]])

    expect(bin.length % 8).toBe(0)
    expect(PACK_BYTES.head % 8).toBe(0)
    expect(PACK_BYTES.face % 8).toBe(0)
    for (const one of [sand(), gift, seal, pass, unit]) expect(one.bin.length % 8).toBe(0)
  })

  test('any unit length is a multiple of 8 for any value size', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (value) => {
        expect(sand({ value }).bin.length % 8).toBe(0)
      }),
      RUNS,
    )
  })
})

// ── Наполнение: четыре строки таблицы §3 ─────────────────────────────────────

describe('content semantics (docs/03 §3)', () => {
  test('faces without units — "here is my state"', () => {
    const faces = [face(), face({ peer: peerB, time: 200, tick: 0, summ: 9 })]
    const bin = packEncode([[landA, packPart({ faces })]])

    expect(bin.length).toBe(24 + 2 * 24)

    const [land, part] = at(packDecode(bin), 0)
    expect(land.str).toBe(landA.str)
    expect(part.units).toHaveLength(0)
    expect(part.faces).toHaveLength(2)
    expect(part.faces.map(f => [f.peer.str, f.time, f.tick, f.summ])).toEqual([
      [peerA.str, 100, 2, 5],
      [peerB.str, 200, 0, 9],
    ])
  })

  test('units without faces — a delta', () => {
    const units = [sand(), gift]
    const bin = packEncode([[landA, packPart({ units })]])

    const part = only(packDecode(bin))
    expect(part.faces).toHaveLength(0)
    expect(part.units.map(u => u.kind())).toEqual(['sand', 'gift'])
  })

  test('faces and units — a delta plus a state confirmation', () => {
    const bin = packEncode([[landA, packPart({ faces: [face()], units: [sand()] })]])

    const part = only(packDecode(bin))
    expect(part.faces).toHaveLength(1)
    expect(part.units).toHaveLength(1)
  })

  test('empty — "forget this land": 24 header bytes, not zero', () => {
    const bin = packEncode([[landA, packPart()]])

    // Отписка обязана быть представима. baza на таком входе падала («Empty Pack»),
    // и это единственное расхождение, которое видно снаружи по длине.
    expect(bin.length).toBe(24)

    const [land, part] = at(packDecode(bin), 0)
    expect(land.str).toBe(landA.str)
    expect(part.faces).toHaveLength(0)
    expect(part.units).toHaveLength(0)
  })

  test('a pack with no lands at all is zero bytes and parses into an empty list', () => {
    const bin = packEncode([])
    expect(bin.length).toBe(0)
    expect(packDecode(bin)).toEqual([])
  })
})

// ── Побайтовое тождество ─────────────────────────────────────────────────────

describe('packEncode(packDecode(b)) ≡ b', () => {
  /** Ленд из индекса: разные i дают разные ленды, и ни один не нулевой. */
  const landAt = (i: number): LandId => Link.land(Link.peer(fill(i + 1, 8)), fill(i + 0x80, 8))

  const faceArb = fc.record({
    peer: fc.integer({ min: 0, max: 255 }).map(b => Link.peer(fill(b, 8))),
    time: fc.integer({ min: 0, max: 0xffffffff }),
    tick: fc.integer({ min: 0, max: 0xffff }),
    summ: fc.integer({ min: 0, max: 0xffffffff }),
  })

  /** Рецепт юнита: юнит плюс, если он большой, его `ball`. */
  type Recipe = { unit: AnyUnit, ball: Uint8Array | null, key: string }

  const sandArb: fc.Arbitrary<Recipe> = fc.record({
    time: fc.integer({ min: 0, max: 0xffffffff }),
    tick: fc.integer({ min: 0, max: 0xffff }),
    value: fc.oneof(
      fc.constant(null),
      fc.boolean(),
      fc.integer({ min: -1000, max: 1000 }),
      fc.string({ maxLength: 20 }),
    ),
    // Метка с единицы: нулевой `peer` — это `Link.hole`, а автор у юнита обязателен.
    mark: fc.integer({ min: 1, max: 255 }),
  }).map(({ time, tick, value, mark }) => ({
    unit: sand({ time, tick, value, peer: Link.peer(fill(mark, 8)) }) as AnyUnit,
    ball: null,
    key: '',
  }))

  const bigArb: fc.Arbitrary<Recipe> = fc.record({
    size: fc.integer({ min: 63, max: 300 }),
    mark: fc.integer({ min: 0, max: 255 }),
  }).map(({ size, mark }) => {
    const made = bigSand(size, mark)
    return { unit: made.unit as AnyUnit, ball: made.ball, key: made.key }
  })

  const giftArb: fc.Arbitrary<Recipe> = fc.record({
    tier: fc.integer({ min: 0, max: 15 }),
    rate: fc.integer({ min: 0, max: 15 }),
    time: fc.integer({ min: 0, max: 0xffffffff }),
  }).map(({ tier, rate, time }) => ({
    unit: GiftUnit.make({ peer: peerA, time, tick: 0, mate: peerB, tier, rate, code: fill(tier, 16) }) as AnyUnit,
    ball: null,
    key: '',
  }))

  const sealArb: fc.Arbitrary<Recipe> = fc.record({
    count: fc.integer({ min: 0, max: 15 }),
    wide: fc.boolean(),
  }).map(({ count, wide }) => {
    const hashes: Uint8Array[] = []
    for (let i = 0; i < count; i++) hashes.push(fill(i + 1, 12))
    return {
      unit: SealUnit.make({ peer: peerA, time: 5, tick: 0, hashes, sign: fill(0x77, 64), wide }) as AnyUnit,
      ball: null,
      key: '',
    }
  })

  const passArb: fc.Arbitrary<Recipe> = fc.constantFrom<'ed25519' | 'p256'>('ed25519', 'p256').map(algo => ({
    unit: PassUnit.make({
      peer: peerA,
      time: 6,
      tick: 0,
      algo,
      key: fill(0x55, algo === 'ed25519' ? 32 : 65),
    }) as AnyUnit,
    ball: null,
    key: '',
  }))

  const recipeArb = fc.oneof(sandArb, bigArb, giftArb, sealArb, passArb)

  const partArb = fc.record({
    faces: fc.array(faceArb, { maxLength: 6 }),
    recipes: fc.array(recipeArb, { maxLength: 8 }),
  })

  function assemble(recipes: readonly Recipe[]): { units: AnyUnit[], balls: Map<string, Uint8Array> } {
    const units: AnyUnit[] = []
    const balls = new Map<string, Uint8Array>()
    for (const recipe of recipes) {
      units.push(recipe.unit)
      if (recipe.ball !== null) balls.set(recipe.key, recipe.ball)
    }
    return { units, balls }
  }

  test('a canonical pack survives the round-trip byte for byte', () => {
    fc.assert(
      fc.property(fc.array(partArb, { maxLength: 4 }), (drafts) => {
        const parts: PackParts = drafts.map((draft, i) => {
          const { units, balls } = assemble(draft.recipes)
          return [landAt(i), packPart({ faces: draft.faces, units, balls })]
        })

        const first = packEncode(parts)
        const again = packEncode(packDecode(first))

        expect(hex(again)).toBe(hex(first))
      }),
      RUNS,
    )
  })

  test('parsing restores the fields, not just the bytes', () => {
    fc.assert(
      fc.property(partArb, (draft) => {
        const { units, balls } = assemble(draft.recipes)
        const parts: PackParts = [[landA, packPart({ faces: draft.faces, units, balls })]]

        const [land, part] = at(packDecode(packEncode(parts)), 0)

        expect(land.str).toBe(landA.str)
        expect(part.faces.map(f => [f.peer.str, f.time, f.tick, f.summ]))
          .toEqual(draft.faces.map(f => [f.peer.str, f.time, f.tick, f.summ]))
        expect(part.units.map(u => hex(u.bin))).toEqual(units.map(u => hex(u.bin)))
        expect([...part.balls.keys()].sort()).toEqual([...balls.keys()].sort())
        for (const [key, ball] of balls) expect(hex(part.balls.get(key) as Uint8Array)).toBe(hex(ball))
      }),
      RUNS,
    )
  })

  test('normalization is idempotent: a second round changes nothing', () => {
    const { unit, ball, key } = bigSand(70, 0x9a)
    const parts: PackParts = [
      [landA, packPart({ faces: [face()], units: [sand(), unit], balls: new Map([[key, ball]]) })],
      [landB, packPart({ units: [gift] })],
    ]

    const once = packEncode(packDecode(packEncode(parts)))
    const twice = packEncode(packDecode(once))

    expect(hex(twice)).toBe(hex(once))
  })

  test('packLength promises exactly what packEncode produces', () => {
    fc.assert(
      fc.property(fc.array(partArb, { maxLength: 3 }), (drafts) => {
        const parts: PackParts = drafts.map((draft, i) => {
          const { units, balls } = assemble(draft.recipes)
          return [landAt(i), packPart({ faces: draft.faces, units, balls })]
        })

        expect(packEncode(parts).length).toBe(packLength(parts))
      }),
      RUNS,
    )
  })
})

// ── Несколько лендов ─────────────────────────────────────────────────────────

describe('several lands in one pack', () => {
  test('land order and contents are preserved', () => {
    const landC = Link.land(peerB, bytes('1111111111111111'))
    const parts: PackParts = [
      [landA, packPart({ faces: [face()], units: [sand()] })],
      [landB, packPart({ units: [gift, pass] })],
      [landC, packPart({ faces: [face({ peer: peerB })] })],
    ]

    const decoded = packDecode(packEncode(parts))

    expect(decoded.map(([land]) => land.str)).toEqual([landA.str, landB.str, landC.str])
    expect(decoded.map(([, part]) => part.units.length)).toEqual([1, 2, 0])
    expect(decoded.map(([, part]) => part.faces.length)).toEqual([1, 0, 1])
  })

  test('units do not leak between lands: each goes with its own header', () => {
    const parts: PackParts = [
      [landA, packPart({ units: [sand(), sand({ time: 2 })] })],
      [landB, packPart({ units: [gift] })],
    ]

    const decoded = packDecode(packEncode(parts))
    expect((decoded[0] as PackParts[number])[1].units.map(u => u.kind())).toEqual(['sand', 'sand'])
    expect((decoded[1] as PackParts[number])[1].units.map(u => u.kind())).toEqual(['gift'])
  })

  test('a repeated header of the same land appends to the part instead of starting a second one', () => {
    // Именно так растёт арена: юниты ленда дописываются в конец файла, за чужим
    // заголовком, и своя шапка пишется заново (docs/06 §4).
    const bin = packEncode([
      [landA, packPart({ faces: [face()], units: [sand()] })],
      [landB, packPart({ units: [gift] })],
      [landA, packPart({ faces: [face({ peer: peerB })], units: [pass] })],
    ])

    const decoded = packDecode(bin)

    expect(decoded).toHaveLength(2)
    expect(decoded.map(([land]) => land.str)).toEqual([landA.str, landB.str])

    const first = (decoded[0] as PackParts[number])[1]
    expect(first.units.map(u => u.kind())).toEqual(['sand', 'pass'])
    expect(first.faces.map(f => f.peer.str)).toEqual([peerA.str, peerB.str])

    // Слияние — единственное место, где тождество байтов не держится: две шапки
    // схлопываются в одну. Нормализация после этого идемпотентна.
    const packed = packEncode(decoded)
    expect(packed.length).toBeLessThan(bin.length)
    expect(hex(packEncode(packDecode(packed)))).toBe(hex(packed))
  })

  test('the zero land is representable and survives the round-trip', () => {
    // `Link.hole` — пустые байты, а в заголовке под ленд отведено 16. Кодировщик
    // добивает нулями, разбор канонизирует обратно в пустую ссылку.
    const bin = packEncode([[Link.hole, packPart({ units: [gift] })]])

    expect(hex(bin.subarray(PACK_AT.land, PACK_AT.land + 16))).toBe('0'.repeat(32))

    const [land, part] = at(packDecode(bin), 0)
    expect(land.str).toBe('')
    expect(part.units).toHaveLength(1)
    expect(hex(packEncode(packDecode(bin)))).toBe(hex(bin))
  })

  test('the home land of a lord and the lord itself are one key', () => {
    // `Link` канонизирует нулевую area, значит `land(peer, 0)` и `peer` — одно
    // значение и одна часть, а не две.
    const home = Link.land(peerB, new Uint8Array(8))
    const decoded = packDecode(packEncode([
      [home, packPart({ units: [gift] })],
      [peerB, packPart({ units: [pass] })],
    ]))

    expect(decoded).toHaveLength(1)
    expect((decoded[0] as PackParts[number])[1].units).toHaveLength(2)
  })
})

// ── Арена: свободные слоты ───────────────────────────────────────────────────

describe('arena (docs/06 §4)', () => {
  /** Зануляет `size` байт с офсета `at` — так хранилище удаляет юнит. */
  function wipe(bin: Uint8Array, at: number, size: number): Uint8Array {
    const out = bin.slice()
    out.fill(0, at, at + size)
    return out
  }

  test('a zeroed slot is skipped, the remaining units read fine', () => {
    const units = [sand({ value: 'a' }), gift, sand({ value: 'c' })]
    const bin = packEncode([[landA, packPart({ units })]])

    const at = 24 + (units[0] as SandUnit).bin.length
    const holed = wipe(bin, at, gift.bin.length)

    const part = only(packDecode(holed))
    expect(part.units).toHaveLength(2)
    expect((part.units[0] as SandUnit).value()).toBe('a')
    expect((part.units[1] as SandUnit).value()).toBe('c')
  })

  test('after hole cleanup the bytes match a pack that never had the hole', () => {
    const bin = packEncode([[landA, packPart({ units: [sand({ value: 'a' }), gift, pass] })]])
    const compact = packEncode([[landA, packPart({ units: [sand({ value: 'a' }), pass] })]])

    const holed = wipe(bin, 24 + sand({ value: 'a' }).bin.length, gift.bin.length)

    expect(hex(packEncode(packDecode(holed)))).toBe(hex(compact))
  })

  test('a hole at the start of the file — units not arrived yet, space already freed', () => {
    const bin = packEncode([[landA, packPart({ units: [sand()] })]])
    const holed = new Uint8Array(16 + bin.length)
    holed.set(bin, 16)

    const { calls, pool } = spyPool()
    const part = only(packDecode(holed, { pool }))

    expect(part.units).toHaveLength(1)
    expect(calls).toEqual([[0, 16]])
  })

  test('the pool gets the run as a whole, not in eights', () => {
    const units = [sand(), gift, pass]
    const bin = packEncode([[landA, packPart({ units })]])

    // Зачищаем gift и pass подряд: 48 + 48 байт одним прогоном.
    const at = 24 + units[0]!.bin.length
    const holed = wipe(bin, at, gift.bin.length + pass.bin.length)

    const { calls, pool } = spyPool()
    packDecode(holed, { pool })

    expect(calls).toEqual([[at, gift.bin.length + pass.bin.length]])
  })

  test('the kind byte makes a slot free, not the wiped tail', () => {
    // Хранилище зануляет слот целиком (docs/06 §4), но парсер смотрит только на
    // байт вида: остальные семь — дело того, кто зачищал. Реализация, экономящая
    // запись, остаётся читаемой, а мусор в хвосте не превращается в юнит.
    const units = [sand(), gift]
    const bin = packEncode([[landA, packPart({ units })]])
    const at = 24 + units[0]!.bin.length

    const holed = bin.slice()
    for (let i = at; i < at + gift.bin.length; i += 8) holed[i] = 0

    const { calls, pool } = spyPool()
    const part = only(packDecode(holed, { pool }))

    expect(part.units.map(u => u.kind())).toEqual(['sand'])
    expect(calls).toEqual([[at, gift.bin.length]])
  })

  test('a hole between lands does not break the next header', () => {
    const bin = packEncode([
      [landA, packPart({ units: [sand(), gift] })],
      [landB, packPart({ units: [pass] })],
    ])

    const holed = bin.slice()
    holed.fill(0, 24 + sand().bin.length, 24 + sand().bin.length + gift.bin.length)

    const decoded = packDecode(holed)
    expect(decoded.map(([land]) => land.str)).toEqual([landA.str, landB.str])
    expect(decoded.map(([, part]) => part.units.map(u => u.kind()))).toEqual([['sand'], ['pass']])
  })

  test('the pool is untouched when there are no holes', () => {
    const { calls, pool } = spyPool()
    packDecode(packEncode([[landA, packPart({ units: [sand()] })]]), { pool })
    expect(calls).toEqual([])
  })

  test('offsets tells where each unit lies', () => {
    const units = [sand(), gift, pass]
    const bin = packEncode([[landA, packPart({ faces: [face()], units })]])

    const offsets = new WeakMap<AnyUnit, number>()
    const part = only(packDecode(bin, { offsets }))

    let at = 24 + 24
    for (let i = 0; i < units.length; i++) {
      const unit = part.units[i] as AnyUnit
      expect(offsets.get(unit)).toBe(at)
      // Тот же офсет, что и в буфере: по нему хранилище зачистит слот при удалении.
      expect(hex(bin.subarray(at, at + unit.bin.length))).toBe(hex(unit.bin))
      at += unit.bin.length
    }
  })

  test('a unit is a window into the pack buffer, not a copy', () => {
    const bin = packEncode([[landA, packPart({ units: [sand()] })]])
    const part = only(packDecode(bin))

    // Именно это делает разбор пачки на 10 000 юнитов дешёвым и позволяет файлу
    // быть ареной: юниты не копируются из него никуда.
    expect((part.units[0] as SandUnit).bin.buffer).toBe(bin.buffer)
  })

  test('a zero face stays a face: the face section is counted, not scanned', () => {
    const zero: PackFace = { peer: Link.hole, time: 0, tick: 0, summ: 0 }
    const bin = packEncode([[landA, packPart({ faces: [zero, face()] })]])

    const part = only(packDecode(bin))
    expect(part.faces).toHaveLength(2)
    expect((part.faces[0] as PackFace).peer.str).toBe('')
    expect((part.faces[1] as PackFace).summ).toBe(5)
  })
})

// ── Выносные значения ────────────────────────────────────────────────────────

describe('ball', () => {
  test('ball lies right after its sand, zero-padded to a multiple of 8', () => {
    const { unit, ball, key } = bigSand(100, 0x44)
    const bin = packEncode([[landA, packPart({ units: [unit], balls: new Map([[key, ball]]) })]])

    expect(bin.length).toBe(24 + 48 + 104)
    expect(hex(bin.subarray(24 + 48, 24 + 48 + 100))).toBe(hex(ball))
    expect(hex(bin.subarray(24 + 48 + 100))).toBe('00000000')
  })

  test('ball is retrieved by shotKey and stays a window into the buffer', () => {
    const { unit, ball, key } = bigSand(80, 0x21)
    const bin = packEncode([[landA, packPart({ units: [unit], balls: new Map([[key, ball]]) })]])

    const part = only(packDecode(bin))
    expect([...part.balls.keys()]).toEqual([key])
    expect(hex(part.balls.get(key) as Uint8Array)).toBe(hex(ball))
    expect((part.balls.get(key) as Uint8Array).buffer).toBe(bin.buffer)
  })

  test('a big sand is followed by its ball, not by the next unit', () => {
    const { unit, ball, key } = bigSand(64, 0x5c)
    const bin = packEncode([[landA, packPart({
      units: [unit, gift],
      balls: new Map([[key, ball]]),
    })]])

    const part = only(packDecode(bin))
    expect(part.units.map(u => u.kind())).toEqual(['sand', 'gift'])
  })

  test('a ball starting with a unit kind byte does not derail parsing', () => {
    // Содержимое балла произвольно: там может лежать и 0x00, и 0x4c. Парсер не
    // смотрит на эти байты вовсе — он шагает через `align8(size)`.
    const { unit, key } = bigSand(64, 0x00)
    const ball = new Uint8Array(64)
    ball.set(bytes('4c414e4400000000'), 0)

    const bin = packEncode([[landA, packPart({ units: [unit, gift], balls: new Map([[key, ball]]) })]])
    const part = only(packDecode(bin))

    expect(part.units.map(u => u.kind())).toEqual(['sand', 'gift'])
    expect(hex(part.balls.get(key) as Uint8Array)).toBe(hex(ball))
  })

  test('two sands with the same shot share one ball', () => {
    const { unit, ball, shot, key } = bigSand(64, 0x33)
    const twin = SandUnit.makeBig({ peer: peerB, time: 9, tick: 0, self, head, lead, size: 64, shot })

    const bin = packEncode([[landA, packPart({ units: [unit, twin], balls: new Map([[key, ball]]) })]])
    const part = only(packDecode(bin))

    expect(part.units).toHaveLength(2)
    expect(part.balls.size).toBe(1)
    expect(hex(packEncode(packDecode(bin)))).toBe(hex(bin))
  })
})

// ── Отказы ───────────────────────────────────────────────────────────────────

describe('corrupt input is rejected clearly', () => {
  const valid = packEncode([[landA, packPart({ faces: [face()], units: [sand(), gift] })]])

  test('length not a multiple of 8', () => {
    expect(() => packDecode(valid.subarray(0, valid.length - 4)))
      .toThrow(/not a multiple of 8/)
    expect(() => packDecode(valid.subarray(0, valid.length - 4))).toThrow(PackError)
  })

  test('truncated land header', () => {
    expect(() => packDecode(valid.subarray(0, 16))).toThrow(/land header is 24 B, but only 16 left in the pack/)
  })

  test('foreign marker instead of LAND', () => {
    const bad = valid.slice()
    bad[2] = 0x58 // 'X'
    expect(() => packDecode(bad)).toThrow(/expected the "LAND" marker, got 4c4158/)
  })

  test('non-zero header padding', () => {
    const bad = valid.slice()
    bad[PACK_AT.pad] = 1
    expect(() => packDecode(bad)).toThrow(/header padding .* must be zero/)
  })

  test('non-zero face padding', () => {
    const bad = valid.slice()
    bad[24 + FACE_AT.pad + 2] = 0xff
    expect(() => packDecode(bad)).toThrow(/face padding .* must be zero/)
  })

  test('more faces declared than fit', () => {
    const bad = valid.slice()
    bad[PACK_AT.faces] = 0xff
    expect(() => packDecode(bad)).toThrow(/\d+ faces declared .*, but only \d+ left in the pack/)
  })

  test('unit before the first land header', () => {
    const orphan = sand().bin.slice()
    expect(() => packDecode(orphan)).toThrow(/unit of kind #1 before the first land header/)
  })

  test('unknown unit kind — with offset and UnitError in cause', () => {
    const bad = valid.slice()
    bad[24 + 24] = 9

    expect(() => packDecode(bad)).toThrow(PackError)
    try {
      packDecode(bad)
      expect.unreachable('parsing must have refused')
    } catch (error) {
      expect(error).toBeInstanceOf(PackError)
      const fail = error as PackError
      expect(fail.message).toContain('kind #9 is unknown')
      expect(fail.at).toBe(`land ${landA.str}, offset 48`)
      expect(fail.cause).toBeInstanceOf(UnitError)
    }
  })

  test('unit does not fit in the rest of the pack', () => {
    const cut = valid.subarray(0, valid.length - 8)
    expect(() => packDecode(cut)).toThrow(/unit declared \d+ B, but only \d+ left in the pack/)
  })

  test('ball does not fit in the rest of the pack', () => {
    const { unit, ball, key } = bigSand(100, 0x44)
    const bin = packEncode([[landA, packPart({ units: [unit], balls: new Map([[key, ball]]) })]])

    expect(() => packDecode(bin.subarray(0, bin.length - 8)))
      .toThrow(/sand declared an external value of 100 B, but only 96 left in the pack/)
  })

  test('non-zero ball padding', () => {
    const { unit, ball, key } = bigSand(100, 0x44)
    const bin = packEncode([[landA, packPart({ units: [unit], balls: new Map([[key, ball]]) })]])
    bin[bin.length - 1] = 1

    expect(() => packDecode(bin)).toThrow(/ball padding to a multiple of 8 must be zero/)
  })

  test('pawn instead of a land', () => {
    const pawn = Link.pawn(landA, bytes('010101010101'))
    expect(() => packEncode([[pawn, packPart()]])).toThrow(/land is 16 B, but the link is 22 B/)
  })

  test('big sand without an attached ball', () => {
    const { unit } = bigSand(100, 0x44)
    expect(() => packEncode([[landA, packPart({ units: [unit] })]]))
      .toThrow(/no ball is attached/)
  })

  test('ball of the wrong length', () => {
    const { unit, key } = bigSand(100, 0x44)
    expect(() => packEncode([[landA, packPart({ units: [unit], balls: new Map([[key, fill(1, 99)]]) })]]))
      .toThrow(/unit declared 100 B, 99 attached/)
  })

  test('face field out of range', () => {
    expect(() => packEncode([[landA, packPart({ faces: [face({ time: 2 ** 32 })] })]]))
      .toThrow(/time = 4294967296: expected an integer 0…4294967295/)
    expect(() => packEncode([[landA, packPart({ faces: [face({ tick: -1 })] })]]))
      .toThrow(/tick = -1/)
    expect(() => packEncode([[landA, packPart({ faces: [face({ summ: 1.5 })] })]]))
      .toThrow(/summ = 1.5/)
  })

  test('land instead of a peer in a face', () => {
    expect(() => packEncode([[landA, packPart({ faces: [face({ peer: landA })] })]]))
      .toThrow(/peer is 8 B, but the link is 16 B/)
  })

  test('more faces than the counter fits', () => {
    const faces: PackFace[] = []
    for (let i = 0; i <= 0x10000; i++) faces.push(face())
    expect(() => packLength([[landA, packPart({ faces })]])).toThrow(/65537 faces, but the two header bytes/)
  })

  test('the refusal message carries a coordinate, not just text', () => {
    try {
      packEncode([[landA, packPart({ faces: [face(), face({ tick: 99999 })] })]])
      expect.unreachable('encoding must have refused')
    } catch (error) {
      expect(error).toBeInstanceOf(PackError)
      expect((error as PackError).at).toBe(`land ${landA.str}, face #1`)
    }
  })
})

// ── Типы ─────────────────────────────────────────────────────────────────────

describe('types', () => {
  test('a pack part is one shape, all fields required', () => {
    const part = packPart()
    expectTypeOf(part.faces).toEqualTypeOf<readonly PackFace[]>()
    expectTypeOf(part.units).toEqualTypeOf<readonly AnyUnit[]>()
    expectTypeOf(part.balls).toEqualTypeOf<ReadonlyMap<string, Uint8Array>>()
    expect(Object.keys(part).sort()).toEqual(['balls', 'faces', 'units'])
  })

  test('LandId is Link', () => {
    expectTypeOf<LandId>().toEqualTypeOf<Link>()
  })
})

// ── Golden-векторы ───────────────────────────────────────────────────────────
//
// Фикстуру читает общий `./golden`: те же векторы гоняются в Chromium
// (`cross-runtime.test.ts`), а туда `node:fs` не едет.

describe('golden vectors', () => {
  test('fixture is not empty — otherwise the test is green about nothing', () => {
    expect(golden.vectors.length).toBeGreaterThanOrEqual(6)
  })

  for (const vector of golden.vectors) {
    test(`parses: ${vector.note}`, () => {
      const bin = bytes(vector.hex)
      const parts = packDecode(bin)

      expect(parts.map(([land]) => land.str)).toEqual(vector.lands.map(l => l.land))

      for (let i = 0; i < vector.lands.length; i++) {
        const want = vector.lands[i]!
        const part = (parts[i] as PackParts[number])[1]

        expect(part.faces.map(f => ({ peer: f.peer.str, time: f.time, tick: f.tick, summ: f.summ })))
          .toEqual(want.faces)
        expect(part.units.map(u => hex(u.bin))).toEqual(want.units)
        expect([...part.balls.values()].map(b => hex(b))).toEqual(want.balls)
      }
    })

    test(`re-encodes byte for byte: ${vector.note}`, () => {
      const bin = bytes(vector.hex)
      expect(hex(packEncode(packDecode(bin)))).toBe(vector.hex)
    })
  }
})
