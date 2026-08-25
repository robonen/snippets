import { describe, expect, test } from 'vitest'
import { orderNaive, resolveNaive } from '../order-naive'
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

describe('orderNaive', () => {
  test('an empty set reads as an empty list', () => {
    expect(orderNaive([], ROOT)).toEqual([])
  })

  test('a single element', () => {
    const a = sand('a', ROOT, 'A')
    expect(values(orderNaive([a], ROOT))).toEqual(['A'])
  })

  test('a lead chain lays out in order', () => {
    const a = sand('a', ROOT, 'A')
    const b = sand('b', 'a', 'B')
    const c = sand('c', 'b', 'C')

    expect(values(orderNaive([a, b, c], ROOT))).toEqual(['A', 'B', 'C'])
  })

  test('input array order does not affect the result', () => {
    const a = sand('a', ROOT, 'A')
    const b = sand('b', 'a', 'B')
    const c = sand('c', 'b', 'C')

    const expected = ['A', 'B', 'C']
    expect(values(orderNaive([c, b, a], ROOT))).toEqual(expected)
    expect(values(orderNaive([b, c, a], ROOT))).toEqual(expected)
    expect(values(orderNaive([a, c, b], ROOT))).toEqual(expected)
  })

  test('two competitors on one lead: the fresher one goes first', () => {
    const base = sand('a', ROOT, 'A', { time: 1 })
    const older = sand('x', 'a', 'X', { time: 2, peer: 'p1' })
    const newer = sand('y', 'a', 'Y', { time: 3, peer: 'p1' })

    expect(values(orderNaive([base, older, newer], ROOT))).toEqual(['A', 'Y', 'X'])
  })

  test('two competitors on one lead in the same second: the smaller peer is the tiebreaker', () => {
    const base = sand('a', ROOT, 'A', { time: 1 })
    const fromP1 = sand('x', 'a', 'X', { time: 2, peer: 'p1' })
    const fromP2 = sand('y', 'a', 'Y', { time: 2, peer: 'p2' })

    expect(values(orderNaive([base, fromP2, fromP1], ROOT))).toEqual(['A', 'X', 'Y'])
    expect(values(orderNaive([base, fromP1, fromP2], ROOT))).toEqual(['A', 'X', 'Y'])
  })

  test('a tombstone in the middle of a chain does not break it', () => {
    const a = sand('a', ROOT, 'A')
    const b = sand('b', 'a', 'B')
    const c = sand('c', 'b', 'C')
    const grave = sand('b', 'a', null, { time: 5 })

    expect(values(orderNaive([a, b, c, grave], ROOT))).toEqual(['A', 'C'])
  })

  test('a descendant of a removed node via lead stays visible', () => {
    // Вставка «за b» доехала после удаления b: узел-надгробие обязан остаться
    // точкой привязки, иначе живой d исчезнет вместе с мёртвым b.
    const a = sand('a', ROOT, 'A')
    const grave = sand('b', 'a', null, { time: 5 })
    const d = sand('d', 'b', 'D', { time: 7 })

    expect(values(orderNaive([a, grave, d], ROOT))).toEqual(['A', 'D'])
  })

  test('a descendant of a removed node via head stays visible', () => {
    // Здесь d — не сосед, а ребёнок b по вертикали: чтение поддерева мёртвого
    // узла не должно зависеть от того, жив ли сам узел.
    const grave = sand('b', ROOT, null, { time: 5 })
    const d = sand('d', ROOT, 'D', { head: 'b' })

    expect(values(orderNaive([grave, d], ROOT))).toEqual([])
    expect(values(orderNaive([grave, d], 'b'))).toEqual(['D'])
  })

  test('several nesting levels via head read independently', () => {
    const root1 = sand('r1', ROOT, 'R1')
    const root2 = sand('r2', 'r1', 'R2')

    const kid1 = sand('k1', ROOT, 'K1', { head: 'r1' })
    const kid2 = sand('k2', 'k1', 'K2', { head: 'r1' })

    const deep = sand('d1', ROOT, 'D1', { head: 'k2' })

    const all = [deep, kid2, root2, kid1, root1]

    expect(values(orderNaive(all, ROOT))).toEqual(['R1', 'R2'])
    expect(values(orderNaive(all, 'r1'))).toEqual(['K1', 'K2'])
    expect(values(orderNaive(all, 'k2'))).toEqual(['D1'])
    expect(values(orderNaive(all, 'r2'))).toEqual([])
  })

  test('a unit whose lead has not arrived shows in the tail instead of being lost', () => {
    // Недостижимое от корня дописывается в хвост, а не выпадает: причинность
    // восстановится с доставкой юнита `a`, но потери нет ни на одном шаге.
    // Так же поступает `sand_ordered` в baza — там очередь разбирается до конца.
    const orphan = sand('b', 'a', 'B')
    expect(values(orderNaive([orphan], ROOT))).toEqual(['B'])

    const a = sand('a', ROOT, 'A')
    expect(values(orderNaive([orphan, a], ROOT))).toEqual(['A', 'B'])
  })
})

describe('resolveNaive', () => {
  test('folding by self does not depend on traversal order', () => {
    const old = sand('a', ROOT, 'старое', { time: 1 })
    const fresh = sand('a', ROOT, 'новое', { time: 9 })

    expect(resolveNaive([old, fresh], ROOT).get('a')).toBe(fresh)
    expect(resolveNaive([fresh, old], ROOT).get('a')).toBe(fresh)
  })

  test('units of a foreign head do not enter the fold', () => {
    const mine = sand('a', ROOT, 'моё')
    const alien = sand('a', ROOT, 'чужое', { head: 'other', time: 9 })

    expect(resolveNaive([mine, alien], ROOT).get('a')).toBe(mine)
    expect(resolveNaive([mine, alien], 'other').get('a')).toBe(alien)
  })
})
