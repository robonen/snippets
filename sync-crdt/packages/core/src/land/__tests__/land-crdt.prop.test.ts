import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { writeU16, writeU32 } from '../../binary/bytes'
import { Link } from '../../binary/link'
import { type AnyUnit, SAND_AT, SandUnit, UNIT_AT } from '../../binary/unit'
import { type Vary, varyEncode } from '../../binary/vary'
import { fixedClock } from '../clock'
import { Land } from '../land'
import { packEncode, packPart } from '../../binary/pack'
import { orderNaive, resolveNaive } from '../order-naive'
import { ROOT as ROOT_STR, type Sand } from '../sand'
import { ROOT, id48, type LocalId, putId48 } from '../view'

// ─── Стенд: юнит собирается БАЙТАМИ, минуя `Land.write` ──────────────────────
//
// Иначе пир, время и `self` определяет сам проверяемый код, и целые классы
// входов (пиры со старшим битом, конкуренты в одну секунду от произвольных
// пиров, повторная доставка) до ленда просто не доходят.

interface Fields {
  readonly peer: Uint8Array
  readonly time: number
  readonly tick: number
  readonly self: number
  readonly head: number
  readonly lead: number
  readonly value: Vary
}

function sandOf(f: Fields): SandUnit {
  const payload = varyEncode(f.value)
  const bin = new Uint8Array(SandUnit.lengthOf(payload.length))
  bin[UNIT_AT.kind] = 1
  bin[UNIT_AT.meta] = payload.length
  writeU32(bin, UNIT_AT.time, f.time)
  writeU16(bin, UNIT_AT.tick, f.tick)
  bin.set(f.peer, UNIT_AT.peer)
  putId48(bin, SAND_AT.self, f.self)
  putId48(bin, SAND_AT.head, f.head)
  putId48(bin, SAND_AT.lead, f.lead)
  bin.set(payload, SAND_AT.payload)
  return SandUnit.wrap(bin)
}

function peerBytes(...head: readonly number[]): Uint8Array {
  const bin = new Uint8Array(8)
  bin.set(head, 0)
  return bin
}

function hexOf(bin: Uint8Array, at: number, size: number): string {
  let out = ''
  for (let i = at; i < at + size; i++) out += (bin[i] as number).toString(16).padStart(2, '0')
  return out
}

function idText(id: number): string {
  return id === 0 ? ROOT_STR : `n${id.toString(36)}`
}

function toSands(units: readonly AnyUnit[]): Sand[] {
  const out: Sand[] = []
  for (const unit of units) {
    const bin = unit.bin
    out.push({
      self: idText(id48(bin, SAND_AT.self)),
      head: idText(id48(bin, SAND_AT.head)),
      lead: idText(id48(bin, SAND_AT.lead)),
      peer: hexOf(bin, UNIT_AT.peer, 8),
      time: ((bin[UNIT_AT.time] as number) << 24 >>> 0) + 0, // не используется, перезапишем ниже
      tick: 0,
      value: (unit as SandUnit).value(),
    })
  }
  // время/тик читаем теми же примитивами, что и код
  return out.map((sand, i) => {
    const bin = (units[i] as AnyUnit).bin
    return {
      ...sand,
      time: (bin[UNIT_AT.time] as number) * 0x100_0000
        + (bin[UNIT_AT.time + 1] as number) * 0x1_0000
        + (bin[UNIT_AT.time + 2] as number) * 0x100
        + (bin[UNIT_AT.time + 3] as number),
      tick: (bin[UNIT_AT.tick] as number) * 0x100 + (bin[UNIT_AT.tick + 1] as number),
    }
  })
}

const CLOCK = () => fixedClock(1000)
const OBSERVER = peerBytes(0x01)

function freshLand(): Land {
  return new Land(Link.peer(OBSERVER), CLOCK())
}

function valuesOf(land: Land): unknown[] {
  return land.order(ROOT).map(view => view.value)
}

function selvesOf(land: Land): number[] {
  return land.order(ROOT).map(view => id48(view.bin, view.at + SAND_AT.self))
}

// ─── 1. Арбитраж по БАЙТАМ пира (ADR-015) ────────────────────────────────────

describe('арбитраж LWW идёт по байтам пира', () => {
  const pairs: readonly (readonly [string, Uint8Array, Uint8Array])[] = [
    // base64url: "9…" против "-…" — текстовый порядок обратен байтовому
    ['0xf4 против 0xf8', peerBytes(0xf4), peerBytes(0xf8)],
    // знаковое сравнение u32 перевернуло бы этот
    ['0x7f против 0x80', peerBytes(0x7f), peerBytes(0x80)],
    // различие только в младшем слове, тоже со сменой знака
    ['low 0x7fffffff против 0x80000000', peerBytes(0, 0, 0, 0, 0x7f, 0xff, 0xff, 0xff), peerBytes(0, 0, 0, 0, 0x80, 0, 0, 0)],
    ['0x00 против 0xff', peerBytes(0x00, 0x01), peerBytes(0xff)],
  ]

  for (const [name, low, high] of pairs) {
    test(`${name}: побеждает меньший по байтам, независимо от порядка приёма`, () => {
      const base = { time: 1000, tick: 0, self: 0x10, head: 0, lead: 0 }
      const a = sandOf({ ...base, peer: low, value: 'low' })
      const b = sandOf({ ...base, peer: high, value: 'high' })

      const first = freshLand()
      first.apply([a, b])
      const second = freshLand()
      second.apply([b, a])

      expect(valuesOf(first)).toEqual(['low'])
      expect(valuesOf(second)).toEqual(['low'])
    })
  }

  test('порядок сиблингов при равном времени — по байтам пира', () => {
    // Два конкурента за одну позицию (lead = ROOT) от разных пиров.
    const a = sandOf({ peer: peerBytes(0xf8), time: 1000, tick: 0, self: 0x11, head: 0, lead: 0, value: 'f8' })
    const b = sandOf({ peer: peerBytes(0xf4), time: 1000, tick: 0, self: 0x12, head: 0, lead: 0, value: 'f4' })

    const land = freshLand()
    land.apply([a, b])
    // Меньший по байтам пир «свежее» → идёт первым.
    expect(valuesOf(land)).toEqual(['f4', 'f8'])
  })
})

// ─── 2. Генератор корпуса юнитов ─────────────────────────────────────────────

/**
 * Пиры со старшими байтами вокруг всех опасных границ: 0x00/0x7f/0x80/0xf4/0xf8/0xff.
 * Именно они и не встречаются в существующей сверке, где пиры — 0x10…0x13.
 */
const PEERS: readonly Uint8Array[] = [
  peerBytes(0x00, 0x01),
  peerBytes(0x7f),
  peerBytes(0x80),
  peerBytes(0xf4),
  peerBytes(0xf8),
  peerBytes(0xff),
]

interface UnitSpec {
  readonly peer: number
  readonly time: number
  readonly tick: number
  readonly self: number
  readonly head: number
  readonly lead: number
  readonly value: number | null
}

/**
 * Юниты рождаются напрямую, без реплики: цель — не правдоподобная история, а
 * покрытие графа `lead` вместе с кольцами, сиротами и конкурентами в секунду.
 */
const specArb: fc.Arbitrary<UnitSpec> = fc.record({
  peer: fc.nat(PEERS.length - 1),
  time: fc.integer({ min: 1000, max: 1002 }),
  tick: fc.nat(2),
  self: fc.integer({ min: 1, max: 8 }),
  head: fc.constant(0),
  lead: fc.integer({ min: 0, max: 8 }),
  value: fc.oneof(fc.nat(99), fc.constant(null)),
})

/**
 * Метка `(peer, time, tick)` делается УНИКАЛЬНОЙ: `tick` раздаётся счётчиком на
 * пира. Это тот же инвариант, что держит `Stamp` у боевого ленда, и без него
 * сверка мерила бы не раскладку, а поведение двух реализаций на ничьей
 * компаратора — то есть на входе, которого спецификация не допускает.
 */
function unitsOf(specs: readonly UnitSpec[]): SandUnit[] {
  const ticks: number[] = PEERS.map(() => 0)
  return specs.map(spec => {
    const tick = (ticks[spec.peer] as number) + spec.tick
    ticks[spec.peer] = tick + 1
    return sandOf({
      peer: PEERS[spec.peer] as Uint8Array,
      time: spec.time,
      tick,
      self: spec.self,
      head: spec.head,
      lead: spec.lead,
      value: spec.value,
    })
  })
}

const corpusArb = fc.array(specArb, { minLength: 1, maxLength: 24 })

// ─── 3. Сходимость: любой порядок доставки даёт одно состояние ───────────────

describe('сходимость', () => {
  test('перестановка и разбиение доставки не меняют итог', () => {
    fc.assert(
      fc.property(corpusArb, fc.array(fc.nat(1000), { minLength: 1, maxLength: 32 }), (specs, keys) => {
        const units = unitsOf(specs)

        const straight = freshLand()
        straight.apply(units)
        const want = valuesOf(straight)
        const wantSelves = selvesOf(straight)

        // Перестановка + разбиение на произвольные пачки.
        const mixed = [...units]
        for (let i = mixed.length - 1; i > 0; i--) {
          const j = (keys[i % keys.length] as number) % (i + 1)
          const tmp = mixed[i] as SandUnit
          mixed[i] = mixed[j] as SandUnit
          mixed[j] = tmp
        }

        const other = freshLand()
        let at = 0
        let k = 0
        while (at < mixed.length) {
          const step = 1 + ((keys[k % keys.length] as number) % 4)
          other.apply(mixed.slice(at, at + step))
          at += step
          k += 1
        }

        expect(valuesOf(other)).toEqual(want)
        expect(selvesOf(other)).toEqual(wantSelves)
        expect(other.size()).toBe(straight.size())
        expect(other.count()).toBe(straight.count())
        return true
      }),
      { numRuns: 500 },
    )
  })
})

// ─── 4. Идемпотентность ──────────────────────────────────────────────────────

describe('идемпотентность', () => {
  test('повторная доставка ничего не берёт и ничего не меняет', () => {
    fc.assert(
      fc.property(corpusArb, specs => {
        const units = unitsOf(specs)
        const land = freshLand()
        land.apply(units)

        const before = valuesOf(land)
        const size = land.size()
        const count = land.count()

        expect(land.apply(units)).toBe(0)
        expect(land.apply(land.units())).toBe(0)

        expect(valuesOf(land)).toEqual(before)
        expect(land.size()).toBe(size)
        expect(land.count()).toBe(count)
        return true
      }),
      { numRuns: 400 },
    )
  })
})

// ─── 5. Достижимость: ни один живой по LWW узел не теряется ──────────────────

describe('достижимость', () => {
  test('каждый живой по LWW узел присутствует в order ровно один раз', () => {
    fc.assert(
      fc.property(corpusArb, specs => {
        const units = unitsOf(specs)
        const land = freshLand()
        land.apply(units)

        const alive = new Set<string>()
        for (const sand of resolveNaive(toSands(units), ROOT_STR).values()) {
          if (sand.value !== null) alive.add(sand.self)
        }

        const got = selvesOf(land).map(idText)
        expect(new Set(got).size).toBe(got.length)
        expect(new Set(got)).toEqual(alive)
        return true
      }),
      { numRuns: 400 },
    )
  })
})

// ─── 6. Сверка с наивным оракулом на опасных пирах ───────────────────────────

describe('сверка с orderNaive на пирах со старшим битом', () => {
  test('порядок и значения совпадают поэлементно', () => {
    fc.assert(
      fc.property(corpusArb, specs => {
        const units = unitsOf(specs)
        const land = freshLand()
        land.apply(units)

        const naive = orderNaive(toSands(units), ROOT_STR)

        expect(valuesOf(land)).toEqual(naive.map(sand => sand.value))
        expect(selvesOf(land).map(idText)).toEqual(naive.map(sand => sand.self))
        return true
      }),
      { numRuns: 500 },
    )
  })
})

// ─── 7. adopt эквивалентен apply ─────────────────────────────────────────────

describe('adopt и apply дают одно состояние', () => {
  test('пачка, принятая главой арены, читается так же, как скопированная', () => {
    fc.assert(
      fc.property(corpusArb, specs => {
        const units = unitsOf(specs)

        const byApply = freshLand()
        byApply.apply(units)

        const byAdopt = freshLand()
        byAdopt.adopt(packEncode([[Link.peer(peerBytes(0x22)), packPart({ units })]]))

        expect(valuesOf(byAdopt)).toEqual(valuesOf(byApply))
        expect(selvesOf(byAdopt)).toEqual(selvesOf(byApply))
        expect(byAdopt.size()).toBe(byApply.size())
        expect(byAdopt.count()).toBe(byApply.count())
        return true
      }),
      { numRuns: 300 },
    )
  })
})

// ─── 8. size() и count() ─────────────────────────────────────────────────────

describe('счётчики', () => {
  test('size — число слотов (head, peer, self), count — число живых узлов', () => {
    fc.assert(
      fc.property(corpusArb, specs => {
        const units = unitsOf(specs)
        const land = freshLand()
        land.apply(units)

        const slots = new Set<string>()
        for (const sand of toSands(units)) slots.add(`${sand.head}|${sand.peer}|${sand.self}`)
        expect(land.size()).toBe(slots.size)
        expect(land.units().length).toBe(slots.size)

        const alive = [...resolveNaive(toSands(units), ROOT_STR).values()].filter(s => s.value !== null)
        expect(land.count()).toBe(alive.length)
        return true
      }),
      { numRuns: 400 },
    )
  })
})

// ─── 9. То же самое, но с вложенными головами ────────────────────────────────
//
// Выше `head` всегда корень, и это оставляет непроверенным целый уровень: узел
// числится под головой своего ПОБЕДИТЕЛЯ, тогда как оракул сворачивает LWW
// внутри каждой головы отдельно.

const HEADS: readonly number[] = [0, 1, 2]

/**
 * `head` — ФУНКЦИЯ от `self`: узлы 1 и 2 лежат в корне и служат головами, узлы
 * 3…8 распределены между ними. Так и работает модель: `self` чеканится под свою
 * голову и в другую не переезжает. Вход, где один `self` встречается под двумя
 * головами, проверяется отдельно (см. «один self под двумя головами»).
 */
function headOf(self: number): number {
  if (self <= 2) return 0
  return 1 + (self % 2)
}

const nestedSpecArb: fc.Arbitrary<UnitSpec> = fc.record({
  peer: fc.nat(PEERS.length - 1),
  time: fc.integer({ min: 1000, max: 1002 }),
  tick: fc.nat(2),
  self: fc.integer({ min: 1, max: 8 }),
  head: fc.constant(0),
  lead: fc.integer({ min: 0, max: 8 }),
  value: fc.oneof(fc.nat(99), fc.constant(null)),
}).map(spec => ({ ...spec, head: headOf(spec.self) }))

const nestedArb = fc.array(nestedSpecArb, { minLength: 1, maxLength: 24 })

function landNodesOf(land: Land, head: LocalId): string[] {
  return land.order(head).map(view => idText(id48(view.bin, view.at + SAND_AT.self)))
}

describe('вложенные головы', () => {
  test('order каждой головы совпадает с оракулом', () => {
    fc.assert(
      fc.property(nestedArb, specs => {
        const units = unitsOf(specs)
        const land = freshLand()
        land.apply(units)
        const sands = toSands(units)

        for (const head of HEADS) {
          const node = land.nodeAt(head)
          const naive = orderNaive(sands, idText(head))
          expect(landNodesOf(land, node)).toEqual(naive.map(sand => sand.self))
          expect(land.order(node).map(v => v.value)).toEqual(naive.map(sand => sand.value))
        }
        return true
      }),
      { numRuns: 500 },
    )
  })

  test('сходимость: перестановка доставки не меняет ни одну голову', () => {
    fc.assert(
      fc.property(nestedArb, fc.array(fc.nat(1000), { minLength: 1, maxLength: 32 }), (specs, keys) => {
        const units = unitsOf(specs)

        const straight = freshLand()
        straight.apply(units)

        const mixed = [...units]
        for (let i = mixed.length - 1; i > 0; i--) {
          const j = (keys[i % keys.length] as number) % (i + 1)
          const tmp = mixed[i] as SandUnit
          mixed[i] = mixed[j] as SandUnit
          mixed[j] = tmp
        }
        const other = freshLand()
        for (const unit of mixed) other.apply([unit])

        for (const head of HEADS) {
          expect(landNodesOf(other, other.nodeAt(head))).toEqual(landNodesOf(straight, straight.nodeAt(head)))
        }
        expect(other.size()).toBe(straight.size())
        expect(other.count()).toBe(straight.count())
        return true
      }),
      { numRuns: 500 },
    )
  })

  test('достижимость: живой по LWW узел виден под своей головой', () => {
    fc.assert(
      fc.property(nestedArb, specs => {
        const units = unitsOf(specs)
        const land = freshLand()
        land.apply(units)
        const sands = toSands(units)

        for (const head of HEADS) {
          const alive = new Set<string>()
          for (const sand of resolveNaive(sands, idText(head)).values()) {
            if (sand.value !== null) alive.add(sand.self)
          }
          expect(new Set(landNodesOf(land, land.nodeAt(head)))).toEqual(alive)
        }
        return true
      }),
      { numRuns: 500 },
    )
  })
})

// ─── 10. Многопировые истории на ОПАСНЫХ пирах ───────────────────────────────
//
// Существующая сверка гоняет пиров `0x10…0x13`: у них и hex, и base64url, и
// байты дают один порядок, поэтому ADR-015 она не проверяет. Здесь пиры взяты
// вокруг всех границ: 0x7f/0x80 (знак u32) и 0xf4/0xf8 (base64url против байт).

const RISKY: readonly Uint8Array[] = [
  peerBytes(0xf4),
  peerBytes(0xf8),
  peerBytes(0x7f, 0xff, 0xff, 0xff),
  peerBytes(0x80),
]

type LandOp =
  | { readonly kind: 'insert', readonly at: number, readonly value: number }
  | { readonly kind: 'remove', readonly at: number }
  | { readonly kind: 'move', readonly at: number, readonly to: number }

const landOpArb: fc.Arbitrary<LandOp> = fc.oneof(
  fc.record({ kind: fc.constant('insert' as const), at: fc.nat(15), value: fc.nat(999) }),
  fc.record({ kind: fc.constant('remove' as const), at: fc.nat(15) }),
  { arbitrary: fc.record({ kind: fc.constant('move' as const), at: fc.nat(15), to: fc.nat(15) }), weight: 2 },
)

type Step =
  | { readonly kind: 'op', readonly peer: number, readonly op: LandOp }
  | { readonly kind: 'send', readonly from: number, readonly to: number }
  | { readonly kind: 'tick', readonly delta: number }

const stepArb: fc.Arbitrary<Step> = fc.oneof(
  { arbitrary: fc.record({ kind: fc.constant('op' as const), peer: fc.nat(3), op: landOpArb }), weight: 3 },
  { arbitrary: fc.record({ kind: fc.constant('send' as const), from: fc.nat(3), to: fc.nat(3) }), weight: 2 },
  { arbitrary: fc.record({ kind: fc.constant('tick' as const), delta: fc.integer({ min: 1, max: 2 }) }), weight: 1 },
)

const historyArb = fc.record({
  peers: fc.integer({ min: 2, max: 4 }),
  steps: fc.array(stepArb, { minLength: 8, maxLength: 40 }),
})

function runOp(land: Land, op: LandOp): void {
  const items = land.order(ROOT)
  if (op.kind === 'insert') {
    const at = items.length === 0 ? 0 : op.at % (items.length + 1)
    land.post(ROOT, at <= 0 ? ROOT : (items[at - 1] as { self: LocalId }).self, op.value)
    return
  }
  if (items.length === 0) return
  const target = items[op.at % items.length] as { self: LocalId }
  if (op.kind === 'remove') {
    land.remove(target.self)
    return
  }
  const to = op.to % (items.length + 1)
  land.move(target.self, to <= 0 ? ROOT : (items[to - 1] as { self: LocalId }).self)
}

describe('многопировая история на пирах со старшим битом', () => {
  test('после полной доставки все ленды читают одно и то же', () => {
    fc.assert(
      fc.property(historyArb, history => {
        const clock = fixedClock(1000)
        const lands: Land[] = []
        for (let i = 0; i < history.peers; i++) lands.push(new Land(Link.peer(RISKY[i] as Uint8Array), clock))

        for (const step of history.steps) {
          if (step.kind === 'op') runOp(lands[step.peer % history.peers] as Land, step.op)
          else if (step.kind === 'tick') clock.advance(step.delta)
          else {
            const from = lands[step.from % history.peers] as Land
            const to = lands[step.to % history.peers] as Land
            if (from !== to) to.apply(from.units())
          }
        }

        // Доставка до неподвижной точки.
        for (let round = 0; round < 8; round++) {
          let moved = 0
          for (const from of lands) {
            for (const to of lands) {
              if (from !== to) moved += to.apply(from.units())
            }
          }
          if (moved === 0) break
        }

        const first = lands[0] as Land
        const want = valuesOf(first)
        for (const land of lands) {
          expect(valuesOf(land)).toEqual(want)
          expect(land.size()).toBe(first.size())
          expect(land.count()).toBe(first.count())
        }
        return true
      }),
      { numRuns: 300 },
    )
  })

  test('каждый ленд совпадает с наивной раскладкой своих же юнитов', () => {
    fc.assert(
      fc.property(historyArb, history => {
        const clock = fixedClock(1000)
        const lands: Land[] = []
        for (let i = 0; i < history.peers; i++) lands.push(new Land(Link.peer(RISKY[i] as Uint8Array), clock))

        for (const step of history.steps) {
          if (step.kind === 'op') runOp(lands[step.peer % history.peers] as Land, step.op)
          else if (step.kind === 'tick') clock.advance(step.delta)
          else {
            const from = lands[step.from % history.peers] as Land
            const to = lands[step.to % history.peers] as Land
            if (from !== to) to.apply(from.units())
          }
        }

        for (const land of lands) {
          const sands = toSands(land.units())
          const naive = orderNaive(sands, ROOT_STR)
          expect(valuesOf(land)).toEqual(naive.map(sand => sand.value))
          expect(selvesOf(land).map(idText)).toEqual(naive.map(sand => sand.self))

          // Достижимость отдельным утверждением: сверка с оракулом её НЕ
          // подменяет — обе раскладки могут согласованно потерять один и тот же
          // живой узел (регрессия `move-cycle-drops-items`).
          const alive = new Set<string>()
          for (const sand of resolveNaive(sands, ROOT_STR).values()) {
            if (sand.value !== null) alive.add(sand.self)
          }
          const got = selvesOf(land).map(idText)
          expect(new Set(got).size).toBe(got.length)
          expect(new Set(got)).toEqual(alive)
        }
        return true
      }),
      { numRuns: 300 },
    )
  })
})

// ─── 11. Надгробие не воскресает ─────────────────────────────────────────────

describe('надгробие', () => {
  test('старый юнит, доехавший после удаления, не воскрешает элемент', () => {
    fc.assert(
      fc.property(corpusArb, fc.nat(7), (specs, victim) => {
        const units = unitsOf(specs)
        const land = freshLand()
        land.apply(units)

        // Надгробие заведомо позже всего, что было.
        const self = 1 + (victim % 8)
        const grave = sandOf({ peer: peerBytes(0x00), time: 2000, tick: 0, self, head: 0, lead: 0, value: null })
        land.apply([grave])
        expect(selvesOf(land)).not.toContain(self)

        // Любая доставка старых юнитов после этого — уже ничто.
        land.apply(units)
        expect(selvesOf(land)).not.toContain(self)
        return true
      }),
      { numRuns: 300 },
    )
  })
})

// ─── 12. Причинность локальной правки ────────────────────────────────────────
//
// Сходимость этого свойства не покрывает: реплики согласованно приходят к
// ответу, в котором увиденная правка проиграла тому, что она правила.

describe('причинность', () => {
  test('remove чужого элемента, уже увиденного, всегда убирает его из чтения', () => {
    fc.assert(
      fc.property(
        fc.nat(255), fc.nat(255), fc.integer({ min: 0, max: 3 }), fc.nat(3),
        (mine, alien, writes, alienTick) => {
          if (mine === alien) return true
          const land = new Land(Link.peer(peerBytes(mine, 0, 0, 0, 0, 0, 0, 1)), fixedClock(1000))
          // Свои записи в ту же секунду набивают `tick` — именно они и уводили
          // часы в ветку «последним писали мы».
          for (let i = 0; i <= writes; i++) land.post(ROOT, ROOT, i)

          const victim = 0x777
          land.apply([sandOf({
            peer: peerBytes(alien, 0, 0, 0, 0, 0, 0, 1),
            time: 1000,
            tick: alienTick,
            self: victim,
            head: 0,
            lead: 0,
            value: 'чужое',
          })])
          if (!selvesOf(land).includes(victim)) return true

          land.remove(land.nodeAt(victim))
          expect({ mine, alien, seen: selvesOf(land).includes(victim) })
            .toEqual({ mine, alien, seen: false })
          return true
        },
      ),
      { numRuns: 1500 },
    )
  })
})

// ─── 13. Два известных расхождения, зафиксированных красным ──────────────────

describe('известные дефекты', () => {
  /**
   * ADR-006: каждая вкладка держит ПОЛНЫЙ ленд и обменивается паками. Пир — хэш
   * публичного ключа (ADR-007), то есть у вкладок он ОДИН. Счётчик `self` и
   * `Stamp` живут в памяти ленда, поэтому обе вкладки чеканят один и тот же
   * `self` и одну и ту же метку `(time, tick)`.
   *
   * СХОДИМОСТЬ при этом держится — но не сама собой, а арбитром последней
   * инстанции: при совпавшей метке в одном слоте побеждает меньший ПОБАЙТОВО
   * юнит (`land.ts`, `#accept`). До него побеждал пришедший первым, и две
   * реплики с одним набором юнитов расходились НАВСЕГДА, а цикл «применять,
   * пока `apply` не вернёт 0» вставал, ничего не заподозрив.
   */
  test('две вкладки одного пира (ADR-006) всё же сходятся', () => {
    const clock = fixedClock(1000)
    const tabA = new Land(Link.peer(peerBytes(0x11)), clock)
    const tabB = new Land(Link.peer(peerBytes(0x11)), clock)

    tabA.post(ROOT, ROOT, 'из вкладки A')
    tabB.post(ROOT, ROOT, 'из вкладки B')

    for (let round = 0; round < 5; round++) {
      tabA.apply(tabB.units())
      tabB.apply(tabA.units())
    }

    expect(valuesOf(tabA)).toEqual(valuesOf(tabB))
  })

  /**
   * САМА коллизия порядком не лечится: раз обе вкладки выдали юниту один `self`,
   * слот `(head, peer, self)` у них общий, и арбитр обязан кого-то выбрать —
   * сходимость держится ценой молча потерянной правки.
   *
   * Лечение — **сеанс чеканки** (ADR-017): каждый одновременно живой экземпляр
   * ленда одного пира получает своё начало кольца счётчика, и их `self`
   * перестают совпадать. Энтропию даёт обвязка (`randomSession()` в
   * `wire/tabs`), ленд по умолчанию детерминирован — как с часами.
   */
  test('две вкладки с РАЗНЫМИ сеансами не теряют ни одной правки', () => {
    const clock = fixedClock(1000)
    const tabA = new Land(Link.peer(peerBytes(0x11)), clock, { session: 0x000100 })
    const tabB = new Land(Link.peer(peerBytes(0x11)), clock, { session: 0x800100 })

    tabA.post(ROOT, ROOT, 'из вкладки A')
    tabB.post(ROOT, ROOT, 'из вкладки B')

    for (let round = 0; round < 5; round++) {
      tabA.apply(tabB.units())
      tabB.apply(tabA.units())
    }

    expect(valuesOf(tabA).sort()).toEqual(['из вкладки A', 'из вкладки B'])
    expect(valuesOf(tabB).sort()).toEqual(['из вкладки A', 'из вкладки B'])
  })

  /**
   * Без сеансов дыра остаётся — и остаётся КРАСНОЙ намеренно: это документ о
   * том, что режим по умолчанию однописательный. Тот, кто держит два экземпляра
   * одного пира без сеансов, теряет правки; `wire/tabs` поэтому требует сеанс,
   * а не предлагает.
   */
  test.fails('две вкладки БЕЗ сеансов правку теряют', () => {
    const clock = fixedClock(1000)
    const tabA = new Land(Link.peer(peerBytes(0x11)), clock)
    const tabB = new Land(Link.peer(peerBytes(0x11)), clock)

    tabA.post(ROOT, ROOT, 'из вкладки A')
    tabB.post(ROOT, ROOT, 'из вкладки B')

    for (let round = 0; round < 5; round++) {
      tabA.apply(tabB.units())
      tabB.apply(tabA.units())
    }

    expect(valuesOf(tabA).sort()).toEqual(['из вкладки A', 'из вкладки B'])
  })

  test.fails('один self под двумя головами виден под обеими, как в docs/04 §1', () => {
    // Индекс модели — `head → peer → self` (docs/04 §1), и оракул `resolveNaive`
    // сворачивает LWW ВНУТРИ головы: слоты `(A, peer, self)` и `(B, peer, self)`
    // независимы. Боевой ленд держит победителя ГЛОБАЛЬНО по `self` (`Graph.refs`
    // индексируется номером узла), поэтому узел числится ровно под одной головой
    // и из второй пропадает. Расхождение молчаливое: генераторы существующей
    // сверки такой вход не порождают.
    const land = freshLand()
    land.apply([
      sandOf({ peer: peerBytes(0x10), time: 1000, tick: 0, self: 5, head: 1, lead: 0, value: 'в A' }),
      sandOf({ peer: peerBytes(0x10), time: 1001, tick: 0, self: 5, head: 2, lead: 0, value: 'в B' }),
    ])

    expect(land.order(land.nodeAt(1)).map(view => view.value)).toEqual(['в A'])
    expect(land.order(land.nodeAt(2)).map(view => view.value)).toEqual(['в B'])
  })
})

export { sandOf, peerBytes, freshLand, type LocalId }
