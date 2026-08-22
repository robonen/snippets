import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { order } from '../order'
import { orderNaive, resolveNaive } from '../order-naive'
import { fixedClock, Replica } from '../replica'
import { ROOT, type Sand } from '../sand'
import { aliveByLww, allSands, applyOp, converge, deliver, makeReplicas, shuffle, type Op } from './harness'

/**
 * Дифференциальный тест: боевой `order` против референсного `orderNaive` на
 * наборах, полученных из настоящих историй, а не выдуманных руками.
 *
 * Контракт разный по обе стороны от кольца в цепочке `lead`:
 * - **без колец** — побайтовое совпадение последовательности с референсом;
 * - **с кольцами** — линейного порядка внутри кольца не существует, поэтому
 *   требуется совпадение **множества** живых элементов плюс детерминизм: обе
 *   функции обязаны дать тот же ответ на перемешанном входном массиве.
 *
 * Кольца порождаются конкурентными `move`, поэтому генератор их не подделывает.
 * Обе ветки считаются, и обе обязаны реально встретиться: иначе тест зелёный
 * вхолостую.
 */

/** Прогонов property-теста. Шаг 3 плана требует десяти тысяч историй. */
const RUNS = 10_000

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ kind: fc.constant('insert' as const), at: fc.nat(15), value: fc.nat(999) }),
  fc.record({ kind: fc.constant('remove' as const), at: fc.nat(15) }),
  // `move` с двойным весом: кольца берутся только отсюда, а на равных долях
  // их в прогоне почти не остаётся.
  { arbitrary: fc.record({ kind: fc.constant('move' as const), at: fc.nat(15), to: fc.nat(15) }), weight: 2 },
)

type Step =
  | { readonly kind: 'op', readonly peer: number, readonly op: Op }
  | { readonly kind: 'send', readonly from: number, readonly to: number }
  | { readonly kind: 'leak', readonly from: number, readonly to: number, readonly seed: number }
  | { readonly kind: 'tick', readonly delta: number }

const stepArb: fc.Arbitrary<Step> = fc.oneof(
  { arbitrary: fc.record({ kind: fc.constant('op' as const), peer: fc.nat(4), op: opArb }), weight: 3 },
  { arbitrary: fc.record({ kind: fc.constant('send' as const), from: fc.nat(4), to: fc.nat(4) }), weight: 2 },
  { arbitrary: fc.record({ kind: fc.constant('leak' as const), from: fc.nat(4), to: fc.nat(4), seed: fc.nat(0xFFFFFF) }), weight: 2 },
  { arbitrary: fc.record({ kind: fc.constant('tick' as const), delta: fc.integer({ min: 1, max: 3 }) }), weight: 1 },
)

/**
 * Дырявая доставка: до собеседника доезжает случайное подмножество набора.
 *
 * Без неё генератор **не порождает сирот больше одной**. Причина в том, что
 * `deliver` отдаёт весь набор целиком: знание реплики оказывается объединением
 * полных снимков, и недоехавшее всегда обрывается в одном месте. Замер на
 * 10 000 историй без этого шага: 51 808 состояний без колец и **ни одного** с
 * двумя независимыми сиротами — то есть хвост сирот, где `order` и `orderNaive`
 * раскладывают по разным механизмам (`stalled` + каскад против «отфильтровать
 * непосещённых»), не проверялся вовсе. Проверено мутацией: разворот сортировки
 * сирот в `order.ts` оставлял property-прогон зелёным.
 *
 * Это не искусственное усложнение: пакеты в сети теряются поштучно, а не
 * снимками, и приход юнита раньше его `lead` — штатный случай, ради которого
 * в `order` вообще заведён индекс ждущих.
 *
 * @param keep сколько юнитов из четырёх доезжает
 */
function leak(sands: readonly Sand[], seed: number, keep: number): Sand[] {
  let state = (seed >>> 0) || 1
  const out: Sand[] = []

  for (const sand of sands) {
    state ^= state << 13
    state >>>= 0
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    if (state % 4 < keep) out.push(sand)
  }

  return out
}

interface Scenario {
  readonly peers: number
  readonly base: number
  readonly steps: readonly Step[]
  readonly keys: readonly number[]
}

/**
 * Общая база обязательна, а не украшение: без неё реплики почти всегда пусты,
 * и `remove`/`move` вырождаются в no-op (замер из `convergence.prop.test.ts`:
 * из 1370 сгенерированных `move` реально что-то делали 3). Без работающих
 * `move` не будет ни колец, ни детей старше своего `lead` — то есть ровно тех
 * мест, где раскладка списком имеет право разойтись с обходом дерева.
 */
const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  peers: fc.integer({ min: 2, max: 5 }),
  base: fc.integer({ min: 0, max: 6 }),
  steps: fc.array(stepArb, { minLength: 8, maxLength: 60 }),
  keys: fc.array(fc.nat(4096), { maxLength: 64 }),
})

/**
 * Прогон истории без финального схождения: реплики остаются в том
 * рассогласованном состоянии, до которого их довело расписание доставки.
 * Недоехавшие юниты — источник сирот, а они для сверки раскладок не менее
 * интересны, чем кольца.
 */
function run(scenario: Scenario): readonly Replica[] {
  const clock = fixedClock(1000)
  const replicas = makeReplicas(scenario.peers, clock)

  let lead = ROOT
  for (let i = 0; i < scenario.base; i++) lead = replicas[0]!.insert(lead, `база${i}`).self
  converge(...replicas)
  // Часы вперёд: правки после базы должны перекрывать её по LWW, а не спорить
  // с ней арбитром по `peer`.
  clock.advance(1)

  let serial = 0

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

    if (step.kind === 'leak') {
      const from = replicas[step.from % replicas.length]!
      const to = replicas[step.to % replicas.length]!
      if (from !== to) to.applySands(leak(from.sands(), step.seed, 3))
      continue
    }

    const replica = replicas[step.peer % replicas.length]!
    const op = step.op.kind === 'insert'
      ? { ...step.op, value: `${replica.peer}#${serial++}:${step.op.value}` }
      : step.op

    applyOp(replica, op)
  }

  return replicas
}

/** Форма набора: то, от чего зависит выбор контракта и полнота покрытия. */
interface Shape {
  /** Есть ли кольцо в цепочке `lead` среди победителей LWW. */
  readonly ringed: boolean
  /** Сколько узлов ссылаются на `lead`, которого в наборе нет. */
  readonly orphans: number
}

/**
 * Разбор набора честным обходом, а не эвристикой.
 *
 * Кольцо ищется подъёмом по одному ребру за шаг с двумя пометками: `1` — «узел
 * в текущей цепочке», `2` — «про узел всё выяснено». Возврат в текущую цепочку
 * и есть кольцо; упереться в недоехавший `lead` — не кольцо, а сирота. Узел,
 * висящий на кольце, тоже даёт `ringed`: он недостижим от корня по той же
 * причине, и линейного порядка для него не существует ровно так же.
 *
 * Пометка `2` нужна для линейности: без неё длинная цепочка переобходилась бы
 * от каждого своего узла, и на двадцати тысячах элементов разбор стоил бы
 * дороже самой раскладки.
 */
function shape(sands: readonly Sand[], head: string): Shape {
  const winners = resolveNaive(sands, head)

  let orphans = 0
  for (const sand of winners.values()) {
    if (sand.lead !== ROOT && !winners.has(sand.lead)) orphans += 1
  }

  const state = new Map<string, number>()

  for (const start of winners.keys()) {
    const path: string[] = []
    let at = start

    while (at !== ROOT) {
      const mark = state.get(at)
      if (mark === 2) break
      if (mark === 1) return { ringed: true, orphans }

      state.set(at, 1)
      path.push(at)

      const sand = winners.get(at)
      if (sand === undefined) break
      at = sand.lead
    }

    for (const self of path) state.set(self, 2)
  }

  return { ringed: false, orphans }
}

function selfs(sands: readonly Sand[]): string[] {
  return sands.map(sand => sand.self)
}

/** Одинаковы ли последовательности **поюнитно** — сравнение по ссылке на объект. */
function identical(left: readonly Sand[], right: readonly Sand[]): boolean {
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false
  }
  return true
}

/**
 * Счётчик покрытия. Каждое поле — сторож против теста, зелёного вхолостую:
 * ветка, которую генератор ни разу не задел, не проверена, сколько бы прогонов
 * ни стояло в `numRuns`.
 */
interface Tally {
  /** Сверок без кольца — здесь требуется побайтовое совпадение. */
  plain: number
  /** Сверок с кольцом — здесь требуется совпадение множества. */
  ringy: number
  /**
   * Сверок, где сирот больше одной, то есть хвост сирот реально упорядочивался.
   *
   * Считается отдельно, потому что это самая дорого добытая ветка: `order`
   * складывает хвост из индекса ждущих с каскадом, `orderNaive` — фильтром
   * непосещённых с обходом, и совпадают они не по построению.
   */
  multiOrphan: number
}

/**
 * Одна сверка: набор юнитов против референса.
 *
 * Бросает `Error` вместо `expect`, чтобы `fast-check` показал сид и путь
 * ужатия — на десяти тысячах прогонов сид дороже красивого diff'а. Заодно это
 * снимает с горячего цикла десятки тысяч вызовов `expect`.
 */
function diff(sands: readonly Sand[], head: string, keys: readonly number[], tally: Tally): void {
  const ours = order(sands, head)
  const reference = orderNaive(sands, head)

  // Детерминизм — предусловие всего остального: если раскладка зависит от
  // порядка перебора входа, сравнивать её с чем бы то ни было бессмысленно.
  // Проверяются **обе** функции: у референса ничьи `compare` разрешаются
  // стабильной сортировкой, то есть порядком поступления.
  const mixed = shuffle(sands, keys)
  const backwards = [...sands].reverse()

  if (!identical(order(mixed, head), ours)) {
    throw new Error(`order зависит от порядка перебора входа\n${JSON.stringify(sands)}`)
  }
  if (!identical(order(backwards, head), ours)) {
    throw new Error(`order зависит от разворота входа\n${JSON.stringify(sands)}`)
  }
  if (!identical(orderNaive(mixed, head), reference)) {
    throw new Error(`orderNaive зависит от порядка перебора входа\n${JSON.stringify(sands)}`)
  }

  const form = shape(sands, head)

  if (form.ringed) {
    tally.ringy += 1

    // Внутри кольца линейный порядок произволен, поэтому сравниваем множества.
    // Требование сильное: ни одного лишнего и ни одного потерянного элемента
    // относительно референса.
    //
    // Наблюдение, которое НЕ превращено в утверждение: фактически на всех
    // встреченных кольцах `order` совпал с `orderNaive` ещё и побайтово.
    // Требовать этого нельзя — совпадение не следует ни из какого инварианта,
    // оба лишь начинают кольцо с лучшего по LWW узла и дальше идут по одному
    // ребру. Ужесточить утверждение значило бы записать в контракт совпадение
    // реализаций, а не их свойств.
    const ourSet = selfs(ours).sort().join(',')
    const refSet = selfs(reference).sort().join(',')
    if (ourSet !== refSet) {
      throw new Error(`набор с кольцом разошёлся\nours=${ourSet}\nref =${refSet}\n${JSON.stringify(sands)}`)
    }
  } else {
    tally.plain += 1
    if (form.orphans > 1) tally.multiOrphan += 1

    if (!identical(ours, reference)) {
      throw new Error(
        `последовательность разошлась без колец\nours=${selfs(ours).join(',')}\nref =${selfs(reference).join(',')}\n${JSON.stringify(sands)}`,
      )
    }
  }

  // Сверх сверки с референсом: живой по LWW элемент обязан быть виден. Сироты и
  // кольца дописываются в хвост, а не выпадают из чтения.
  const shown = selfs(ours).sort().join(',')
  const alive = aliveByLww(sands, head).map(sand => sand.self).sort().join(',')
  if (shown !== alive) {
    throw new Error(`order потерял живое по LWW\nshown=${shown}\nalive=${alive}\n${JSON.stringify(sands)}`)
  }
}

describe('order против референса на случайных историях', () => {
  test('10 000 историй: без колец — побайтово как orderNaive, с кольцами — тот же набор', () => {
    const tally: Tally = { plain: 0, ringy: 0, multiOrphan: 0 }

    fc.assert(
      fc.property(scenarioArb, scenario => {
        const replicas = run(scenario)

        // Каждая реплика — своё состояние: расписание доставки развело их, и
        // рассогласованные наборы (недоехавшие `lead`) не менее интересны, чем
        // сошедшиеся.
        for (const replica of replicas) diff(replica.sands(), ROOT, scenario.keys, tally)

        // Объединение всех реплик: тут у одного `self` живут версии от разных
        // пиров сразу — это нагружает LWW-свёртку на входе обеих функций.
        diff(allSands(...replicas), ROOT, scenario.keys, tally)

        converge(...replicas)
        const whole = replicas[0]!.sands()
        diff(whole, ROOT, scenario.keys, tally)

        // Дырявые снимки сошедшегося набора: половина юнитов «не доехала».
        // Подмножество истории — это ровно то, что видит пир, до которого дошла
        // часть пака, и единственный источник **нескольких** независимых сирот
        // (сторож `multiOrphan` ниже). Три разных маски на историю, потому что
        // от одной дыры хвост сирот вырождается в один элемент.
        for (let mask = 0; mask < 3; mask++) {
          const seed = 0x9E3779B1 ^ ((scenario.keys[mask] ?? 0) << 8) ^ (scenario.steps.length << 3) ^ mask
          diff(leak(whole, seed, 2), ROOT, scenario.keys, tally)
        }
      }),
      { numRuns: RUNS },
    )

    // Все три ветки обязаны быть реально пройдены. Замер этого прогона:
    // ≈81 200 сверок без колец, ≈3 000 с кольцами, ≈4 700 с несколькими
    // сиротами (максимум шесть независимых). Пороги стоят на нуле, а не на
    // измеренных числах: сид у `fast-check` случайный, и сторож, привязанный к
    // величине, флакал бы вместо того, чтобы ловить вырождение генератора.
    expect(tally.plain).toBeGreaterThan(0)
    expect(tally.ringy).toBeGreaterThan(0)
    expect(tally.multiOrphan).toBeGreaterThan(0)
  })

  /**
   * Кольца по заказу: конкурентные `move` крест-накрест и `move` за
   * собственного потомка — два сценария, которые их гарантированно порождают.
   *
   * Фузз детерминированный (xorshift32 с фиксированным сидом), потому что от
   * property-генератора кольца приходят слишком редко, чтобы на них можно было
   * положиться: сид у `fast-check` случайный, и сторож на редкое событие флакал бы.
   */
  test('кольца из конкурентных move: набор тот же, ответ детерминирован', () => {
    let seed = 0x51f3c7d
    const random = (limit: number): number => {
      seed ^= seed << 13
      seed >>>= 0
      seed ^= seed >>> 17
      seed ^= seed << 5
      seed >>>= 0
      return seed % limit
    }

    const tally: Tally = { plain: 0, ringy: 0, multiOrphan: 0 }

    for (let round = 0; round < 400; round++) {
      const clock = fixedClock(1000)
      const replicas = makeReplicas(3, clock)

      let lead = ROOT
      for (let i = 0; i < 5; i++) lead = replicas[0]!.insert(lead, `б${i}`).self
      converge(...replicas)
      clock.advance(1)

      // Каждая реплика двигает свой элемент, не зная о чужих правках, — ровно
      // так замыкается цепочка `lead` в кольцо.
      for (const replica of replicas) {
        const items = replica.order()
        if (items.length < 2) continue
        const target = items[random(items.length)]!
        const at = random(items.length + 1)
        replica.move(target.self, at === 0 ? ROOT : items[at - 1]!.self)
      }

      converge(...replicas)

      const keys = [round, 7, 13, 29]
      for (const replica of replicas) diff(replica.sands(), ROOT, keys, tally)

      // Реплики сошлись, значит и читают одинаково — иначе кольцо развалило бы
      // сходимость, а не только порядок внутри себя.
      const first = order(replicas[0]!.sands(), ROOT).map(sand => sand.self)
      for (const replica of replicas) {
        expect(order(replica.sands(), ROOT).map(sand => sand.self)).toEqual(first)
      }
    }

    // Сторож самого фузза: если кольца перестали получаться, тест проверяет не
    // то, ради чего написан.
    expect(tally.ringy).toBeGreaterThan(0)
  })

  test('цепочка в 20 000 элементов раскладывается без переполнения стека', () => {
    // Стек — не абстрактная угроза: в тексте каждый символ это юнит, вставленный
    // за предыдущим, и рекурсивный обход ложился уже на десяти тысячах.
    const clock = fixedClock(1000)
    const replica = new Replica('p1', clock)

    let lead = ROOT
    for (let i = 0; i < 20_000; i++) lead = replica.insert(lead, i).self

    const sands = replica.sands()
    const read = order(sands, ROOT)

    expect(read).toHaveLength(20_000)
    expect(read.map(sand => sand.value)).toEqual(orderNaive(sands, ROOT).map(sand => sand.value))
  })
})

/**
 * Шаг 5 задания: обе функции прогоняются по **уже существующему** корпусу —
 * модульным примерам из `order-naive.test.ts` и сценариям из `regressions/`.
 *
 * Смысл отдельного прогона в том, что старые тесты проверяют только референс
 * (`Replica.order()` до сих пор зовёт `orderNaive`), а модульные примеры
 * `order.test.ts` не сверяются с ним построчно на всех головах. Здесь обе
 * функции получают один и тот же вход и обязаны ответить одинаково.
 */
describe('order ≡ orderNaive на существующем корпусе', () => {
  interface SandOpts {
    readonly head?: string
    readonly peer?: string
    readonly time?: number
    readonly tick?: number
  }

  const sand = (self: string, lead: string, value: unknown, opts: SandOpts = {}): Sand => ({
    self,
    head: opts.head ?? ROOT,
    lead,
    peer: opts.peer ?? 'p1',
    time: opts.time ?? 1,
    tick: opts.tick ?? 0,
    value,
  })

  /** Случай корпуса: набор юнитов и головы, по которым его читают. */
  interface Case {
    readonly name: string
    readonly sands: readonly Sand[]
    readonly heads: readonly string[]
  }

  // Ровно те наборы, что стоят в модульных примерах `order-naive.test.ts`.
  const examples: readonly Case[] = [
    { name: 'пустой набор', sands: [], heads: [ROOT] },
    { name: 'единственный элемент', sands: [sand('a', ROOT, 'A')], heads: [ROOT] },
    {
      name: 'цепочка lead',
      sands: [sand('a', ROOT, 'A'), sand('b', 'a', 'B'), sand('c', 'b', 'C')],
      heads: [ROOT],
    },
    {
      name: 'два конкурента на одном lead',
      sands: [
        sand('a', ROOT, 'A', { time: 1 }),
        sand('x', 'a', 'X', { time: 2, peer: 'p1' }),
        sand('y', 'a', 'Y', { time: 3, peer: 'p1' }),
      ],
      heads: [ROOT],
    },
    {
      name: 'конкуренты в одну секунду: арбитр — peer',
      sands: [
        sand('a', ROOT, 'A', { time: 1 }),
        sand('x', 'a', 'X', { time: 2, peer: 'p1' }),
        sand('y', 'a', 'Y', { time: 2, peer: 'p2' }),
      ],
      heads: [ROOT],
    },
    {
      name: 'надгробие в середине цепочки',
      sands: [
        sand('a', ROOT, 'A'),
        sand('b', 'a', 'B'),
        sand('c', 'b', 'C'),
        sand('b', 'a', null, { time: 5 }),
      ],
      heads: [ROOT],
    },
    {
      name: 'потомок удалённого по lead',
      sands: [sand('a', ROOT, 'A'), sand('b', 'a', null, { time: 5 }), sand('d', 'b', 'D', { time: 7 })],
      heads: [ROOT],
    },
    {
      name: 'потомок удалённого по head',
      sands: [sand('b', ROOT, null, { time: 5 }), sand('d', ROOT, 'D', { head: 'b' })],
      heads: [ROOT, 'b'],
    },
    {
      name: 'несколько уровней вложенности через head',
      sands: [
        sand('d1', ROOT, 'D1', { head: 'k2' }),
        sand('k2', 'k1', 'K2', { head: 'r1' }),
        sand('r2', 'r1', 'R2'),
        sand('k1', ROOT, 'K1', { head: 'r1' }),
        sand('r1', ROOT, 'R1'),
      ],
      heads: [ROOT, 'r1', 'r2', 'k2'],
    },
    {
      name: 'юнит с недоехавшим lead',
      sands: [sand('b', 'a', 'B'), sand('a', ROOT, 'A')],
      heads: [ROOT],
    },
    {
      name: 'ветвление lead: у одного узла двое детей',
      sands: [sand('b0', ROOT, 'b0', { time: 1 }), sand('b1', 'b0', 'b1', { time: 2 }), sand('x', 'b0', 'x', { time: 3 })],
      heads: [ROOT],
    },
    {
      name: 'ребёнок старше своего lead',
      sands: [sand('x', ROOT, 'X', { time: 9 }), sand('d', 'x', 'D', { time: 2 }), sand('s', ROOT, 'S', { time: 5 })],
      heads: [ROOT],
    },
    {
      name: 'цепочка сирот',
      sands: [sand('a', ROOT, 'A', { time: 9 }), sand('o1', 'нет', 'O1', { time: 3 }), sand('o2', 'o1', 'O2', { time: 4 })],
      heads: [ROOT],
    },
    {
      name: 'надгробие-сирота со своим поддеревом',
      sands: [sand('g', 'нет', null, { time: 3 }), sand('k', 'g', 'K', { time: 4 })],
      heads: [ROOT],
    },
    {
      name: 'юниты чужого head',
      sands: [sand('a', ROOT, 'A', { time: 1 }), sand('b', 'a', 'B', { head: 'иной', time: 2 })],
      heads: [ROOT, 'иной'],
    },
  ]

  /**
   * Сценарии из `regressions/` — воспроизведены операциями, а не переписаны в
   * юниты: смысл регрессии в том, какой граф порождает `Replica`, и захардкоженный
   * набор перестал бы за ним следить.
   */
  const regressions: readonly Case[] = [
    (() => {
      // `move-cycle-drops-items`: конкурентные `move` крест-накрест.
      const clock = fixedClock(1000)
      const [left, right] = makeReplicas(2, clock) as [Replica, Replica]

      const ids: string[] = []
      let lead = ROOT
      for (const value of ['1', '2', '3', '4']) {
        lead = left.insert(lead, value).self
        ids.push(lead)
      }
      converge(left, right)
      clock.advance(1)

      left.move(ids[0]!, ids[2]!)
      right.move(ids[2]!, ids[0]!)
      converge(left, right)

      return { name: 'move крест-накрест замыкает кольцо', sands: allSands(left, right), heads: [ROOT] }
    })(),
    (() => {
      // `move-over-tombstone-drops-list`: `move` поверх надгробия.
      const clock = fixedClock(1000)
      const replica = new Replica('p1', clock)

      const one = replica.insert(ROOT, '1')
      const two = replica.insert(one.self, '2')
      const three = replica.insert(two.self, '3')
      replica.remove(two.self)
      replica.move(one.self, three.self)

      return { name: 'move поверх надгробия', sands: replica.sands(), heads: [ROOT] }
    })(),
    (() => {
      // `move-past-branched-lead`: `move` за собственного потомка.
      const clock = fixedClock(1000)
      const replica = new Replica('p1', clock)

      const b0 = replica.insert(ROOT, 'b0')
      const b1 = replica.insert(b0.self, 'b1')
      replica.insert(b0.self, 'x')
      replica.move(b0.self, b1.self)

      return { name: 'move за собственного потомка', sands: replica.sands(), heads: [ROOT] }
    })(),
  ]

  const corpus = [...examples, ...regressions]

  for (const item of corpus) {
    test(`${item.name}`, () => {
      const tally: Tally = { plain: 0, ringy: 0, multiOrphan: 0 }
      for (const head of item.heads) {
        // Ключи перемешивания разные, чтобы детерминизм проверялся не одной
        // и той же перестановкой.
        diff(item.sands, head, [3, 11, 5, 17, 2], tally)
      }
      expect(tally.plain + tally.ringy).toBe(item.heads.length)
    })
  }

  test('корпус реально содержит и кольца, и сироты, и надгробия', () => {
    // Сторож состава: если корпус выродится в набор линейных цепочек, тесты
    // выше останутся зелёными, но сверять будет нечего.
    const ringy = corpus.filter(item => item.heads.some(head => shape(item.sands, head).ringed))
    const orphaned = corpus.filter(item => item.heads.some(head => shape(item.sands, head).orphans > 0))
    const graves = corpus.filter(item => item.sands.some(s => s.value === null))

    expect(ringy.length).toBeGreaterThan(0)
    expect(orphaned.length).toBeGreaterThan(0)
    expect(graves.length).toBeGreaterThan(0)
  })
})
