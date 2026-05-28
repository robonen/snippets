import { describe, expect, it } from 'vitest'
import { hashKey } from '../core/queryKey'
import { applyPatch, invertEntityPatch } from '../core/patches'
import { Op } from '../core/flags'

describe('queryKey.hashKey', () => {
  it('produces stable hash regardless of key order', () => {
    const a = hashKey(['users', { search: 'x', page: 1 }])
    const b = hashKey(['users', { page: 1, search: 'x' }])
    expect(a).toBe(b)
  })

  it('different args produce different hashes', () => {
    expect(hashKey(['u', 1])).not.toBe(hashKey(['u', 2]))
  })
})

describe('patches', () => {
  it('set at root', () => {
    expect(applyPatch({ a: 1 }, { op: Op.Set, path: [], value: { b: 2 } })).toEqual({ b: 2 })
  })

  it('merge does not mutate input', () => {
    const input = { a: 1, b: 2 }
    const out = applyPatch(input, { op: Op.Merge, path: [], value: { b: 9 } })
    expect(out).toEqual({ a: 1, b: 9 })
    expect(input).toEqual({ a: 1, b: 2 })
  })

  it('delete removes nested key', () => {
    const out = applyPatch({ a: { b: 1, c: 2 } }, { op: Op.Delete, path: ['a', 'b'] })
    expect(out).toEqual({ a: { c: 2 } })
  })

  it('inverts a set on undefined prev as delete', () => {
    const inv = invertEntityPatch(undefined, { op: Op.Set, path: [], value: { x: 1 } })
    expect(inv).toEqual({ op: Op.Delete, path: [] })
  })

  it('inverts a merge to previous slice', () => {
    const prev = { a: 1, b: 2 }
    const inv = invertEntityPatch(prev, { op: Op.Merge, path: [], value: { b: 9 } })
    expect(inv).toEqual({ op: Op.Merge, path: [], value: { b: 2 } })
    expect(applyPatch(applyPatch(prev, { op: Op.Merge, path: [], value: { b: 9 } }), inv)).toEqual(prev)
  })
})
