import { describe, expect, it } from 'vitest'
import { defineEntity, defineInfiniteQuery, defineMutation, defineQuery } from '../define'
import { Kind } from '../core/flags'
import { memoryStore } from '../adapters/memoryStore'

describe('defineEntity', () => {
  it('returns a frozen entity def', () => {
    const e = defineEntity<{ id: string }>({ name: 'user', id: (u) => u.id })
    expect(e.kind).toBe(Kind.Entity)
    expect(e.name).toBe('user')
    expect(e.id({ id: 'x' })).toBe('x')
    expect(e.storage).toBeUndefined()
    expect(Object.isFrozen(e)).toBe(true)
  })

  it('attaches an instantiated storage from the factory', () => {
    const e = defineEntity<{ id: string }>({
      name: 'user',
      id: (u) => u.id,
      storage: memoryStore<{ id: string }>(),
    })
    expect(e.storage).toBeDefined()
    expect(typeof e.storage!.read).toBe('function')
  })
})

describe('defineQuery', () => {
  it('frozen and tagged as Query, exec invokes fetch+normalize', async () => {
    const q = defineQuery<{ x: number }, { y: number }, { y: number }>({
      name: 'q.x',
      key: (a) => ['q', a.x],
      fetch: async (a) => ({ y: a.x + 1 }),
      normalize: (resp) => ({ result: resp }),
    })
    expect(q.kind).toBe(Kind.Query)
    expect(Object.isFrozen(q)).toBe(true)
    const ctrl = new AbortController()
    const r = await q.exec!({ x: 1 }, { signal: ctrl.signal, pageParam: undefined })
    expect(r).toEqual({ pageResult: { y: 2 }, entities: null })
  })

  it('exec without normalize wraps response as pageResult', async () => {
    const q = defineQuery<undefined, number>({
      name: 'q.bare',
      key: () => ['q', 'bare'],
      fetch: async () => 42,
    })
    const r = await q.exec!(undefined, { signal: new AbortController().signal, pageParam: undefined })
    expect(r).toEqual({ pageResult: 42, entities: null })
  })

  it('precomputes staticHash when key takes zero args', () => {
    const q = defineQuery<undefined, number>({
      name: 'q.static',
      key: () => ['static'],
      fetch: async () => 1,
    })
    expect(q.staticHash).toBe('["static"]')
  })

  it('staticHash is null when key takes args', () => {
    const q = defineQuery<{ x: number }, number>({
      name: 'q.dyn',
      key: (a) => ['dyn', a.x],
      fetch: async () => 1,
    })
    expect(q.staticHash).toBeNull()
  })

  it('staticHash is null when a zero-arg key throws', () => {
    const q = defineQuery<undefined, number>({
      name: 'q.throws',
      key: () => {
        throw new Error('boom')
      },
      fetch: async () => 1,
    })
    expect(q.staticHash).toBeNull()
  })
})

describe('defineInfiniteQuery', () => {
  it('exec uses initialPageParam when ctx.pageParam is undefined', async () => {
    const q = defineInfiniteQuery<undefined, { v: number }, number, { v: number }>({
      name: 'q.inf',
      key: () => ['inf'],
      initialPageParam: 7,
      getNextPageParam: () => null,
      fetch: async (_a, ctx) => ({ v: ctx.pageParam }),
      normalize: (r) => ({ result: r }),
    })
    const r = await q.exec!(undefined, { signal: new AbortController().signal, pageParam: 7 })
    expect(r.pageResult).toEqual({ v: 7 })
  })

  it('exec without normalize returns raw response', async () => {
    const q = defineInfiniteQuery<undefined, { v: number }, number, { v: number }>({
      name: 'q.inf.bare',
      key: () => ['inf-bare'],
      initialPageParam: 0,
      getNextPageParam: () => null,
      fetch: async () => ({ v: 1 }),
    })
    const r = await q.exec!(undefined, { signal: new AbortController().signal, pageParam: 0 })
    expect(r).toEqual({ pageResult: { v: 1 }, entities: null })
  })
})

describe('defineMutation', () => {
  it('frozen mutation has expected shape', () => {
    const m = defineMutation<number, number>({
      name: 'm.inc',
      fetch: async (n) => n + 1,
    })
    expect(m.kind).toBe(Kind.Mutation)
    expect(Object.isFrozen(m)).toBe(true)
  })
})
