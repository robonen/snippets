import { describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { createInlineTransport } from '../transport/InlineTransport'
import { createMirror } from '../tab/mirror'
import { createTabRuntime } from '../tab/runtime'
import { createQueryGraph, type AnyQueryDef } from '../worker/queryGraph'
import { memoryAdapter } from '../adapters/storageAdapter'
import { Status } from '../core/flags'
import { flush, makeUserDefs, type ListUsersResp, type User, UserEntity } from './fixtures'

function setup(api: { list: any; update: any }) {
  const defs = makeUserDefs(api)
  const storage = memoryAdapter()
  const { client, server } = createInlineTransport()
  let onlineCb: (() => void) | null = null
  let online = true
  createQueryGraph({
    storage,
    endpoint: server,
    registry: {
      entities: new Map([[UserEntity.name, UserEntity]]),
      queries: new Map<string, AnyQueryDef>([
        [defs.usersList.name, defs.usersList],
        [defs.usersInfinite.name, defs.usersInfinite],
      ]),
      mutations: new Map([[defs.updateUser.name, defs.updateUser]]),
    },
    isOnline: () => online,
    onOnline: (cb) => {
      onlineCb = cb
      return () => {}
    },
  })
  const mirror = createMirror()
  const runtime = createTabRuntime({ transport: client, mirror, staleSubGcMs: 10 })
  return {
    runtime,
    defs,
    storage,
    setOnline(v: boolean) {
      online = v
      if (v && onlineCb) onlineCb()
    },
  }
}

describe('useQuery + QueryGraph', () => {
  it('fetches, normalizes entities, and exposes result via mirror', async () => {
    const list = vi.fn(async (): Promise<ListUsersResp> => ({
      items: [
        { id: '1', name: 'Ada', age: 30 },
        { id: '2', name: 'Bob', age: 40 },
      ],
      nextCursor: null,
    }))
    const { runtime, defs } = setup({ list, update: vi.fn() })

    const scope = effectScope()
    let handle!: ReturnType<typeof runtime.subscribeQuery>
    scope.run(() => {
      handle = runtime.subscribeQuery(defs.usersList.name, defs.usersList.key({}), {})
    })

    await flush()
    await flush()

    const state = runtime.mirror.ensureQuery<{ ids: string[] }>(handle.subId)
    expect(state.value.status).toBe(Status.Success)
    expect(state.value.data).toEqual({ ids: ['1', '2'] })
    expect(runtime.mirror.getEntity<User>("user", "1")).toEqual({ id: '1', name: 'Ada', age: 30 })

    scope.stop()
  })

  it('dedupes parallel subscriptions to the same key (single fetch)', async () => {
    const list = vi.fn(async () => ({ items: [{ id: '1', name: 'A', age: 1 }], nextCursor: null }))
    const { runtime, defs } = setup({ list, update: vi.fn() })

    const scope = effectScope()
    scope.run(() => {
      runtime.subscribeQuery(defs.usersList.name, defs.usersList.key({}), {})
      runtime.subscribeQuery(defs.usersList.name, defs.usersList.key({}), {})
      runtime.subscribeQuery(defs.usersList.name, defs.usersList.key({}), {})
    })

    await flush()
    await flush()
    expect(list).toHaveBeenCalledTimes(1)
    scope.stop()
  })

  it('hydrates from storage before network', async () => {
    const list = vi.fn(async () => ({ items: [{ id: '1', name: 'Fresh', age: 10 }], nextCursor: null }))
    const { runtime, defs, storage } = setup({ list, update: vi.fn() })

    await storage.queries.write([{
      key: JSON.stringify(defs.usersList.key({})),
      value: {
        status: Status.Success,
        result: { ids: ['cached'] },
        updatedAt: Date.now() - 10_000,
        entityRefs: [],
      },
    }])

    const scope = effectScope()
    let handle!: ReturnType<typeof runtime.subscribeQuery>
    scope.run(() => {
      handle = runtime.subscribeQuery(defs.usersList.name, defs.usersList.key({}), {})
    })

    await flush()
    const state = runtime.mirror.ensureQuery<{ ids: string[] }>(handle.subId)
    expect(state.value.data).toEqual({ ids: ['cached'] })

    await flush()
    await flush()
    expect(state.value.data).toEqual({ ids: ['1'] })
    scope.stop()
  })
})

describe('useMutation + queue', () => {
  it('optimistic update is visible immediately, then confirmed by server response', async () => {
    const serverDb = new Map<string, User>([['1', { id: '1', name: 'A', age: 1 }]])
    const list = vi.fn(async () => ({ items: [...serverDb.values()], nextCursor: null }))
    const update = vi.fn(async (i: { id: string; patch: Partial<User> }) => {
      const next = { ...serverDb.get(i.id)!, ...i.patch }
      serverDb.set(i.id, next)
      return next
    })
    const { runtime, defs } = setup({ list, update })

    const scope = effectScope()
    scope.run(() => runtime.subscribeQuery(defs.usersList.name, defs.usersList.key({}), {}))
    await flush()
    await flush()
    expect(runtime.mirror.getEntity<User>("user", "1")?.name).toBe('A')

    const p = runtime.mutate(defs.updateUser.name, { id: '1', patch: { name: 'Renamed' } })
    await flush()
    expect(runtime.mirror.getEntity<User>("user", "1")?.name).toBe('Renamed')

    await p
    await flush()
    await flush()
    expect(runtime.mirror.getEntity<User>("user", "1")?.name).toBe('Renamed')
    scope.stop()
  })

  it('rolls back on server rejection', async () => {
    const list = vi.fn(async () => ({ items: [{ id: '1', name: 'A', age: 1 }], nextCursor: null }))
    const update = vi.fn(async () => {
      throw new Error('boom')
    })
    const { runtime, defs } = setup({ list, update })

    const scope = effectScope()
    scope.run(() => runtime.subscribeQuery(defs.usersList.name, defs.usersList.key({}), {}))
    await flush()
    await flush()

    await expect(
      runtime.mutate(defs.updateUser.name, { id: '1', patch: { name: 'Renamed' } }),
    ).rejects.toThrow('boom')

    expect(runtime.mirror.getEntity<User>("user", "1")?.name).toBe('A')
    scope.stop()
  })
})

describe('useInfiniteQuery', () => {
  it('appends pages on fetchNextPage', async () => {
    let call = 0
    const list = vi.fn(async (args: { cursor?: string | null }): Promise<ListUsersResp> => {
      call++
      if (call === 1) return { items: [{ id: '1', name: 'A', age: 1 }], nextCursor: 'c1' }
      if (call === 2) return { items: [{ id: '2', name: 'B', age: 2 }], nextCursor: null }
      expect(args).toBeDefined()
      throw new Error('no more')
    })
    const { runtime, defs } = setup({ list, update: vi.fn() })

    const scope = effectScope()
    let handle!: ReturnType<typeof runtime.subscribeQuery>
    scope.run(() => {
      handle = runtime.subscribeQuery(defs.usersInfinite.name, defs.usersInfinite.key({}), {})
    })
    await flush()
    await flush()

    type R = { ids: string[]; nextCursor: string | null }
    const state = runtime.mirror.ensureQuery<{ pages: R[]; pageParams: unknown[] }>(handle.subId)
    expect(state.value.data?.pages).toEqual([{ ids: ['1'], nextCursor: 'c1' }])

    handle.fetchNextPage()
    await flush()
    await flush()
    expect(state.value.data?.pages.length).toBe(2)
    expect(state.value.data?.pages[1].ids).toEqual(['2'])
    scope.stop()
  })
})

describe('GC', () => {
  it('stops the scope after staleSubGcMs once refCount hits 0', async () => {
    vi.useFakeTimers()
    try {
      const list = vi.fn(async () => ({ items: [], nextCursor: null }))
      const { runtime, defs } = setup({ list, update: vi.fn() })
      const handle = runtime.subscribeQuery(defs.usersList.name, defs.usersList.key({}), {})
      handle.release()
      vi.advanceTimersByTime(20)
      expect(handle.scope.active).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
