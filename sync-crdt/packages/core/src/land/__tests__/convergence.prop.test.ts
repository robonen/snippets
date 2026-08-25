import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { fixedClock, Replica, type FixedClock } from '../replica'
import { ROOT } from '../sand'
import {
  aliveByLww,
  allHistory,
  allSands,
  applyOp,
  converge,
  deliver,
  makeReplica,
  makeReplicas,
  readAll,
  shuffle,
  type Op,
} from './harness'

/**
 * Property-тесты свойств из [docs/04 §6](../../../../../docs/04-crdt-core.md#6-свойства-которые-обязаны-выполняться).
 *
 * Модель одна на все свойства: 2..5 реплик на общих часах, случайные позиционные
 * операции вперемешку со случайными доставками, потом `converge`. Различаются
 * только утверждения в конце.
 */

const RUNS = 500

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ kind: fc.constant('insert' as const), at: fc.nat(15), value: fc.nat(999) }),
  fc.record({ kind: fc.constant('remove' as const), at: fc.nat(15) }),
  fc.record({ kind: fc.constant('move' as const), at: fc.nat(15), to: fc.nat(15) }),
)

type Step =
  | { readonly kind: 'op', readonly peer: number, readonly op: Op }
  | { readonly kind: 'send', readonly from: number, readonly to: number }
  | { readonly kind: 'tick', readonly delta: number }

const stepArb: fc.Arbitrary<Step> = fc.oneof(
  { arbitrary: fc.record({ kind: fc.constant('op' as const), peer: fc.nat(4), op: opArb }), weight: 3 },
  { arbitrary: fc.record({ kind: fc.constant('send' as const), from: fc.nat(4), to: fc.nat(4) }), weight: 2 },
  { arbitrary: fc.record({ kind: fc.constant('tick' as const), delta: fc.integer({ min: 1, max: 3 }) }), weight: 1 },
)

interface Scenario {
  readonly peers: number
  readonly base: number
  readonly steps: readonly Step[]
}

/**
 * Общий базовый список обязателен, а не украшение: без него реплики почти
 * всегда пусты, и `remove`/`move` вырождаются в no-op. Замер на 500 прогонах:
 * без базы из 1370 сгенерированных `move` реально что-то делали 3.
 */
const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  peers: fc.integer({ min: 2, max: 5 }),
  base: fc.integer({ min: 0, max: 6 }),
  steps: fc.array(stepArb, { minLength: 8, maxLength: 60 }),
})

interface World {
  readonly replicas: readonly Replica[]
  readonly clock: FixedClock
}

/**
 * Прогон сценария без финального схождения: реплики остаются в том
 * рассогласованном состоянии, до которого их довело расписание.
 *
 * Значения помечаются автором и порядковым номером — иначе при сравнении
 * состояний нельзя отличить «одинаковые списки» от «одинаковые числа».
 */
function run(scenario: Scenario): World {
  const clock = fixedClock(1000)
  const replicas = makeReplicas(scenario.peers, clock)

  let serial = 0

  let lead = ROOT
  for (let i = 0; i < scenario.base; i++) lead = replicas[0]!.insert(lead, `база${i}`).self
  converge(...replicas)
  // Часы вперёд: правки после базы должны перекрывать её по LWW, а не спорить
  // с ней арбитром по `peer`.
  clock.advance(1)

  for (const step of scenario.steps) {
    if (step.kind === 'tick') {
      clock.advance(step.delta)
      continue
    }

    if (step.kind === 'send') {
      const from = replicas[step.from % replicas.length]!
      const to = replicas[step.to % replicas.length]!
      if (from !== to) deliver(from, to)
      continue
    }

    const replica = replicas[step.peer % replicas.length]!
    const op = step.op.kind === 'insert'
      ? { ...step.op, value: `${replica.peer}#${serial++}:${step.op.value}` }
      : step.op

    applyOp(replica, op)
  }

  return { replicas, clock }
}

describe('convergence properties of the naive order', () => {
  test('convergence — after syncing all replicas read the same', () => {
    fc.assert(
      fc.property(scenarioArb, scenario => {
        const { replicas } = run(scenario)
        converge(...replicas)

        const first = readAll(replicas[0]!)
        for (const replica of replicas) expect(readAll(replica)).toEqual(first)
      }),
      { numRuns: RUNS },
    )
  })

  test('idempotence — redelivering the same set changes nothing', () => {
    fc.assert(
      fc.property(scenarioArb, scenario => {
        const { replicas } = run(scenario)
        converge(...replicas)

        const before = replicas.map(replica => readAll(replica))

        for (const from of replicas) {
          for (const to of replicas) {
            if (from === to) continue
            // Ноль принятых — часть свойства, а не оптимизация: если повтор
            // считается изменением, `converge` не имеет неподвижной точки.
            expect(deliver(from, to)).toBe(0)
          }
        }

        replicas.forEach((replica, i) => expect(readAll(replica)).toEqual(before[i]))
      }),
      { numRuns: RUNS },
    )
  })

  test('commutativity — the order of applying deltas does not affect the result', () => {
    fc.assert(
      fc.property(scenarioArb, fc.array(fc.nat(4096), { maxLength: 64 }), (scenario, keys) => {
        const { replicas, clock } = run(scenario)
        converge(...replicas)

        const delta = allSands(...replicas)

        const straight = makeReplica('обозреватель', clock)
        straight.applySands(delta)

        const jumbled = makeReplica('обозреватель', clock)
        jumbled.applySands(shuffle(delta, keys))

        const backwards = makeReplica('обозреватель', clock)
        backwards.applySands([...delta].reverse())

        expect(readAll(jumbled)).toEqual(readAll(straight))
        expect(readAll(backwards)).toEqual(readAll(straight))
        expect(readAll(straight)).toEqual(readAll(replicas[0]!))
      }),
      { numRuns: RUNS },
    )
  })

  test('tombstone — the removed is not resurrected by an old unit', () => {
    fc.assert(
      fc.property(scenarioArb, fc.array(fc.nat(4096), { maxLength: 64 }), (scenario, keys) => {
        const { replicas } = run(scenario)
        converge(...replicas)

        const before = replicas.map(replica => readAll(replica))
        // История содержит и перекрытые версии — в том числе живой юнит,
        // поверх которого позже легло надгробие. Именно он и не должен
        // воскресить элемент, в каком бы порядке ни приехал.
        const past = shuffle(allHistory(...replicas), keys)

        replicas.forEach((replica, i) => {
          expect(replica.applySands(past)).toBe(0)
          expect(readAll(replica)).toEqual(before[i])
        })
      }),
      { numRuns: RUNS },
    )
  })

  test('interleaving-free — concurrent blocks do not interleave', () => {
    fc.assert(
      fc.property(
        fc.record({
          base: fc.nat(4),
          at: fc.nat(9),
          left: fc.integer({ min: 3, max: 5 }),
          right: fc.integer({ min: 3, max: 5 }),
        }),
        plan => {
          const clock = fixedClock(1000)
          const [a, b] = makeReplicas(2, clock) as [Replica, Replica]

          let lead = ROOT
          for (let i = 0; i < plan.base; i++) lead = a.insert(lead, `база${i}`).self
          converge(a, b)

          // Обе реплики целятся в одну и ту же точку общего префикса.
          const items = a.order()
          const at = items.length === 0 ? 0 : plan.at % (items.length + 1)
          const anchor = at === 0 ? ROOT : items[at - 1]!.self

          clock.advance(1)

          const leftValues = insertBlock(a, anchor, 'A', plan.left)
          const rightValues = insertBlock(b, anchor, 'B', plan.right)

          converge(a, b)

          const read = readAll(a)
          expect(readAll(b)).toEqual(read)
          expectBlock(read, leftValues)
          expectBlock(read, rightValues)
        },
      ),
      { numRuns: RUNS },
    )
  })

  test('reachability — an element alive by LWW is visible in the read order', () => {
    fc.assert(
      fc.property(scenarioArb, scenario => {
        const { replicas } = run(scenario)
        converge(...replicas)

        const replica = replicas[0]!
        const alive = aliveByLww(replica.sands()).map(sand => sand.self).sort()
        const shown = replica.order().map(sand => sand.self).sort()

        // Расхождение здесь — это молча пропавшие элементы: LWW считает их
        // живыми, а обход от корня до них не доходит.
        expect(shown).toEqual(alive)
      }),
      { numRuns: RUNS },
    )
  })
})

/** Блок из `size` элементов подряд, вставленный цепочкой за `anchor`. */
function insertBlock(replica: Replica, anchor: string, mark: string, size: number): string[] {
  const out: string[] = []
  let lead = anchor

  for (let i = 0; i < size; i++) {
    const value = `${mark}${i}`
    lead = replica.insert(lead, value).self
    out.push(value)
  }

  return out
}

/** Значения блока обязаны лежать подряд и в исходном порядке. */
function expectBlock(read: readonly unknown[], block: readonly string[]): void {
  const at = read.indexOf(block[0])
  expect(at).toBeGreaterThanOrEqual(0)
  expect(read.slice(at, at + block.length)).toEqual(block)
}
