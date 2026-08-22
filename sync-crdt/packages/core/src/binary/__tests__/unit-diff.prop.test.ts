// Перекрёстная сверка бинарного юнита со второй, независимой реализацией.
//
// `unit.test.ts` проверяет юнит им же самим: собрали фабрикой — прочитали
// аксессорами. Такая пара сойдётся и при неверно прочитанной раскладке: ошибка
// окажется общей у обеих сторон. Golden-векторы чуть лучше, но их выписал тот же
// человек из того же понимания формата. Здесь байты читает `unit-reference.ts`,
// написанный по ТАБЛИЦЕ ОФСЕТОВ из docs/03 §2, и расхождение прочтений
// становится красным тестом.
//
// Помощники (hex, сравнение значений, генераторы) написаны заново, а не взяты из
// `unit.test.ts`: общий помощник — это общая ошибка, ровно то, от чего сверка и
// защищает.
//
// Разделы:
//   1. поля: собрать боевой фабрикой → прочитать прибором → сверить (20 000);
//   2. порядок: `Unit.compare` против независимого оракула и против обещанного
//      §2 `memcmp` 14 байт (20 000 пар);
//   3. порядок против `src/land/lww.ts` — можно ли переключить слой ленда;
//   4. golden-векторы, прочитанные прибором;
//   5. чувствительность самой сверки и каноничность байт.

import { readFileSync } from 'node:fs'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { compare as lwwCompare } from '../../land/lww'
import type { Sand } from '../../land/sand'
import { Link } from '../link'
import {
  GiftUnit,
  PassUnit,
  SandUnit,
  SealUnit,
  Unit,
  parseUnit,
  unitLength,
  type AnyUnit,
  type PassAlgo,
  type SandTag,
} from '../unit'
import { varyEncode, type Vary } from '../vary'
import { memcmpCompare, readUnit, refCompare, refHex, UnitMismatch, type RefSand, type RefUnit } from './unit-reference'

// ── Помощники ────────────────────────────────────────────────────────────────

/** Прогонов на каждое свойство сверки — задание требует не меньше 20 000. */
const RUNS = 20_000

function hex(bin: Uint8Array): string {
  let out = ''
  for (const byte of bin) out += byte.toString(16).padStart(2, '0')
  return out
}

function unhex(text: string): Uint8Array {
  const out = new Uint8Array(text.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(text.slice(i * 2, i * 2 + 2), 16)
  return out
}

/**
 * Знак сравнения как -1/0/+1.
 *
 * `Math.sign` не годится: он отдаёт `-0` на нуле, и `expect(-0).toBe(0)`
 * краснеет на `Object.is` — тест падал бы там, где всё сошлось.
 */
function sign(value: number): number {
  if (value < 0) return -1
  if (value > 0) return +1
  return 0
}

/** Тождество значений в том объёме, в котором их порождает здешний генератор. */
function alike(a: unknown, b: unknown): boolean {
  if (a instanceof Uint8Array || b instanceof Uint8Array) {
    if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) return false
    return hex(a) === hex(b)
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, i) => alike(item, b[i]))
  }
  return Object.is(a, b) || a === b
}

/** Байты локального id из ссылки: пустая ссылка — это шесть нулей в юните. */
function idBytes(link: Link): Uint8Array {
  if (link.bin.length === 0) return new Uint8Array(6)
  return link.bin.slice(16, 22)
}

/** Байты лорда из ссылки: пустая — восемь нулей. */
function peerBytes(link: Link): Uint8Array {
  if (link.bin.length === 0) return new Uint8Array(8)
  return link.bin.slice(0, 8)
}

// ── Генераторы ───────────────────────────────────────────────────────────────

const bytesOf = (size: number): fc.Arbitrary<Uint8Array> => fc.uint8Array({ minLength: size, maxLength: size })

/** Лорд: хотя бы один ненулевой байт — нулевого автора фабрика не принимает. */
const peerArb: fc.Arbitrary<Uint8Array> = bytesOf(8).map((bin) => {
  if (bin.some((byte) => byte !== 0)) return bin
  const fixed = bin.slice()
  fixed[7] = 1
  return fixed
})

/** Локальный id: нули встречаются штатно — это корень ленда и начало списка. */
const idArb: fc.Arbitrary<Uint8Array> = fc.oneof(
  { weight: 1, arbitrary: fc.constant(new Uint8Array(6)) },
  { weight: 4, arbitrary: bytesOf(6) },
)

interface Stamp {
  readonly peer: Uint8Array
  readonly time: number
  readonly tick: number
}

const stampArb: fc.Arbitrary<Stamp> = fc.record({
  peer: peerArb,
  time: fc.integer({ min: 0, max: 0xffffffff }),
  tick: fc.integer({ min: 0, max: 0xffff }),
})

const tagArb: fc.Arbitrary<SandTag> = fc.constantFrom<SandTag>('term', 'solo', 'vals', 'keys')

/**
 * Значения по обе стороны от inline-потолка: короткие ложатся внутрь юнита,
 * длинные уходят в `ball`. Обе ветки нужны в одном генераторе, иначе половина
 * раскладки санда не проверяется.
 */
const valueArb: fc.Arbitrary<Vary> = fc.oneof(
  fc.constant(null),
  fc.boolean(),
  fc.integer({ min: -100_000, max: 100_000 }),
  fc.double({ noDefaultInfinity: true, noNaN: true }),
  fc.string({ maxLength: 90 }),
  fc.uint8Array({ maxLength: 90 }),
  fc.array(fc.integer({ min: -1000, max: 1000 }), { maxLength: 12 }),
)

interface SandRecipe {
  readonly kind: 'sand'
  readonly stamp: Stamp
  readonly self: Uint8Array
  readonly head: Uint8Array
  readonly lead: Uint8Array
  readonly tag: SandTag
  readonly value: Vary
  readonly shot: Uint8Array
}

interface GiftRecipe {
  readonly kind: 'gift'
  readonly stamp: Stamp
  readonly mate: Uint8Array
  readonly tier: number
  readonly rate: number
  readonly code: Uint8Array | null
}

interface SealRecipe {
  readonly kind: 'seal'
  readonly stamp: Stamp
  readonly hashes: Uint8Array[]
  readonly sign: Uint8Array
  readonly wide: boolean
}

interface PassRecipe {
  readonly kind: 'pass'
  readonly stamp: Stamp
  readonly algo: PassAlgo
  readonly key: Uint8Array
}

type Recipe = SandRecipe | GiftRecipe | SealRecipe | PassRecipe

const sandArb: fc.Arbitrary<SandRecipe> = fc.record({
  kind: fc.constant('sand' as const),
  stamp: stampArb,
  self: idArb,
  head: idArb,
  lead: idArb,
  tag: tagArb,
  value: valueArb,
  shot: bytesOf(12),
})

const giftArb: fc.Arbitrary<GiftRecipe> = fc.record({
  kind: fc.constant('gift' as const),
  stamp: stampArb,
  // Нулевой `mate` — штатное «всем», его надо порождать.
  mate: fc.oneof({ weight: 1, arbitrary: fc.constant(new Uint8Array(8)) }, { weight: 3, arbitrary: bytesOf(8) }),
  tier: fc.integer({ min: 0, max: 15 }),
  rate: fc.integer({ min: 0, max: 15 }),
  code: fc.oneof({ weight: 1, arbitrary: fc.constant(null) }, { weight: 3, arbitrary: bytesOf(16) }),
})

const sealArb: fc.Arbitrary<SealRecipe> = fc.record({
  kind: fc.constant('seal' as const),
  stamp: stampArb,
  hashes: fc.array(bytesOf(12), { maxLength: 15 }),
  sign: bytesOf(64),
  wide: fc.boolean(),
})

const passArb: fc.Arbitrary<PassRecipe> = fc
  .record({
    kind: fc.constant('pass' as const),
    stamp: stampArb,
    algo: fc.constantFrom<PassAlgo>('ed25519', 'p256'),
    key: bytesOf(65),
  })
  .map((recipe) => ({ ...recipe, key: recipe.key.slice(0, recipe.algo === 'ed25519' ? 32 : 65) }))

const recipeArb: fc.Arbitrary<Recipe> = fc.oneof<Array<fc.Arbitrary<Recipe>>>(sandArb, giftArb, sealArb, passArb)

/** Собирает юнит боевой фабрикой. Ссылки строятся здесь, а не в генераторе. */
function build(recipe: Recipe): AnyUnit {
  const stamp = { peer: Link.peer(recipe.stamp.peer), time: recipe.stamp.time, tick: recipe.stamp.tick }

  if (recipe.kind === 'sand') {
    const links = {
      self: Link.pawn(Link.hole, recipe.self),
      head: Link.pawn(Link.hole, recipe.head),
      lead: Link.pawn(Link.hole, recipe.lead),
    }
    const payload = varyEncode(recipe.value)
    // Ветка выбирается длиной закодированного значения — ровно так, как это
    // делает `SandUnit.makeAuto`, только без асинхронного хэша.
    if (payload.length <= 62) return SandUnit.make({ ...stamp, ...links, tag: recipe.tag, value: recipe.value })
    return SandUnit.makeBig({ ...stamp, ...links, tag: recipe.tag, size: payload.length, shot: recipe.shot })
  }

  if (recipe.kind === 'gift') {
    const fields = {
      ...stamp,
      mate: Link.peer(recipe.mate),
      tier: recipe.tier,
      rate: recipe.rate,
    }
    return recipe.code === null ? GiftUnit.make(fields) : GiftUnit.make({ ...fields, code: recipe.code })
  }

  if (recipe.kind === 'seal') {
    return SealUnit.make({ ...stamp, hashes: recipe.hashes, sign: recipe.sign, wide: recipe.wide })
  }

  return PassUnit.make({ ...stamp, algo: recipe.algo, key: recipe.key })
}

// ── 1. Поля: боевая сборка против независимого чтения ────────────────────────

describe('независимое чтение юнита', () => {
  it(`поля совпадают на ${RUNS} собранных юнитах`, { timeout: 600_000 }, () => {
    fc.assert(
      fc.property(recipeArb, (recipe) => {
        const unit = build(recipe)
        const ref = readUnit(unit.bin)

        // Общая часть — одна на все виды.
        expect(ref.kind).toBe(unit.kind())
        expect(ref.length).toBe(unit.bin.length)
        expect(ref.length).toBe(unitLength(unit.bin))
        expect(ref.time).toBe(recipe.stamp.time)
        expect(ref.tick).toBe(recipe.stamp.tick)
        expect(hex(ref.peer)).toBe(hex(recipe.stamp.peer))
        // И то же самое глазами боевых аксессоров: расхождение здесь означало бы,
        // что офсет в коде разошёлся с офсетом в таблице.
        expect(ref.time).toBe(unit.time())
        expect(ref.tick).toBe(unit.tick())
        expect(hex(ref.peer)).toBe(hex(peerBytes(unit.peer())))

        if (recipe.kind === 'sand') {
          if (ref.kind !== 'sand' || !(unit instanceof SandUnit)) throw new Error('вид разошёлся')
          expect(hex(ref.self)).toBe(hex(recipe.self))
          expect(hex(ref.head)).toBe(hex(recipe.head))
          expect(hex(ref.lead)).toBe(hex(recipe.lead))
          expect(hex(ref.self)).toBe(hex(idBytes(unit.self())))
          expect(hex(ref.head)).toBe(hex(idBytes(unit.head())))
          expect(hex(ref.lead)).toBe(hex(idBytes(unit.lead())))
          expect(ref.tag).toBe(recipe.tag)
          expect(ref.tag).toBe(unit.tag())
          expect(ref.big).toBe(unit.big())
          expect(ref.size).toBe(unit.size())

          const payload = varyEncode(recipe.value)
          expect(ref.size).toBe(payload.length)

          if (ref.big) {
            expect(hex(ref.shot as Uint8Array)).toBe(hex(recipe.shot))
            expect(hex(ref.shot as Uint8Array)).toBe(hex(unit.shot()))
            expect(ref.payload).toBe(null)
          }
          else {
            expect(hex(ref.payload as Uint8Array)).toBe(hex(payload))
            expect(hex(ref.payload as Uint8Array)).toBe(hex(unit.bytes()))
            // Значение разбирает независимый декодер `vary`, а не боевой.
            expect(alike(ref.value, recipe.value)).toBe(true)
            expect(alike(ref.value, unit.value())).toBe(true)
            expect(unit.dead()).toBe(recipe.value === null)
          }
        }

        if (recipe.kind === 'gift') {
          if (ref.kind !== 'gift' || !(unit instanceof GiftUnit)) throw new Error('вид разошёлся')
          expect(hex(ref.mate)).toBe(hex(recipe.mate))
          expect(hex(ref.mate)).toBe(hex(peerBytes(unit.mate())))
          expect(ref.tier).toBe(recipe.tier)
          expect(ref.rate).toBe(recipe.rate)
          expect(ref.rank).toBe(unit.rank())
          expect(hex(ref.code)).toBe(hex(recipe.code ?? new Uint8Array(16)))
          expect(hex(ref.code)).toBe(hex(unit.code()))
          expect(ref.coded).toBe(unit.coded())
        }

        if (recipe.kind === 'seal') {
          if (ref.kind !== 'seal' || !(unit instanceof SealUnit)) throw new Error('вид разошёлся')
          expect(ref.count).toBe(recipe.hashes.length)
          expect(ref.count).toBe(unit.count())
          expect(ref.wide).toBe(recipe.wide)
          expect(ref.wide).toBe(unit.wide())
          expect(ref.hashes.map(hex)).toEqual(recipe.hashes.map(hex))
          expect(ref.hashes.map(hex)).toEqual(unit.hashes().map(hex))
          expect(hex(ref.sign)).toBe(hex(recipe.sign))
          expect(hex(ref.sign)).toBe(hex(unit.sign()))
        }

        if (recipe.kind === 'pass') {
          if (ref.kind !== 'pass' || !(unit instanceof PassUnit)) throw new Error('вид разошёлся')
          expect(ref.algo).toBe(recipe.algo)
          expect(ref.algo).toBe(unit.algo())
          expect(hex(ref.key)).toBe(hex(recipe.key))
          expect(hex(ref.key)).toBe(hex(unit.key()))
        }
      }),
      { numRuns: RUNS },
    )
  })

  it('прибор читает и то, что вернул диспетчер, и то, что вернула фабрика', () => {
    fc.assert(
      fc.property(recipeArb, (recipe) => {
        const unit = build(recipe)
        // `parseUnit` не копирует байты, поэтому прибор обязан прочитать ровно
        // тот же результат, что и с исходного буфера.
        const parsed = parseUnit(unit.bin)
        expect(refHex(parsed.bin)).toBe(refHex(unit.bin))
        expect(readUnit(parsed.bin)).toEqual(readUnit(unit.bin))
      }),
      { numRuns: 2_000 },
    )
  })

  it('обрезанные байты прибор отвергает, а не дочитывает', () => {
    fc.assert(
      fc.property(recipeArb, (recipe) => {
        const bin = build(recipe).bin
        expect(() => readUnit(bin.subarray(0, bin.length - 1))).toThrow(UnitMismatch)
        const longer = new Uint8Array(bin.length + 8)
        longer.set(bin)
        expect(() => readUnit(longer)).toThrow(UnitMismatch)
      }),
      { numRuns: 2_000 },
    )
  })
})

// ── 2. Порядок: независимый оракул и обещанный §2 memcmp ─────────────────────

/**
 * Пары с частыми ничьями: арбитраж по `peer` и `tick` включается только при
 * совпадении времени, и на равномерно случайных метках эти ветки не проверяются
 * почти никогда.
 */
const peerPool: Uint8Array[] = [
  new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1]),
  new Uint8Array([0, 0, 0, 0, 0, 0, 0, 2]),
  new Uint8Array([0, 0, 0, 0, 0, 0, 1, 0]),
  new Uint8Array([0xf4, 1, 2, 3, 4, 5, 6, 7]),
  new Uint8Array([0xf8, 1, 2, 3, 4, 5, 6, 7]),
  new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
]

const tightStamp: fc.Arbitrary<Stamp> = fc.record({
  peer: fc.constantFrom(...peerPool),
  time: fc.integer({ min: 0, max: 3 }),
  tick: fc.integer({ min: 0, max: 3 }),
})

/** Санд с одинаковым значением: в сравнении участвует только метка. */
function stamped(stamp: Stamp): SandUnit {
  return SandUnit.make({
    peer: Link.peer(stamp.peer),
    time: stamp.time,
    tick: stamp.tick,
    self: Link.pawn(Link.hole, new Uint8Array([1, 2, 3, 4, 5, 6])),
    head: Link.hole,
    lead: Link.hole,
    value: null,
  })
}

describe('порядок сверяется независимым оракулом', () => {
  it(`Unit.compare совпадает с оракулом по полям на ${RUNS} парах`, { timeout: 600_000 }, () => {
    fc.assert(
      fc.property(tightStamp, tightStamp, (left, right) => {
        const a = stamped(left)
        const b = stamped(right)
        // Оракул считает порядок из ПОЛЕЙ, вынутых прибором: он не знает ни
        // офсетов, ни того, что поля лежат рядом.
        expect(sign(Unit.compare(a, b))).toBe(sign(refCompare(readUnit(a.bin), readUnit(b.bin))))
      }),
      { numRuns: RUNS },
    )
  })

  it('порядок строгий и антисимметричный', () => {
    fc.assert(
      fc.property(tightStamp, tightStamp, (left, right) => {
        const a = stamped(left)
        const b = stamped(right)
        expect(sign(Unit.compare(a, b)) + sign(Unit.compare(b, a))).toBe(0)
      }),
      { numRuns: 5_000 },
    )
  })

  /**
   * НАХОДКА УРОВНЯ СПЕЦИФИКАЦИИ. §2 обещает: «поля лежат в этом порядке и в
   * big-endian, поэтому сравнение сводится к `memcmp` 14 байт без разбора
   * структуры». Прибор реализует обещание буквально — и оно не выполняется.
   *
   * Тест зелёный не потому, что обещание верно, а потому, что расхождение
   * измерено и закреплено: если кто-то заменит `Unit.compare` на memcmp,
   * покраснеет весь раздел выше, а этот перестанет находить контрпримеры.
   */
  it(`memcmp 14 байт расходится с LWW — на ${RUNS} парах доля расхождений считается`, { timeout: 600_000 }, () => {
    let seen = 0
    let apart = 0

    fc.assert(
      fc.property(tightStamp, tightStamp, (left, right) => {
        const a = stamped(left)
        const b = stamped(right)
        seen += 1
        if (sign(Unit.compare(a, b)) !== sign(memcmpCompare(a.bin, b.bin))) apart += 1
      }),
      { numRuns: RUNS },
    )

    // Обещание §2 требует нуля. Меряем и печатаем — число идёт в отчёт.
    expect(seen).toBe(RUNS)
    expect(apart).toBeGreaterThan(0)
    console.log(`  §2 memcmp: расходится на ${apart} парах из ${seen} (${((apart / seen) * 100).toFixed(1)} %)`)
  })

  describe('минимальные контрпримеры к обещанию §2', () => {
    const peer1 = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1])
    const peer2 = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 2])

    it('1. time: memcmp даёт возрастание, LWW требует убывания', () => {
      const a = stamped({ peer: peer1, time: 1, tick: 0 })
      const b = stamped({ peer: peer1, time: 2, tick: 0 })
      expect(sign(Unit.compare(a, b))).toBe(+1)
      expect(sign(memcmpCompare(a.bin, b.bin))).toBe(-1)
    })

    it('2. приоритет: tick лежит раньше peer, а решать обязан peer', () => {
      const a = stamped({ peer: peer1, time: 7, tick: 1 })
      const b = stamped({ peer: peer2, time: 7, tick: 0 })
      // LWW: время равно → решает peer, а peer1 < peer2.
      expect(sign(Unit.compare(a, b))).toBe(-1)
      // memcmp: до peer дело не доходит, tick(6..8) различается раньше.
      expect(sign(memcmpCompare(a.bin, b.bin))).toBe(+1)
    })

    it('3. tick: memcmp даёт возрастание, LWW требует убывания', () => {
      const a = stamped({ peer: peer1, time: 7, tick: 1 })
      const b = stamped({ peer: peer1, time: 7, tick: 2 })
      expect(sign(Unit.compare(a, b))).toBe(+1)
      expect(sign(memcmpCompare(a.bin, b.bin))).toBe(-1)
    })

    it('и «memcmp наоборот» тоже не спасает: направления смешаны', () => {
      // Разворот знака чинит пункты 1 и 3, но ломает единственный, который
      // memcmp угадывал, — арбитраж по peer.
      const a = stamped({ peer: peer1, time: 7, tick: 0 })
      const b = stamped({ peer: peer2, time: 7, tick: 0 })
      expect(sign(Unit.compare(a, b))).toBe(-1)
      expect(sign(-memcmpCompare(a.bin, b.bin))).toBe(+1)
    })
  })
})

// ── 3. Порядок против слоя ленда ─────────────────────────────────────────────

/** Тот же логический юнит в виде обычного объекта, каким его знает `src/land`. */
function asSand(ref: RefUnit, peerText: string): Sand {
  const sand = ref as RefSand
  return {
    self: refHex(sand.self),
    head: refHex(sand.head),
    lead: refHex(sand.lead),
    peer: peerText,
    time: ref.time,
    tick: ref.tick,
    value: null,
  }
}

describe('порядок бинарного юнита против src/land/lww.ts', () => {
  it(`совпадает на ${RUNS} парах, когда peer представлен hex'ом`, { timeout: 600_000 }, () => {
    fc.assert(
      fc.property(tightStamp, tightStamp, (left, right) => {
        const a = stamped(left)
        const b = stamped(right)
        // hex биективен и сохраняет порядок байт: строки одной длины
        // сравниваются посимвольно, а '0'…'9' < 'a'…'f'.
        const sa = asSand(readUnit(a.bin), refHex(left.peer))
        const sb = asSand(readUnit(b.bin), refHex(right.peer))
        expect(sign(Unit.compare(a, b))).toBe(sign(lwwCompare(sa, sb)))
      }),
      { numRuns: RUNS },
    )
  })

  /**
   * НАХОДКА. Слой ленда сравнивает `peer` как строку. Если при переезде строкой
   * станет `Link.str` (base64url), исход конкурентных правок поменяется:
   * base64url НЕ сохраняет порядок байт. Цифры занимают коды 52…61, а '-' и '_'
   * — 62 и 63, но в ASCII '-' (45) меньше любой цифры (48…57).
   */
  it('с peer в виде base64url порядок РАСХОДИТСЯ — контрпример', () => {
    const low = new Uint8Array([0xf4, 1, 2, 3, 4, 5, 6, 7])
    const high = new Uint8Array([0xf8, 1, 2, 3, 4, 5, 6, 7])

    const a = stamped({ peer: low, time: 7, tick: 0 })
    const b = stamped({ peer: high, time: 7, tick: 0 })

    // 0xf4 >> 2 = 61 → '9'; 0xf8 >> 2 = 62 → '-'.
    const textLow = Link.peer(low).str
    const textHigh = Link.peer(high).str
    expect(textLow.startsWith('9')).toBe(true)
    expect(textHigh.startsWith('-')).toBe(true)

    // По байтам: 0xf4 < 0xf8, значит `a` побеждает арбитраж.
    expect(sign(Unit.compare(a, b))).toBe(-1)
    // По тексту: '9…' > '-…', значит побеждает `b`. Тот же логический ввод,
    // противоположный исход — и это разные конвергентные состояния сети.
    expect(sign(lwwCompare(asSand(readUnit(a.bin), textLow), asSand(readUnit(b.bin), textHigh)))).toBe(+1)
  })

  it('а hex того же контрпримера порядок сохраняет', () => {
    const low = new Uint8Array([0xf4, 1, 2, 3, 4, 5, 6, 7])
    const high = new Uint8Array([0xf8, 1, 2, 3, 4, 5, 6, 7])
    const a = stamped({ peer: low, time: 7, tick: 0 })
    const b = stamped({ peer: high, time: 7, tick: 0 })
    expect(sign(lwwCompare(asSand(readUnit(a.bin), refHex(low)), asSand(readUnit(b.bin), refHex(high))))).toBe(-1)
  })
})

// ── 4. Golden-векторы через независимое чтение ───────────────────────────────

interface GoldenVector {
  note: string
  kind: string
  hex: string
  path: string
  fields: Record<string, unknown>
}

interface Golden {
  note: string
  layout: Record<string, Record<string, unknown>>
  vectors: GoldenVector[]
}

const golden = JSON.parse(
  readFileSync(new URL('./fixtures/unit.golden.json', import.meta.url), 'utf8'),
) as Golden

describe('golden-векторы через независимое чтение', () => {
  it('фикстура объявляет ту же раскладку, что прочитал прибор', () => {
    // Раскладка в фикстуре — третья запись тех же чисел. Если она разъедется с
    // таблицей §2, вектора ниже перестанут разбираться прибором.
    expect(golden.layout.common).toEqual({ kind: 0, meta: 1, time: 2, tick: 6, peer: 8, body: 16 })
    expect(golden.layout.sand).toEqual({ self: 16, head: 22, lead: 28, size: 34, shot: 36, payload: 48 })
  })

  for (const vector of golden.vectors) {
    it(`${vector.kind}: ${vector.note.slice(0, 60)}`, () => {
      const bin = unhex(vector.hex)
      const ref = readUnit(bin)
      const fields = vector.fields

      expect(ref.kind).toBe(vector.kind)
      expect(ref.length).toBe(bin.length)
      expect(ref.time).toBe(fields.time)
      expect(ref.tick).toBe(fields.tick)
      expect(refHex(ref.peer)).toBe(fields.peer)

      if (ref.kind === 'sand') {
        expect(refHex(ref.self)).toBe(fields.self)
        expect(refHex(ref.head)).toBe(fields.head)
        expect(refHex(ref.lead)).toBe(fields.lead)
        expect(ref.tag).toBe(fields.tag)
        expect(ref.big).toBe(fields.big)
        expect(ref.size).toBe(fields.size)
        if (ref.big) expect(refHex(ref.shot as Uint8Array)).toBe(fields.shot)
        else expect(alike(ref.value, fields.value)).toBe(true)
      }
      if (ref.kind === 'gift') {
        expect(refHex(ref.mate)).toBe(fields.mate)
        expect(ref.tier).toBe(fields.tier)
        expect(ref.rate).toBe(fields.rate)
        expect(refHex(ref.code)).toBe(fields.code)
        expect(ref.coded).toBe(fields.coded)
      }
      if (ref.kind === 'seal') {
        expect(ref.count).toBe(fields.count)
        expect(ref.wide).toBe(fields.wide)
        expect(ref.hashes.map(refHex)).toEqual(fields.hashes)
        expect(refHex(ref.sign)).toBe(fields.sign)
      }
      if (ref.kind === 'pass') {
        expect(ref.algo).toBe(fields.algo)
        expect(refHex(ref.key)).toBe(fields.key)
      }

      // И боевой разбор на тех же байтах обязан дать тот же путь хранилища.
      expect(parseUnit(bin).path()).toBe(vector.path)
    })
  }
})

// ── 5. Чувствительность сверки и каноничность байт ───────────────────────────
//
// Тест, который не умеет краснеть, ничего не проверяет. Пункт 5 задания требовал
// внести правку в `unit.ts` и убедиться, что сверка её ловит; правка откачена
// (см. отчёт), а здесь остаются рукотворные байты — то, что сломанный кодек и
// написал бы, и то, что прибор обязан отвергнуть.

/** Эталонный inline-санд, собранный фабрикой: основа для порчи байт. */
function sample(): Uint8Array {
  return SandUnit.make({
    peer: Link.peer(new Uint8Array([0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7])),
    time: 1,
    tick: 2,
    self: Link.pawn(Link.hole, new Uint8Array([1, 2, 3, 4, 5, 6])),
    head: Link.hole,
    lead: Link.hole,
    value: 'hi',
  }).bin.slice()
}

describe('прибор отвергает то, чего фабрика никогда не напишет', () => {
  it('чужой байт вида', () => {
    const bin = sample()
    bin[0] = 9
    expect(() => readUnit(bin)).toThrow(UnitMismatch)
  })

  it('длина не по раскладке', () => {
    const bin = sample()
    expect(() => readUnit(bin.subarray(0, bin.length - 8))).toThrow(UnitMismatch)
  })

  it('выносное значение, объявленное короче inline-потолка', () => {
    const bin = sample()
    bin[1] = 0x3f // inlineSize = 63 — маркер выносного
    const big = new Uint8Array(48)
    big.set(bin.subarray(0, 34))
    big[34] = 0
    big[35] = 10 // sizeBig = 10, а это влезло бы внутрь юнита
    expect(() => readUnit(big)).toThrow(UnitMismatch)
  })

  it('неизвестный алгоритм паспорта', () => {
    const bin = PassUnit.make({
      peer: Link.peer(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])),
      time: 1,
      tick: 0,
      algo: 'ed25519',
      key: new Uint8Array(32).fill(0xc0),
    }).bin.slice()
    bin[1] = 7
    expect(() => readUnit(bin)).toThrow(UnitMismatch)
  })
})

/**
 * НАХОДКА. Байты, не занятые ни одним полем, боевой `parseUnit` не проверяет: у
 * одного логического юнита получается семейство байтовых представлений. Формат
 * адресуется хэшем от точных байт (`Seal`, дедупликация хранилища), поэтому
 * прибор такие байты отвергает — а боевой разбор принимает и читает те же поля.
 */
describe('НАХОДКА: боевой разбор принимает неканоничные байты', () => {
  const cases: Array<[string, () => Uint8Array]> = [
    ['inline-санд: мусор в неиспользуемых sizeBig/shot (14 байт, 34…48)', () => {
      const bin = sample()
      bin[34] = 0xff
      bin[40] = 0x01
      return bin
    }],
    ['inline-санд: мусор в хвосте выравнивания', () => {
      const bin = sample()
      bin[bin.length - 1] = 0xff
      return bin
    }],
    ['gift: байт meta не задействован ни одним полем', () => {
      const bin = GiftUnit.make({
        peer: Link.peer(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])),
        time: 1,
        tick: 0,
        mate: Link.hole,
        tier: 3,
        rate: 8,
      }).bin.slice()
      bin[1] = 0xff
      return bin
    }],
    ['gift: дыра выравнивания между rank и code', () => {
      const bin = GiftUnit.make({
        peer: Link.peer(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])),
        time: 1,
        tick: 0,
        mate: Link.hole,
        tier: 3,
        rate: 8,
      }).bin.slice()
      bin[25] = 0xff
      return bin
    }],
    ['seal: биты 4…6 meta не заняты ни count, ни wide', () => {
      const bin = SealUnit.make({
        peer: Link.peer(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])),
        time: 1,
        tick: 0,
        hashes: [new Uint8Array(12).fill(7)],
        sign: new Uint8Array(64).fill(5),
      }).bin.slice()
      bin[1] = bin[1]! | 0b0001_0000
      return bin
    }],
  ]

  for (const [name, make] of cases) {
    it(name, () => {
      const bin = make()
      // Прибор: это не тот юнит, который писала фабрика.
      expect(() => readUnit(bin)).toThrow(UnitMismatch)
      // Боевой разбор: принимает молча.
      const unit = parseUnit(bin)
      expect(unit.bin.length).toBe(bin.length)
      // И читает ровно те же поля — то есть это второе представление ОДНОГО
      // логического юнита. Хэш у него другой: `Unit.hash()` считается по буферу.
      expect(unit.time()).toBe(1)
    })
  }

  /**
   * НАХОДКА. `inlineSize == 0` — санд, у которого значения нет вовсе. Фабрика
   * такого не пишет (`varyEncode` короче байта не бывает), но `parseUnit` его
   * принимает: длина 48 Б сходится с раскладкой. Отказ приходит позже и от
   * ЧУЖОГО слоя — `VaryError` из кодека значений, а не `UnitError` с ворот.
   */
  it('санд с нулевой нагрузкой проходит ворота, а падает потом и в кодеке vary', () => {
    const bin = sample()
    bin[1] = 0
    const short = bin.slice(0, 48)

    expect(() => readUnit(short)).toThrow(UnitMismatch)

    const unit = parseUnit(short) as SandUnit
    expect(unit.size()).toBe(0)
    expect(unit.big()).toBe(false)
    expect(unit.dead()).toBe(false)
    expect(unit.bytes().length).toBe(0)
    // Ворота промолчали — жалуется кодек значений, и уже не UnitError.
    expect(() => unit.value()).toThrow(/нужно ещё 1 Б/)
  })

  it('одно значение, два представления, два разных хэша', async () => {
    const clean = sample()
    const dirty = clean.slice()
    dirty[34] = 0xff

    const a = parseUnit(clean)
    const b = parseUnit(dirty)

    // Логически это один и тот же юнит: путь, метка и значение совпадают.
    expect(b.path()).toBe(a.path())
    expect(b.time()).toBe(a.time())
    expect((b as SandUnit).value()).toBe((a as SandUnit).value())
    // А идентификатор содержимого — разный.
    expect(refHex(await b.hash())).not.toBe(refHex(await a.hash()))
  })
})
