import { describe, expect, test } from 'vitest'
import { order } from '../order'
import { orderNaive } from '../order-naive'
import { ROOT, type Sand } from '../sand'

interface SandOpts {
  readonly head?: string
  readonly peer?: string
  readonly time?: number
  readonly tick?: number
}

/** Юнит вручную: модульные примеры задают граф напрямую, минуя `Replica`. */
function sand(self: string, lead: string, value: unknown, opts: SandOpts = {}): Sand {
  return {
    self,
    head: opts.head ?? ROOT,
    lead,
    peer: opts.peer ?? 'p1',
    time: opts.time ?? 1,
    tick: opts.tick ?? 0,
    value,
  }
}

function values(sands: readonly Sand[]): unknown[] {
  return sands.map(item => item.value)
}

/**
 * Все перестановки входа дают один и тот же ответ.
 *
 * Полный перебор, а не пара случайных раскладок: наборы в примерах маленькие,
 * а именно на порядке перебора и ломается детерминизм раскладки.
 */
function every(sands: readonly Sand[], head: string = ROOT): unknown[] {
  const first = order(sands, head)

  for (const mix of permutations(sands)) {
    expect(values(order(mix, head))).toEqual(values(first))
  }

  return values(first)
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]]

  const out: T[][] = []
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)]
    for (const tail of permutations(rest)) out.push([items[i] as T, ...tail])
  }

  return out
}

describe('order — модульные примеры наивной версии', () => {
  test('пустой набор читается пустым списком', () => {
    expect(order([], ROOT)).toEqual([])
  })

  test('единственный элемент', () => {
    const a = sand('a', ROOT, 'A')
    expect(values(order([a], ROOT))).toEqual(['A'])
  })

  test('цепочка lead выкладывается по порядку', () => {
    const a = sand('a', ROOT, 'A')
    const b = sand('b', 'a', 'B')
    const c = sand('c', 'b', 'C')

    expect(values(order([a, b, c], ROOT))).toEqual(['A', 'B', 'C'])
  })

  test('порядок входного массива не влияет на результат', () => {
    const a = sand('a', ROOT, 'A')
    const b = sand('b', 'a', 'B')
    const c = sand('c', 'b', 'C')

    const expected = ['A', 'B', 'C']
    expect(values(order([c, b, a], ROOT))).toEqual(expected)
    expect(values(order([b, c, a], ROOT))).toEqual(expected)
    expect(values(order([a, c, b], ROOT))).toEqual(expected)
  })

  test('два конкурента на одном lead: свежий встаёт первым', () => {
    const base = sand('a', ROOT, 'A', { time: 1 })
    const older = sand('x', 'a', 'X', { time: 2, peer: 'p1' })
    const newer = sand('y', 'a', 'Y', { time: 3, peer: 'p1' })

    expect(values(order([base, older, newer], ROOT))).toEqual(['A', 'Y', 'X'])
  })

  test('два конкурента на одном lead в одну секунду: арбитр — меньший peer', () => {
    const base = sand('a', ROOT, 'A', { time: 1 })
    const fromP1 = sand('x', 'a', 'X', { time: 2, peer: 'p1' })
    const fromP2 = sand('y', 'a', 'Y', { time: 2, peer: 'p2' })

    expect(values(order([base, fromP2, fromP1], ROOT))).toEqual(['A', 'X', 'Y'])
    expect(values(order([base, fromP1, fromP2], ROOT))).toEqual(['A', 'X', 'Y'])
  })

  test('надгробие в середине цепочки не рвёт её', () => {
    const a = sand('a', ROOT, 'A')
    const b = sand('b', 'a', 'B')
    const c = sand('c', 'b', 'C')
    const grave = sand('b', 'a', null, { time: 5 })

    expect(values(order([a, b, c, grave], ROOT))).toEqual(['A', 'C'])
  })

  test('потомок удалённого узла по lead остаётся видимым', () => {
    const a = sand('a', ROOT, 'A')
    const grave = sand('b', 'a', null, { time: 5 })
    const d = sand('d', 'b', 'D', { time: 7 })

    expect(values(order([a, grave, d], ROOT))).toEqual(['A', 'D'])
  })

  test('потомок удалённого узла по head остаётся видимым', () => {
    const grave = sand('b', ROOT, null, { time: 5 })
    const d = sand('d', ROOT, 'D', { head: 'b' })

    expect(values(order([grave, d], ROOT))).toEqual([])
    expect(values(order([grave, d], 'b'))).toEqual(['D'])
  })

  test('несколько уровней вложенности через head читаются независимо', () => {
    const root1 = sand('r1', ROOT, 'R1')
    const root2 = sand('r2', 'r1', 'R2')

    const kid1 = sand('k1', ROOT, 'K1', { head: 'r1' })
    const kid2 = sand('k2', 'k1', 'K2', { head: 'r1' })

    const deep = sand('d1', ROOT, 'D1', { head: 'k2' })

    const all = [deep, kid2, root2, kid1, root1]

    expect(values(order(all, ROOT))).toEqual(['R1', 'R2'])
    expect(values(order(all, 'r1'))).toEqual(['K1', 'K2'])
    expect(values(order(all, 'k2'))).toEqual(['D1'])
    expect(values(order(all, 'r2'))).toEqual([])
  })

  test('юнит с недоехавшим lead виден в хвосте, а не теряется', () => {
    const orphan = sand('b', 'a', 'B')
    expect(values(order([orphan], ROOT))).toEqual(['B'])

    const a = sand('a', ROOT, 'A')
    expect(values(order([orphan, a], ROOT))).toEqual(['A', 'B'])
  })
})

/**
 * Эквивалентность референсу на руками собранных случаях.
 *
 * Каждый случай проверяется трижды: побайтово против `orderNaive`, на всех
 * перестановках входа и — там, где это осмысленно — на сохранности набора.
 * Случаи подобраны по местам, где раскладка списком имеет право разойтись с
 * обходом дерева: ветвление `lead`, надгробие как точка привязки, сироты,
 * ребёнок старше своего `lead`.
 */
describe('order ≡ orderNaive на собранных вручную случаях', () => {
  const same = (sands: readonly Sand[], head: string = ROOT): unknown[] => {
    const reference = orderNaive(sands, head)
    expect(order(sands, head)).toEqual(reference)
    return every(sands, head)
  }

  test('линейная цепочка', () => {
    const a = sand('a', ROOT, 'A', { time: 1 })
    const b = sand('b', 'a', 'B', { time: 2 })
    const c = sand('c', 'b', 'C', { time: 3 })

    expect(same([a, b, c])).toEqual(['A', 'B', 'C'])
  })

  test('вставки в начало ложатся от свежей к старой', () => {
    const first = sand('a', ROOT, 'A', { time: 1 })
    const second = sand('b', ROOT, 'B', { time: 2 })
    const third = sand('c', ROOT, 'C', { time: 3 })

    expect(same([first, second, third])).toEqual(['C', 'B', 'A'])
  })

  test('два блока за одним якорем не чередуются', () => {
    const anchor = sand('a', ROOT, 'A', { time: 1 })

    const left1 = sand('l1', 'a', 'L1', { time: 5, peer: 'p1' })
    const left2 = sand('l2', 'l1', 'L2', { time: 6, peer: 'p1' })
    const right1 = sand('r1', 'a', 'R1', { time: 5, peer: 'p2' })
    const right2 = sand('r2', 'r1', 'R2', { time: 6, peer: 'p2' })

    expect(same([anchor, left1, left2, right1, right2]))
      .toEqual(['A', 'L1', 'L2', 'R1', 'R2'])
  })

  test('ветвление lead: у одного узла двое детей', () => {
    // Тот самый случай из `move-past-branched-lead`: вставка `x` не трогает
    // связь `b1.lead = b0`, и у `b0` оказывается двое `lead`-детей.
    const b0 = sand('b0', ROOT, 'b0', { time: 1 })
    const b1 = sand('b1', 'b0', 'b1', { time: 2 })
    const x = sand('x', 'b0', 'x', { time: 3 })

    expect(same([b0, b1, x])).toEqual(['b0', 'x', 'b1'])
  })

  test('ребёнок старше своего lead: переехавший узел тащит поддерево за собой', () => {
    // `x` переехал (свежая метка), а его старый ребёнок `d` остался висеть на
    // нём. Раскладка обязана держать `d` в поддереве `x`, а не сравнивать его
    // с соседом `s` по плоскому списку.
    const moved = sand('x', ROOT, 'X', { time: 9 })
    const kid = sand('d', 'x', 'D', { time: 2 })
    const neighbour = sand('s', ROOT, 'S', { time: 5 })

    expect(same([moved, kid, neighbour])).toEqual(['X', 'D', 'S'])
  })

  test('надгробие держит и соседей по lead, и поддерево по head', () => {
    const grave = sand('b', ROOT, null, { time: 5 })
    const after = sand('c', 'b', 'C', { time: 6 })
    const inner = sand('i', ROOT, 'I', { head: 'b', time: 7 })

    expect(same([grave, after, inner])).toEqual(['C'])
    expect(same([grave, after, inner], 'b')).toEqual(['I'])
  })

  test('цепочка сирот: недоехал общий предок', () => {
    const o1 = sand('o1', 'нет', 'O1', { time: 3 })
    const o2 = sand('o2', 'o1', 'O2', { time: 4 })
    const live = sand('a', ROOT, 'A', { time: 9 })

    // Внутри хвоста сироты идут по LWW, а не по своей цепочке `lead`: `o2`
    // свежее, поэтому встаёт перед собственным `lead`. Так делает референс —
    // порт повторяет за ним. Оригинал разложил бы иначе (`o1`, `o2`): его
    // очередь разбирается от старого к молодому и хвост наращивается по одному,
    // так что цепочка сирот там склеивается обратно.
    expect(same([live, o1, o2])).toEqual(['A', 'O2', 'O1'])
  })

  test('сирота свежее живого списка всё равно уходит в хвост', () => {
    const live = sand('a', ROOT, 'A', { time: 1 })
    const orphan = sand('o', 'нет', 'O', { time: 9 })

    expect(same([live, orphan])).toEqual(['A', 'O'])
  })

  test('надгробие-сирота не выносит из чтения своё поддерево', () => {
    const grave = sand('g', 'нет', null, { time: 3 })
    const kid = sand('k', 'g', 'K', { time: 4 })

    expect(same([grave, kid])).toEqual(['K'])
  })

  test('юниты чужого head не участвуют в раскладке', () => {
    const mine = sand('a', ROOT, 'A', { time: 1 })
    const alien = sand('b', 'a', 'B', { head: 'иной', time: 2 })

    expect(same([mine, alien])).toEqual(['A'])
    expect(same([mine, alien], 'иной')).toEqual(['B'])
  })
})

/**
 * Кольца в цепочке `lead`. Внутри кольца «правильного» порядка не существует —
 * любой линейный порядок одинаково произволен, — поэтому от раскладки требуются
 * только два инварианта: ничего не потеряно и ответ не зависит от порядка
 * перебора входа. Совпадение с референсом здесь **не** требуется.
 */
describe('order на кольцах', () => {
  test('кольцо из двух узлов не теряет ни одного', () => {
    // `move` крест-накрест: 1 → 3 → 1.
    const one = sand('1', '3', 'ОДИН', { time: 9, peer: 'p1' })
    const two = sand('2', '1', 'ДВА', { time: 1 })
    const three = sand('3', '1', 'ТРИ', { time: 9, peer: 'p2' })
    const four = sand('4', '3', 'ЧЕТЫРЕ', { time: 1 })

    const read = every([one, two, three, four])
    expect([...read].sort()).toEqual(['ДВА', 'ОДИН', 'ТРИ', 'ЧЕТЫРЕ'])
  })

  test('узел, ссылающийся сам на себя, виден ровно один раз', () => {
    const loop = sand('a', 'a', 'A', { time: 1 })
    const live = sand('b', ROOT, 'B', { time: 2 })

    expect(every([loop, live])).toEqual(['B', 'A'])
  })

  test('кольцо уносит в хвост своё поддерево, но не живой список', () => {
    const live = sand('live', ROOT, 'ЖИВОЙ', { time: 1 })
    const ringA = sand('ra', 'rb', 'A', { time: 5, peer: 'p1' })
    const ringB = sand('rb', 'ra', 'B', { time: 5, peer: 'p2' })
    const hung = sand('h', 'ra', 'H', { time: 6 })

    const read = every([live, ringA, ringB, hung])
    expect(read[0]).toBe('ЖИВОЙ')
    expect([...read].sort()).toEqual(['A', 'B', 'H', 'ЖИВОЙ'].sort())
  })
})
