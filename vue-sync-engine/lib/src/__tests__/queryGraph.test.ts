import { describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { createInlineTransport } from '../transport/InlineTransport'
import { createMirror } from '../tab/mirror'
import { createTabRuntime } from '../tab/runtime'
import { createQueryGraph, type AnyQueryDef } from '../worker/queryGraph'
import { memoryAdapter } from '../adapters/storageAdapter'
import { memoryStore } from '../adapters/memoryStore'
import { defineEntity, defineMutation, defineQuery } from '../define'
import { Status } from '../core/flags'
import { flush, makeUserDefs, UserEntity, type User, type ListUsersResp } from './fixtures'

function bootstrap(opts: {
  api: { list: any; update: any }
  isOnline?: () => boolean
  onOnline?: (cb: () => void) => () => void
  defaultStaleTime?: number
  defaultGcTime?: number
  entities?: any[]
  extraMutations?: any[]
}) {
  const defs = makeUserDefs(opts.api)
  const storage = memoryAdapter()
  const { client, server } = createInlineTransport()
  createQueryGraph({
    storage,
    endpoint: server,
    registry: {
      entities: new Map((opts.entities ?? [UserEntity]).map((e) => [e.name, e])),
      queries: new Map<string, AnyQueryDef>([
        [defs.usersList.name, defs.usersList],
        [defs.usersInfinite.name, defs.usersInfinite],
      ]),
      mutations: new Map([
        [defs.updateUser.name, defs.updateUser],
        ...(opts.extraMutations ?? []).map((m: any) => [m.name, m] as [string, any]),
      ]),
    },
    isOnline: opts.isOnline,
    onOnline: opts.onOnline,
    defaultStaleTime: opts.defaultStaleTime,
    defaultGcTime: opts.defaultGcTime,
  })
  const mirror = createMirror()
  const runtime = createTabRuntime({ transport: client, mirror, staleSubGcMs: 5 })
  return { runtime, defs, storage }
}

describe('queryGraph — cache hit', () => {
  it('second subscription with the same key reuses cache and does not refetch', async () => {
    const list = vi.fn(async (): Promise<ListUsersResp> => ({
      items: [{ id: '1', name: 'A', age: 1 }],
      nextCursor: null,
    }))
    const { runtime, defs } = bootstrap({ api: { list, update: vi.fn() }, defaultStaleTime: 60_000 })

    const scope = effectScope()
    scope.run(() => runtime.subscribeQuery(defs.usersList.name, defs.usersList.key({}), {}))
    await flush()
    await flush()
    expect(list).toHaveBeenCalledTimes(1)
    scope.stop()

    // Wait for the staleSubGc tick to remove the tab-side sub but keep worker cache
    await new Promise((r) => setTimeout(r, 30))

    const scope2 = effectScope()
    let h2!: ReturnType<typeof runtime.subscribeQuery>
    scope2.run(() => {
      h2 = runtime.subscribeQuery(defs.usersList.name, defs.usersList.key({}), {})
    })
    await flush()
    await flush()
    const state = runtime.mirror.ensureQuery<{ ids: string[] }>(h2.subId)
    expect(state.value.data).toEqual({ ids: ['1'] })
    // Fresh: should still be one call.
    expect(list).toHaveBeenCalledTimes(1)
    scope2.stop()
  })
})

describe('queryGraph — error path', () => {
  it('broadcasts Error status and a message', async () => {
    const list = vi.fn(async () => {
      throw new Error('xx')
    })
    const { runtime, defs } = bootstrap({ api: { list, update: vi.fn() } })
    const scope = effectScope()
    let h1!: ReturnType<typeof runtime.subscribeQuery>
    scope.run(() => {
      h1 = runtime.subscribeQuery(defs.usersList.name, defs.usersList.key({}), {})
    })
    await flush()
    await flush()
    const state = runtime.mirror.ensureQuery<unknown>(h1.subId)
    expect(state.value.status).toBe(Status.Error)
    expect(state.value.error?.message).toBe('xx')
    scope.stop()
  })
})

describe('queryGraph — invalidation', () => {
  it('invalidates by tag and refetches matching queries', async () => {
    const serverDb = new Map<string, User>([['1', { id: '1', name: 'A', age: 1 }]])
    const list = vi.fn(async () => ({ items: [...serverDb.values()], nextCursor: null }))
    const update = vi.fn(async (i: { id: string; patch: Partial<User> }) => {
      const next = { ...serverDb.get(i.id)!, ...i.patch }
      serverDb.set(i.id, next)
      return next
    })
    const { runtime, defs } = bootstrap({ api: { list, update } })
    const scope = effectScope()
    scope.run(() => runtime.subscribeQuery(defs.usersList.name, defs.usersList.key({}), {}))
    await flush()
    await flush()
    expect(list).toHaveBeenCalledTimes(1)

    await runtime.mutate(defs.updateUser.name, { id: '1', patch: { name: 'B' } })
    await flush()
    await flush()
    // Invalidate refetches the list query because invalidate returns ['users'] tag
    expect(list.mock.calls.length).toBeGreaterThan(1)
    scope.stop()
  })

  it('invalidates by query def reference', async () => {
    // Build defs once and reuse the exact same instances inside the worker registry.
    const list = vi.fn(async () => ({ items: [], nextCursor: null }))
    const defs = makeUserDefs({ list, update: vi.fn() })
    const invalidatingMutation = defineMutation<undefined, undefined>({
      name: 'invByRef',
      fetch: async () => undefined,
      invalidate: () => [defs.usersList],
    })

    const storage = memoryAdapter()
    const { client, server } = createInlineTransport()
    createQueryGraph({
      storage,
      endpoint: server,
      registry: {
        entities: new Map([[UserEntity.name, UserEntity]]),
        queries: new Map<string, AnyQueryDef>([
          [defs.usersList.name, defs.usersList],
          [defs.usersInfinite.name, defs.usersInfinite],
        ]),
        mutations: new Map([[invalidatingMutation.name, invalidatingMutation]]),
      },
    })
    const mirror = createMirror()
    const runtime = createTabRuntime({ transport: client, mirror, staleSubGcMs: 5 })

    const scope = effectScope()
    scope.run(() => runtime.subscribeQuery(defs.usersList.name, defs.usersList.key({}), {}))
    await flush()
    await flush()
    const beforeCalls = list.mock.calls.length

    await runtime.mutate(invalidatingMutation.name, undefined)
    await flush()
    await flush()
    expect(list.mock.calls.length).toBeGreaterThan(beforeCalls)
    scope.stop()
  })
})

describe('mutationQueue — onSuccess', () => {
  it('applies post-success entity patches', async () => {
    const PostEntity = defineEntity<{ id: string; v: number }>({ name: 'post', id: (p) => p.id })
    const upsertPost = defineMutation<{ id: string; v: number }, { id: string; v: number }>({
      name: 'post.upsert',
      fetch: async (i) => i,
      onSuccess: (resp, _input, ctx) => {
        ctx.upsertEntity(PostEntity, resp)
      },
    })
    const list = vi.fn(async () => ({ items: [], nextCursor: null }))
    const { runtime } = bootstrap({
      api: { list, update: vi.fn() },
      entities: [UserEntity, PostEntity],
      extraMutations: [upsertPost],
    })
    await runtime.mutate(upsertPost.name, { id: 'p1', v: 1 })
    await flush()
    await flush()
    expect(runtime.mirror.getEntity<{ v: number }>('post', 'p1')).toEqual({ id: 'p1', v: 1 })
  })
})

describe('mutationQueue — offline + retry', () => {
  it('does not run mutations while offline, then drains on online', async () => {
    let online = false
    let onlineCb: (() => void) | null = null
    const serverDb = new Map<string, User>([['1', { id: '1', name: 'A', age: 1 }]])
    const list = vi.fn(async () => ({ items: [...serverDb.values()], nextCursor: null }))
    const update = vi.fn(async (i: { id: string; patch: Partial<User> }) => {
      const next = { ...serverDb.get(i.id)!, ...i.patch }
      serverDb.set(i.id, next)
      return next
    })
    const { runtime } = bootstrap({
      api: { list, update },
      isOnline: () => online,
      onOnline: (cb) => {
        onlineCb = cb
        return () => {}
      },
    })
    const scope = effectScope()
    scope.run(() => runtime.subscribeQuery(makeUserDefs({ list, update }).usersList.name, ['users', 'list', ''], {}))
    await flush()
    await flush()
    // Initial list fetch happens regardless of online flag (the query path
    // does not gate on isOnline — that is only for the mutation queue).
    expect(list).toHaveBeenCalled()

    const p = runtime.mutate('users.update', { id: '1', patch: { name: 'B' } })
    await flush()
    expect(update).not.toHaveBeenCalled()

    online = true
    onlineCb?.()
    await p
    expect(update).toHaveBeenCalledTimes(1)
    scope.stop()
  })

  it('retries network errors up to maxRetries, then fails', async () => {
    let attempts = 0
    let online = true
    let onlineCb: (() => void) | null = null
    const retryMutation = defineMutation<undefined, undefined>({
      name: 'retryFail',
      maxRetries: 2,
      fetch: async () => {
        attempts++
        throw new Error('network down')
      },
    })
    const list = vi.fn(async () => ({ items: [], nextCursor: null }))
    const { runtime } = bootstrap({
      api: { list, update: vi.fn() },
      extraMutations: [retryMutation],
      isOnline: () => online,
      onOnline: (cb) => {
        onlineCb = cb
        return () => {}
      },
    })

    const p = runtime.mutate('retryFail', undefined).catch((e) => e)
    await flush()
    expect(attempts).toBe(1)

    // Re-trigger drain via onOnline
    onlineCb?.()
    await flush()
    expect(attempts).toBe(2)

    onlineCb?.()
    const err = await p
    expect((err as Error).message).toBe('network down')
    expect(attempts).toBe(2) // last attempt failed and fell through to reject
  })
})

describe('queryGraph — entity storage hydration', () => {
  it('hydrates entity values from per-entity storage on subscribe', async () => {
    const PostEntity = defineEntity<{ id: string; v: number }>({
      name: 'post',
      id: (p) => p.id,
      storage: memoryStore<{ id: string; v: number }>(),
    })
    await PostEntity.storage!.write([{ key: 'p1', value: { id: 'p1', v: 99 } }])

    const postQuery = defineQuery<undefined, { items: { id: string; v: number }[] }, { ids: string[] }>({
      name: 'posts.list',
      key: () => ['posts'],
      fetch: async () => ({ items: [{ id: 'p1', v: 99 }] }),
      normalize: (r) => ({ entities: { post: r.items }, result: { ids: r.items.map((p) => p.id) } }),
    })

    const storage = memoryAdapter()
    await storage.queries.write([
      {
        key: '["posts"]',
        value: {
          status: Status.Success,
          result: { ids: ['p1'] },
          updatedAt: Date.now(),
          entityRefs: [{ type: 'post', id: 'p1' }],
        },
      },
    ])

    const { client, server } = createInlineTransport()
    createQueryGraph({
      storage,
      endpoint: server,
      registry: {
        entities: new Map([[PostEntity.name, PostEntity]]),
        queries: new Map<string, AnyQueryDef>([[postQuery.name, postQuery]]),
        mutations: new Map(),
      },
      defaultStaleTime: 60_000,
    })
    const mirror = createMirror()
    const runtime = createTabRuntime({ transport: client, mirror, staleSubGcMs: 5 })
    const scope = effectScope()
    let h1!: ReturnType<typeof runtime.subscribeQuery>
    scope.run(() => {
      h1 = runtime.subscribeQuery(postQuery.name, postQuery.key(undefined as never), undefined)
    })
    await flush()
    const state = runtime.mirror.ensureQuery<{ ids: string[] }>(h1.subId)
    expect(state.value.data).toEqual({ ids: ['p1'] })
    expect(runtime.mirror.getEntity<{ v: number }>('post', 'p1')?.v).toBe(99)
    scope.stop()
  })

  it('refetches when cached snapshot references an entity type without storage', async () => {
    const list = vi.fn(async (): Promise<ListUsersResp> => ({
      items: [{ id: '1', name: 'Refetched', age: 1 }],
      nextCursor: null,
    }))
    const { runtime, defs, storage } = bootstrap({
      api: { list, update: vi.fn() },
      defaultStaleTime: 60_000,
    })
    await storage.queries.write([
      {
        key: JSON.stringify(defs.usersList.key({})),
        value: {
          status: Status.Success,
          result: { ids: ['1'] },
          updatedAt: Date.now(), // fresh — would skip refetch under the old code
          entityRefs: [{ type: 'user', id: '1' }],
        },
      },
    ])
    const scope = effectScope()
    let h1!: ReturnType<typeof runtime.subscribeQuery>
    scope.run(() => {
      h1 = runtime.subscribeQuery(defs.usersList.name, defs.usersList.key({}), {})
    })
    await flush()
    await flush()
    expect(list).toHaveBeenCalledTimes(1)
    const state = runtime.mirror.ensureQuery<{ ids: string[] }>(h1.subId)
    expect(state.value.data).toEqual({ ids: ['1'] })
    expect(runtime.mirror.getEntity<User>('user', '1')?.name).toBe('Refetched')
    scope.stop()
  })

  it('drops a legacy cached snapshot without entityRefs', async () => {
    const list = vi.fn(async (): Promise<ListUsersResp> => ({
      items: [{ id: '1', name: 'A', age: 1 }],
      nextCursor: null,
    }))
    const { runtime, defs, storage } = bootstrap({ api: { list, update: vi.fn() } })
    await storage.queries.write([
      {
        key: JSON.stringify(defs.usersList.key({})),
        value: {
          status: Status.Success,
          result: { ids: ['stale'] },
          updatedAt: Date.now(),
          // entityRefs missing — should be discarded
        } as never,
      },
    ])
    const scope = effectScope()
    let h1!: ReturnType<typeof runtime.subscribeQuery>
    scope.run(() => {
      h1 = runtime.subscribeQuery(defs.usersList.name, defs.usersList.key({}), {})
    })
    await flush()
    await flush()
    const state = runtime.mirror.ensureQuery<{ ids: string[] }>(h1.subId)
    expect(state.value.data).toEqual({ ids: ['1'] })
    scope.stop()
  })
})

describe('mutationQueue — unknown definitions', () => {
  it('emits an error result for an unknown mutation in dev mode', async () => {
    const list = vi.fn(async () => ({ items: [], nextCursor: null }))
    const { runtime } = bootstrap({ api: { list, update: vi.fn() } })
    await expect(runtime.mutate('nope', undefined)).rejects.toThrow(/Unknown mutation/)
  })
})

describe('runtime — GC after subscribe race', () => {
  it('does not GC when refCount rises before timeout fires', async () => {
    vi.useFakeTimers()
    try {
      const list = vi.fn(async () => ({ items: [], nextCursor: null }))
      const { runtime, defs } = bootstrap({ api: { list, update: vi.fn() } })
      const h1 = runtime.subscribeQuery(defs.usersList.name, defs.usersList.key({}), {})
      h1.release()
      // Resubscribe before staleSubGcMs (5) elapses
      const h2 = runtime.subscribeQuery(defs.usersList.name, defs.usersList.key({}), {})
      vi.advanceTimersByTime(20)
      expect(h2.scope.active).toBe(true)
      h2.release()
    } finally {
      vi.useRealTimers()
    }
  })
})
