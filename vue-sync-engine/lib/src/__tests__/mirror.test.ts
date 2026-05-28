import { describe, expect, it } from 'vitest'
import { effectScope, nextTick, watchEffect } from 'vue'
import { createMirror } from '../tab/mirror'
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

  it('triggers reactivity for all touched types', async () => {
    const m = createMirror()
    const seen = { user: 0, post: 0, tag: 0 }
    const scope = effectScope()
    scope.run(() => {
      watchEffect(() => {
        m.getEntity('user', 'noop')
        seen.user++
      })
      watchEffect(() => {
        m.getEntity('post', 'noop')
        seen.post++
      })
      watchEffect(() => {
        m.getEntity('tag', 'noop')
        seen.tag++
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

    expect(seen.user).toBeGreaterThan(before.user)
    expect(seen.post).toBeGreaterThan(before.post)
    expect(seen.tag).toBeGreaterThan(before.tag)
    scope.stop()
  })

  it('applyEntityPatches([]) is a no-op', () => {
    const m = createMirror()
    expect(() => m.applyEntityPatches([])).not.toThrow()
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
