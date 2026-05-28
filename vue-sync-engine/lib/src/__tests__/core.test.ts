import { describe, expect, it } from 'vitest'
import { entityKey, hashKey } from '../core/queryKey'
import { applyPatch, invertEntityPatch } from '../core/patches'
import { Op } from '../core/flags'

const NUL = String.fromCharCode(0)

describe('queryKey.hashKey', () => {
  it('produces stable hash regardless of key order', () => {
    const a = hashKey(['users', { search: 'x', page: 1 }])
    const b = hashKey(['users', { page: 1, search: 'x' }])
    expect(a).toBe(b)
  })

  it('different args produce different hashes', () => {
    expect(hashKey(['u', 1])).not.toBe(hashKey(['u', 2]))
  })

  it('serializes primitives correctly', () => {
    expect(hashKey(['s'])).toBe('["s"]')
    expect(hashKey([null])).toBe('[null]')
    expect(hashKey([undefined])).toBe('[null]')
    expect(hashKey([true, false])).toBe('[true,false]')
    expect(hashKey([0, 1.5, -3])).toBe('[0,1.5,-3]')
  })

  it('serializes NaN and Infinity as null', () => {
    expect(hashKey([NaN])).toBe('[null]')
    expect(hashKey([Infinity])).toBe('[null]')
    expect(hashKey([-Infinity])).toBe('[null]')
  })

  it('serializes nested arrays and objects', () => {
    expect(hashKey([['a', 'b'], { x: [1, 2] }])).toBe('[["a","b"],{"x":[1,2]}]')
  })

  it('treats nested objects with permuted keys identically', () => {
    expect(hashKey([{ a: { b: 1, c: 2 } }])).toBe(hashKey([{ a: { c: 2, b: 1 } }]))
  })

  it('falls back to null for symbols/functions', () => {
    expect(hashKey([Symbol('x') as unknown as string])).toBe('[null]')
    expect(hashKey([(() => 1) as unknown as string])).toBe('[null]')
  })

  it('empty key returns []', () => {
    expect(hashKey([])).toBe('[]')
  })
})

describe('queryKey.entityKey', () => {
  it('joins type and string id with NUL separator', () => {
    expect(entityKey('user', '7')).toBe('user' + NUL + '7')
  })
  it('joins type and numeric id', () => {
    expect(entityKey('post', 42)).toBe('post' + NUL + '42')
  })
  it('different types with same id are distinct', () => {
    expect(entityKey('a', '1')).not.toBe(entityKey('b', '1'))
  })
})

describe('patches.applyPatch — root', () => {
  it('set at root replaces value', () => {
    expect(applyPatch({ a: 1 }, { op: Op.Set, path: [], value: { b: 2 } })).toEqual({ b: 2 })
  })

  it('merge at root does not mutate input', () => {
    const input = { a: 1, b: 2 }
    const out = applyPatch(input, { op: Op.Merge, path: [], value: { b: 9 } })
    expect(out).toEqual({ a: 1, b: 9 })
    expect(input).toEqual({ a: 1, b: 2 })
  })

  it('delete at root returns undefined', () => {
    expect(applyPatch({ a: 1 }, { op: Op.Delete, path: [] })).toBeUndefined()
  })
})

describe('patches.applyPatch — nested', () => {
  it('set at nested path', () => {
    const out = applyPatch({ a: { b: 1 } }, { op: Op.Set, path: ['a', 'b'], value: 9 })
    expect(out).toEqual({ a: { b: 9 } })
  })

  it('merge at nested path', () => {
    const out = applyPatch(
      { a: { b: 1, c: 2 } },
      { op: Op.Merge, path: ['a'], value: { c: 9 } },
    )
    expect(out).toEqual({ a: { b: 1, c: 9 } })
  })

  it('merge at nested path when previous is undefined creates the slice', () => {
    const out = applyPatch({} as Record<string, unknown>, {
      op: Op.Merge,
      path: ['missing'],
      value: { x: 1 },
    })
    expect(out).toEqual({ missing: { x: 1 } })
  })

  it('preserves arrays at intermediate paths and does not mutate input', () => {
    const input = { a: [{ x: 1 }, { x: 2 }] }
    const out = applyPatch(input, { op: Op.Set, path: ['a', 1, 'x'], value: 9 })
    expect(out).toEqual({ a: [{ x: 1 }, { x: 9 }] })
    expect(input).toEqual({ a: [{ x: 1 }, { x: 2 }] })
  })

  it('does not mutate deeply nested arrays', () => {
    const input = { a: { b: [1, 2, 3] } }
    const out = applyPatch(input, { op: Op.Set, path: ['a', 'b', 1], value: 99 })
    expect(input.a.b).toEqual([1, 2, 3])
    expect(out).toEqual({ a: { b: [1, 99, 3] } })
  })
})

describe('patches.invertEntityPatch', () => {
  it('inverts a set on undefined prev as delete', () => {
    const inv = invertEntityPatch(undefined, { op: Op.Set, path: [], value: { x: 1 } })
    expect(inv).toEqual({ op: Op.Delete, path: [] })
  })

  it('inverts a set on existing prev as set with old value at the same path', () => {
    const inv = invertEntityPatch({ a: { b: 1 } }, { op: Op.Set, path: ['a', 'b'], value: 9 })
    expect(inv).toEqual({ op: Op.Set, path: ['a', 'b'], value: 1 })
  })

  it('inverts a delete as set with previous value', () => {
    const inv = invertEntityPatch({ x: 7 }, { op: Op.Delete, path: ['x'] })
    expect(inv).toEqual({ op: Op.Set, path: ['x'], value: 7 })
  })

  it('inverts a delete on undefined prev as set undefined', () => {
    const inv = invertEntityPatch(undefined, { op: Op.Delete, path: ['x'] })
    expect(inv).toEqual({ op: Op.Set, path: ['x'], value: undefined })
  })

  it('inverts a merge to previous slice and round-trips', () => {
    const prev = { a: 1, b: 2 }
    const inv = invertEntityPatch(prev, { op: Op.Merge, path: [], value: { b: 9 } })
    expect(inv).toEqual({ op: Op.Merge, path: [], value: { b: 2 } })
    expect(
      applyPatch(applyPatch(prev, { op: Op.Merge, path: [], value: { b: 9 } }), inv),
    ).toEqual(prev)
  })

  it('merges with undefined prev produce undefined slice for each key', () => {
    const inv = invertEntityPatch(undefined, { op: Op.Merge, path: [], value: { x: 1, y: 2 } })
    expect(inv).toEqual({ op: Op.Merge, path: [], value: { x: undefined, y: undefined } })
  })

  it('merge inverse traverses path safely when prev branch is null', () => {
    const inv = invertEntityPatch(
      { a: null } as unknown as Record<string, unknown>,
      { op: Op.Merge, path: ['a', 'b'], value: { x: 1 } },
    )
    expect(inv).toEqual({ op: Op.Merge, path: ['a', 'b'], value: { x: undefined } })
  })
})
