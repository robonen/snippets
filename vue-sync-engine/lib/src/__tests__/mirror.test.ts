import { describe, expect, it } from 'vitest'
import { effectScope, nextTick, watchEffect } from 'vue'
import { createMirror } from '../tab/mirror'
import { entityKey } from '../core/queryKey'
import { Op, Status } from '../core/flags'

describe('mirror.applyEntityPatches', () => {
  it('sets, merges, and deletes entities', () => {
    const m = createMirror()
    m.applyEntityPatches([
      { type: 'user', id: '1', patch: { op: Op.Set, path: [], value: { id: '1', name: 'A', age: 10 } } },
    ])
    expect(m.getEntity('user', '1')).toEqual({ id: '1', name: 'A', age: 10 })

    m.applyEntityPatches([
      { type: 'user', id: '1', patch: { op: Op.Merge, path: [], value: { age: 11 } } },
    ])
    expect(m.getEntity<{ age: number }>('user', '1')?.age).toBe(11)

    m.applyEntityPatches([{ type: 'user', id: '1', patch: { op: Op.Delete, path: [] } }])
    expect(m.getEntity('user', '1')).toBeUndefined()
  })

  it('triggers reactivity for every touched entity in a batch', async () => {
    const m = createMirror()
    const seen = { u1: 0, p1: 0, t1: 0 }
    const scope = effectScope()
    scope.run(() => {
      watchEffect(() => {
        m.getEntity('user', '1')
        seen.u1++
      })
      watchEffect(() => {
        m.getEntity('post', 'p1')
        seen.p1++
      })
      watchEffect(() => {
        m.getEntity('tag', 't1')
        seen.t1++
      })
    })
    await nextTick()
    const before = { ...seen }

    m.applyEntityPatches([
      { type: 'user', id: '1', patch: { op: Op.Set, path: [], value: 1 } },
      { type: 'post', id: 'p1', patch: { op: Op.Set, path: [], value: 1 } },
      { type: 'user', id: '2', patch: { op: Op.Set, path: [], value: 2 } },
      { type: 'tag', id: 't1', patch: { op: Op.Set, path: [], value: 1 } },
    ])
    await nextTick()

    expect(seen.u1).toBeGreaterThan(before.u1)
    expect(seen.p1).toBeGreaterThan(before.p1)
    expect(seen.t1).toBeGreaterThan(before.t1)
    scope.stop()
  })

  it('does NOT re-run readers of unaffected sibling entities (fine-grained)', async () => {
    const m = createMirror()
    let reads1 = 0
    let reads2 = 0
    const scope = effectScope()
    scope.run(() => {
      watchEffect(() => {
        m.getEntity('user', '1')
        reads1++
      })
      watchEffect(() => {
        m.getEntity('user', '2')
        reads2++
      })
    })
    await nextTick()
    const before2 = reads2

    // Mutating user/1 must not invalidate the reader of user/2.
    m.applyEntityPatches([{ type: 'user', id: '1', patch: { op: Op.Set, path: [], value: { v: 1 } } }])
    await nextTick()

    expect(reads1).toBeGreaterThan(0)
    expect(reads2).toBe(before2)
    scope.stop()
  })

  it('triggers a reader that initially saw undefined when its entity is created', async () => {
    const m = createMirror()
    let value: unknown
    let runs = 0
    const scope = effectScope()
    scope.run(() => {
      watchEffect(() => {
        value = m.getEntity('user', 'late')
        runs++
      })
    })
    await nextTick()
    expect(value).toBeUndefined()
    const before = runs

    m.applyEntityPatches([{ type: 'user', id: 'late', patch: { op: Op.Set, path: [], value: { id: 'late' } } }])
    await nextTick()

    expect(runs).toBeGreaterThan(before)
    expect(value).toEqual({ id: 'late' })
    scope.stop()
  })

  it('applyEntityPatches([]) is a no-op', () => {
    const m = createMirror()
    expect(() => m.applyEntityPatches([])).not.toThrow()
  })

  it('prunes the version ref when an entity is deleted', () => {
    const m = createMirror()
    // A read creates the per-entity version ref.
    m.getEntity('user', '1')
    m.applyEntityPatches([{ type: 'user', id: '1', patch: { op: Op.Set, path: [], value: { id: '1' } } }])
    expect(m.versions.has(entityKey('user', '1'))).toBe(true)

    m.applyEntityPatches([{ type: 'user', id: '1', patch: { op: Op.Delete, path: [] } }])
    expect(m.versions.has(entityKey('user', '1'))).toBe(false)
  })

  it('does not create version refs for entities that are written but never read', () => {
    const m = createMirror()
    m.applyEntityPatches([{ type: 'user', id: '99', patch: { op: Op.Set, path: [], value: { id: '99' } } }])
    expect(m.versions.has(entityKey('user', '99'))).toBe(false)
    expect(m.getEntity('user', '99')).toEqual({ id: '99' })
  })

  it('stays reactive after a delete prunes and the entity is re-created', async () => {
    const m = createMirror()
    let value: unknown
    let runs = 0
    const scope = effectScope()
    scope.run(() => {
      watchEffect(() => {
        value = m.getEntity('user', '1')
        runs++
      })
    })
    await nextTick()

    m.applyEntityPatches([{ type: 'user', id: '1', patch: { op: Op.Set, path: [], value: { v: 1 } } }])
    await nextTick()
    expect(value).toEqual({ v: 1 })

    m.applyEntityPatches([{ type: 'user', id: '1', patch: { op: Op.Delete, path: [] } }])
    await nextTick()
    expect(value).toBeUndefined() // reader re-ran and re-created its ref

    const after = runs
    m.applyEntityPatches([{ type: 'user', id: '1', patch: { op: Op.Set, path: [], value: { v: 2 } } }])
    await nextTick()
    expect(runs).toBeGreaterThan(after) // still reactive on the re-created entity
    expect(value).toEqual({ v: 2 })
    scope.stop()
  })

  it('handles non-root delete by merging the path', () => {
    const m = createMirror()
    m.applyEntityPatches([
      { type: 't', id: '1', patch: { op: Op.Set, path: [], value: { a: 1, b: 2 } } },
    ])
    m.applyEntityPatches([{ type: 't', id: '1', patch: { op: Op.Delete, path: ['a'] } }])
    expect(m.getEntity<{ a?: number; b: number }>('t', '1')).toEqual({ a: undefined, b: 2 })
  })
})

describe('mirror.query state', () => {
  it('ensureQuery returns the same ref for the same subId', () => {
    const m = createMirror()
    const r1 = m.ensureQuery('s1')
    const r2 = m.ensureQuery('s1')
    expect(r1).toBe(r2)
    expect(r1.value.status).toBe(Status.Idle)
  })

  it('applies status and data patches', () => {
    const m = createMirror()
    m.applyQueryPatch('s1', Status.Pending)
    expect(m.ensureQuery('s1').value.status).toBe(Status.Pending)

    m.applyQueryPatch('s1', Status.Success, { op: Op.Set, path: [], value: { ok: true } })
    expect(m.ensureQuery<{ ok: boolean }>('s1').value.data).toEqual({ ok: true })

    m.applyQueryPatch('s1', Status.Error, undefined, { message: 'boom' })
    const v = m.ensureQuery<{ ok: boolean }>('s1').value
    expect(v.status).toBe(Status.Error)
    expect(v.error).toEqual({ message: 'boom' })
    expect(v.data).toEqual({ ok: true }) // data is preserved when patch is absent
  })

  it('dropQuery removes the stored ref', () => {
    const m = createMirror()
    const r = m.ensureQuery('s1')
    m.applyQueryPatch('s1', Status.Success)
    expect(r.value.status).toBe(Status.Success)
    m.dropQuery('s1')
    const r2 = m.ensureQuery('s1')
    expect(r2).not.toBe(r)
    expect(r2.value.status).toBe(Status.Idle)
  })
})

describe('mirror LRU cap', () => {
  const set = (id: string, value: unknown = { id }) => ({
    type: 'user',
    id,
    patch: { op: Op.Set, path: [] as never[], value },
  })

  it('evicts the least-recently-used entity when over cap', () => {
    const m = createMirror({ entityCap: 2 })
    m.applyEntityPatches([set('1')])
    m.applyEntityPatches([set('2')])
    m.applyEntityPatches([set('3')]) // overflow -> evict oldest ('1')

    expect(m.getEntity('user', '1')).toBeUndefined()
    expect(m.getEntity('user', '2')).toEqual({ id: '2' })
    expect(m.getEntity('user', '3')).toEqual({ id: '3' })
  })

  it('a read marks an entity recently-used so it survives eviction', () => {
    const m = createMirror({ entityCap: 2 })
    m.applyEntityPatches([set('1')])
    m.applyEntityPatches([set('2')])
    m.getEntity('user', '1') // touch '1' -> now '2' is the LRU
    m.applyEntityPatches([set('3')]) // evicts '2'

    expect(m.getEntity('user', '1')).toEqual({ id: '1' })
    expect(m.getEntity('user', '2')).toBeUndefined()
    expect(m.getEntity('user', '3')).toEqual({ id: '3' })
  })

  it('a write marks an entity recently-used so it survives eviction', () => {
    const m = createMirror({ entityCap: 2 })
    m.applyEntityPatches([set('1')])
    m.applyEntityPatches([set('2')])
    m.applyEntityPatches([set('1', { id: '1', v: 2 })]) // touch '1' -> '2' is LRU
    m.applyEntityPatches([set('3')]) // evicts '2'

    expect(m.getEntity('user', '1')).toEqual({ id: '1', v: 2 })
    expect(m.getEntity('user', '2')).toBeUndefined()
    expect(m.getEntity('user', '3')).toEqual({ id: '3' })
  })

  it('caps each type independently', () => {
    const m = createMirror({ entityCap: 2 })
    m.applyEntityPatches([
      { type: 'user', id: 'u1', patch: { op: Op.Set, path: [], value: 1 } },
      { type: 'user', id: 'u2', patch: { op: Op.Set, path: [], value: 1 } },
      { type: 'user', id: 'u3', patch: { op: Op.Set, path: [], value: 1 } },
      { type: 'post', id: 'p1', patch: { op: Op.Set, path: [], value: 1 } },
      { type: 'post', id: 'p2', patch: { op: Op.Set, path: [], value: 1 } },
    ])
    expect(m.entities.get('user')!.size).toBe(2)
    expect(m.entities.get('post')!.size).toBe(2)
    expect(m.getEntity('user', 'u1')).toBeUndefined() // oldest user evicted
    expect(m.getEntity('post', 'p1')).toBe(1) // posts within cap
  })

  it('cap of 0 (default) never evicts', () => {
    const m = createMirror()
    for (let i = 0; i < 100; i++) m.applyEntityPatches([set(String(i))])
    expect(m.entities.get('user')!.size).toBe(100)
  })

  it('eviction prunes the version ref of an unobserved entity', () => {
    const m = createMirror({ entityCap: 1 })
    m.getEntity('user', '1') // create the version ref (no persistent reader)
    m.applyEntityPatches([set('1')])
    expect(m.versions.has(entityKey('user', '1'))).toBe(true)

    m.applyEntityPatches([set('2')]) // evicts '1' and prunes its ref (nothing re-reads it)
    expect(m.versions.has(entityKey('user', '1'))).toBe(false)
    expect(m.entities.get('user')!.has('1')).toBe(false)
  })

  it('eviction re-runs a stale reader (reactivity preserved)', async () => {
    const m = createMirror({ entityCap: 1 })
    let value: unknown
    const scope = effectScope()
    scope.run(() => {
      watchEffect(() => {
        value = m.getEntity('user', '1')
      })
    })
    m.applyEntityPatches([set('1')])
    await nextTick()
    expect(value).toEqual({ id: '1' })

    m.applyEntityPatches([set('2')]) // evicts '1'
    await nextTick()
    expect(value).toBeUndefined() // reader re-ran on eviction
    scope.stop()
  })
})
