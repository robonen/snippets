import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { readU16, readU32 } from '../../binary/bytes'
import { Link } from '../../binary/link'
import { type AnyUnit, SAND_AT, SandUnit, UNIT_AT } from '../../binary/unit'
import { fixedClock } from '../clock'
import { Land } from '../land'
import { orderNaive, resolveNaive } from '../order-naive'
import { Replica } from '../replica'
import { ROOT as ROOT_STR, type Sand } from '../sand'
import { ROOT, id48, type LocalId } from '../view'
import { applyOp, type Op } from './harness'

/**
 * Дифференциальная сверка боевого `Land` (источник истины — байты) с наивным
 * оракулом на обычных объектах.
 *
 * Это правило проекта, а не украшение: раскладку по цепочке `lead` глазами не
 * проверить, поэтому у неё обязана быть вторая, честно тупая реализация. Сверка
 * идёт по двум осям, и каждая ловит своё:
 *
 * 1. **Раскладка** — те же самые юниты, переведённые в `Sand`, скармливаются
 *    `orderNaive`. Расхождение здесь означает ошибку в обходе или в группировке.
 * 2. **Операции** — один и тот же поток позиционных правок гоняется через `Land`
 *    и через `Replica`. Расхождение здесь означает ошибку в часах, в чеканке
 *    `self` или в приёме — то, чего первая ось не видит, потому что кормит обе
 *    стороны одними данными.
 *
 * Пиры выбраны так, что их HEX-текст сохраняет порядок байт (ADR-015): иначе
 * оракул и боевой ленд разошлись бы на конкурентных правках в одну секунду, и
 * это была бы разница представлений пира, а не раскладки.
 */

/** Лорд `0x1i0000…`: hex-текст такого пира сортируется как его байты. */
function peerOf(index: number): Link {
  const bin = new Uint8Array(8)
  bin[0] = 0x10 + index
  return Link.peer(bin)
}

function hexOf(bin: Uint8Array, at: number, size: number): string {
  let out = ''
  for (let i = at; i < at + size; i++) out += (bin[i] as number).toString(16).padStart(2, '0')
  return out
}

/**
 * Локальный id как ключ оракула. Ноль обязан стать `ROOT` слоя на объектах:
 * `orderNaive` начинает обход именно с него.
 */
function idText(id: number): string {
  return id === 0 ? ROOT_STR : `n${id.toString(36)}`
}

/** Юниты ленда в терминах `Sand` — вход для наивной раскладки. */
function toSands(units: readonly AnyUnit[]): Sand[] {
  const out: Sand[] = []

  for (const unit of units) {
    const bin = unit.bin
    out.push({
      self: idText(id48(bin, SAND_AT.self)),
      head: idText(id48(bin, SAND_AT.head)),
      lead: idText(id48(bin, SAND_AT.lead)),
      peer: hexOf(bin, UNIT_AT.peer, 8),
      time: readU32(bin, UNIT_AT.time),
      tick: readU16(bin, UNIT_AT.tick),
      value: (unit as SandUnit).value(),
    })
  }

  return out
}

/**
 * Что за состояние получилось: сколько живых по LWW узлов недостижимо от начала
 * списка и есть ли среди них кольцо.
 *
 * Считается независимо от обеих сверяемых раскладок — иначе сторож генератора
 * подтверждал бы сам себя. Обе ветки обязаны реально встретиться: без сирот не
 * проверяется хвост, без колец — устойчивость обхода к циклу в цепочке `lead`.
 */
function shapeOf(sands: readonly Sand[]): { strays: number, rings: number } {
  const winners = resolveNaive(sands, ROOT_STR)

  const kids = new Map<string, Sand[]>()
  for (const sand of winners.values()) {
    const bucket = kids.get(sand.lead)
    if (bucket === undefined) kids.set(sand.lead, [sand])
    else bucket.push(sand)
  }

  const seen = new Set<string>()
  const stack = [...(kids.get(ROOT_STR) ?? [])]
  while (stack.length > 0) {
    const sand = stack.pop() as Sand
    if (seen.has(sand.self)) continue
    seen.add(sand.self)
    for (const kid of kids.get(sand.self) ?? []) stack.push(kid)
  }

  let rings = 0
  for (const sand of winners.values()) {
    if (seen.has(sand.self)) continue
    // Цепочка `lead` от сироты либо упирается в недоехавший юнит, либо
    // возвращается в уже пройденное — второе и есть кольцо.
    const path = new Set<string>()
    let cursor: Sand | undefined = sand
    while (cursor !== undefined && !path.has(cursor.self)) {
      path.add(cursor.self)
      cursor = winners.get(cursor.lead)
    }
    if (cursor !== undefined) rings += 1
  }

  return { strays: winners.size - seen.size, rings }
}

/** Детерминированный xorshift: прогон обязан воспроизводиться по сиду. */
function lcg(seed: number): () => number {
  let state = (seed >>> 0) || 1
  return () => {
    state ^= state << 13
    state >>>= 0
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return state
  }
}

/**
 * Дырявая доставка: до собеседника доезжает случайное подмножество.
 *
 * Без неё сирот в прогоне почти не появляется — знание реплики оказывается
 * объединением полных снимков, и недоехавшее всегда обрывается в одном месте.
 * А хвост сирот у обеих раскладок свой: одна собирает их из непосещённых, другая
 * из группировки.
 */
function leak(units: readonly AnyUnit[], seed: number): AnyUnit[] {
  const next = lcg(seed)
  const out: AnyUnit[] = []
  for (const unit of units) {
    if (next() % 4 < 3) out.push(unit)
  }
  return out
}

/** Та же операция в терминах позиций, что и `applyOp` для `Replica`. */
function applyLandOp(land: Land, op: Op): boolean {
  const items = land.order(ROOT)

  if (op.kind === 'insert') {
    const at = items.length === 0 ? 0 : op.at % (items.length + 1)
    land.post(ROOT, at <= 0 ? ROOT : (items[at - 1] as { self: LocalId }).self, op.value as number)
    return true
  }

  if (items.length === 0) return false

  const target = items[op.at % items.length] as { self: LocalId }
  if (op.kind === 'remove') return land.remove(target.self)

  const to = op.to % (items.length + 1)
  return land.move(target.self, to <= 0 ? ROOT : (items[to - 1] as { self: LocalId }).self)
}

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ kind: fc.constant('insert' as const), at: fc.nat(15), value: fc.nat(999) }),
  fc.record({ kind: fc.constant('remove' as const), at: fc.nat(15) }),
  // `move` с двойным весом: кольца в цепочке `lead` берутся только отсюда.
  { arbitrary: fc.record({ kind: fc.constant('move' as const), at: fc.nat(15), to: fc.nat(15) }), weight: 2 },
)

type Step =
  | { readonly kind: 'op', readonly peer: number, readonly op: Op }
  | { readonly kind: 'send', readonly from: number, readonly to: number }
  | { readonly kind: 'leak', readonly from: number, readonly to: number, readonly seed: number }
  | { readonly kind: 'tick', readonly delta: number }

const stepArb: fc.Arbitrary<Step> = fc.oneof(
  { arbitrary: fc.record({ kind: fc.constant('op' as const), peer: fc.nat(3), op: opArb }), weight: 3 },
  { arbitrary: fc.record({ kind: fc.constant('send' as const), from: fc.nat(3), to: fc.nat(3) }), weight: 2 },
  { arbitrary: fc.record({ kind: fc.constant('leak' as const), from: fc.nat(3), to: fc.nat(3), seed: fc.nat(0xffffff) }), weight: 2 },
  { arbitrary: fc.record({ kind: fc.constant('tick' as const), delta: fc.integer({ min: 1, max: 3 }) }), weight: 1 },
)

interface Scenario {
  readonly peers: number
  readonly base: number
  readonly steps: readonly Step[]
}

/**
 * Общая база обязательна: без неё реплики почти всегда пусты, `remove`/`move`
 * вырождаются в no-op, и не будет ни колец, ни детей старше своего `lead` — то
 * есть ровно тех мест, где раскладки имеют право разойтись.
 */
const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  peers: fc.integer({ min: 2, max: 4 }),
  base: fc.integer({ min: 0, max: 6 }),
  steps: fc.array(stepArb, { minLength: 8, maxLength: 50 }),
})

describe('раскладка сверяется с наивным оракулом', () => {
  test('на историях из настоящих операций порядок совпадает поэлементно', () => {
    let rings = 0
    let strays = 0

    fc.assert(
      fc.property(scenarioArb, scenario => {
        const clock = fixedClock(1000)
        const lands: Land[] = []
        for (let i = 0; i < scenario.peers; i++) lands.push(new Land(peerOf(i), clock))

        let lead = ROOT
        for (let i = 0; i < scenario.base; i++) lead = (lands[0] as Land).post(ROOT, lead, i).self
        for (const land of lands) {
          for (const other of lands) {
            if (land !== other) land.apply(other.units())
          }
        }
        // Часы вперёд: правки после базы должны перекрывать её по времени, а не
        // спорить с ней арбитром по пиру.
        clock.advance(1)

        for (const step of scenario.steps) {
          if (step.kind === 'op') applyLandOp(lands[step.peer % scenario.peers] as Land, step.op)
          else if (step.kind === 'tick') clock.advance(step.delta)
          else {
            const from = lands[step.from % scenario.peers] as Land
            const to = lands[step.to % scenario.peers] as Land
            if (from === to) continue
            to.apply(step.kind === 'leak' ? leak(from.units(), step.seed) : from.units())
          }
        }

        for (const land of lands) {
          const sands = toSands(land.units())
          const mine = land.order(ROOT)
          const naive = orderNaive(sands, ROOT_STR)

          expect(mine.map(view => view.value)).toEqual(naive.map(sand => sand.value))
          expect(mine.map(view => idText(id48(view.bin, view.at + SAND_AT.self)))).toEqual(naive.map(sand => sand.self))

          const shape = shapeOf(sands)
          if (shape.strays > 0) strays += 1
          if (shape.rings > 0) rings += 1
        }

        return true
      }),
      { numRuns: 400 },
    )

    // Сторож самого генератора: если интересные состояния перестанут
    // порождаться, сверка станет зелёной вхолостую.
    expect(strays).toBeGreaterThan(0)
    expect(rings).toBeGreaterThan(0)
  })
})

describe('операции сверяются с Replica', () => {
  test('один поток правок даёт один порядок и одни значения', () => {
    fc.assert(
      fc.property(scenarioArb, scenario => {
        const landClock = fixedClock(1000)
        const replicaClock = fixedClock(1000)

        const lands: Land[] = []
        const replicas: Replica[] = []
        for (let i = 0; i < scenario.peers; i++) {
          lands.push(new Land(peerOf(i), landClock))
          // Пир реплики — тот же HEX, что у ленда: арбитраж обязан сравнивать
          // одно и то же, иначе тест меряет разницу представлений (ADR-015).
          replicas.push(new Replica(hexOf(peerOf(i).bin, 0, 8), replicaClock))
        }

        let lead = ROOT
        let leadStr = ROOT_STR
        for (let i = 0; i < scenario.base; i++) {
          lead = (lands[0] as Land).post(ROOT, lead, i).self
          leadStr = (replicas[0] as Replica).insert(leadStr, i).self
        }
        for (let i = 0; i < scenario.peers; i++) {
          for (let j = 0; j < scenario.peers; j++) {
            if (i === j) continue
            ;(lands[i] as Land).apply((lands[j] as Land).units())
            ;(replicas[i] as Replica).applySands((replicas[j] as Replica).sands())
          }
        }
        landClock.advance(1)
        replicaClock.advance(1)

        for (const step of scenario.steps) {
          if (step.kind === 'op') {
            const at = step.peer % scenario.peers
            applyLandOp(lands[at] as Land, step.op)
            applyOp(replicas[at] as Replica, step.op)
          } else if (step.kind === 'tick') {
            landClock.advance(step.delta)
            replicaClock.advance(step.delta)
          } else {
            // Дырявая доставка здесь не воспроизводима: у юнита ленда и у санда
            // реплики разные `self`, общего ключа для одинакового прореживания
            // нет. Дыры проверяет первая ось, где обе стороны едят одни байты.
            const from = step.from % scenario.peers
            const to = step.to % scenario.peers
            if (from === to) continue
            ;(lands[to] as Land).apply((lands[from] as Land).units())
            ;(replicas[to] as Replica).applySands((replicas[from] as Replica).sands())
          }

          for (let i = 0; i < scenario.peers; i++) {
            expect((lands[i] as Land).order(ROOT).map(view => view.value))
              .toEqual((replicas[i] as Replica).read())
          }
        }

        return true
      }),
      { numRuns: 200 },
    )
  })
})
