import { describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref, type App, type Ref } from 'vue'
import { createEngine } from '../createEngine'
import { EngineKey, useEngine } from '../composables/useEngine'
import { useQuery } from '../composables/useQuery'
import { useInfiniteQuery } from '../composables/useInfiniteQuery'
import { useEntity } from '../composables/useEntity'
import { useMutation } from '../composables/useMutation'
import { Status } from '../core/flags'
import { flush, makeUserDefs, UserEntity, type ListUsersResp, type User } from './fixtures'

function buildEngine(api: { list: any; update: any }) {
  const defs = makeUserDefs(api)
  const engine = createEngine({
    entities: [UserEntity],
    queries: [defs.usersList, defs.usersInfinite],
    mutations: [defs.updateUser],
  })
  return { engine, defs }
}

interface Mounted {
  app: App
  el: HTMLElement
  unmount(): void
}

function mountWith(engine: ReturnType<typeof createEngine> | null, comp: any): Mounted {
  const app = createApp(comp)
  if (engine) app.provide(EngineKey, engine)
  const el = document.createElement('div')
  document.body.appendChild(el)
  app.mount(el)
  return {
    app,
    el,
    unmount() {
      app.unmount()
      el.remove()
    },
  }
}

describe('useEngine', () => {
  it('returns the provided runtime', () => {
    const { engine } = buildEngine({
      list: vi.fn(async () => ({ items: [], nextCursor: null })),
      update: vi.fn(),
    })
    let resolved: unknown
    const C = defineComponent({
      setup() {
        resolved = useEngine()
        return () => h('div')
      },
    })
    const m = mountWith(engine, C)
    expect(resolved).toBe(engine)
    m.unmount()
  })

  it('throws when not provided', () => {
    const C = defineComponent({
      setup() {
        useEngine()
        return () => h('div')
      },
    })
    expect(() => mountWith(null, C)).toThrow(/SyncEngine is not provided/)
  })
})

describe('useQuery', () => {
  it('exposes data/status/isSuccess after fetch', async () => {
    const list = vi.fn(async (): Promise<ListUsersResp> => ({
      items: [{ id: '1', name: 'Ada', age: 30 }],
      nextCursor: null,
    }))
    const { engine, defs } = buildEngine({ list, update: vi.fn() })

    let api!: ReturnType<typeof useQuery<{ search?: string }, ListUsersResp, { ids: string[] }>>
    const C = defineComponent({
      setup() {
        api = useQuery(defs.usersList, { search: '' })
        return () => h('div')
      },
    })
    const m = mountWith(engine, C)
    await flush()
    await flush()
    expect(api.isSuccess.value).toBe(true)
    expect(api.isLoading.value).toBe(false)
    expect(api.isError.value).toBe(false)
    expect(api.status.value).toBe(Status.Success)
    expect(api.data.value).toEqual({ ids: ['1'] })
    expect(api.error.value).toBeUndefined()
    m.unmount()
  })

  it('reactive args trigger resubscribe and a new fetch', async () => {
    const list = vi.fn(async (a: { search?: string }): Promise<ListUsersResp> => ({
      items: a.search ? [{ id: '2', name: 'Bob', age: 25 }] : [{ id: '1', name: 'Ada', age: 30 }],
      nextCursor: null,
    }))
    const { engine, defs } = buildEngine({ list, update: vi.fn() })

    const search = ref('')
    const C = defineComponent({
      setup() {
        useQuery(defs.usersList, () => ({ search: search.value }))
        return () => h('div')
      },
    })
    const m = mountWith(engine, C)
    await flush()
    await flush()
    expect(list.mock.calls.length).toBe(1)

    search.value = 'b'
    await nextTick()
    await flush()
    await flush()
    expect(list.mock.calls.length).toBe(2)
    expect(list.mock.calls[1][0]).toMatchObject({ search: 'b' })
    m.unmount()
  })

  it('data switches to the new subscription result after args change', async () => {
    const list = vi.fn(async (a: { search?: string }): Promise<ListUsersResp> => ({
      items: a.search ? [{ id: '2', name: 'Bob', age: 25 }] : [{ id: '1', name: 'Ada', age: 30 }],
      nextCursor: null,
    }))
    const { engine, defs } = buildEngine({ list, update: vi.fn() })

    const search = ref('')
    let api!: ReturnType<typeof useQuery<{ search?: string }, ListUsersResp, { ids: string[] }>>
    const C = defineComponent({
      setup() {
        api = useQuery(defs.usersList, () => ({ search: search.value }))
        return () => h('div')
      },
    })
    const m = mountWith(engine, C)
    await flush()
    await flush()
    expect(api.data.value).toEqual({ ids: ['1'] })

    search.value = 'b'
    await nextTick()
    await flush()
    await flush()
    // Computeds must follow the swapped-in subscription ref, not stay bound to the old one.
    expect(api.data.value).toEqual({ ids: ['2'] })
    expect(api.isSuccess.value).toBe(true)
    m.unmount()
  })

  it('releases handle on unmount', async () => {
    const list = vi.fn(async () => ({ items: [], nextCursor: null }))
    const { engine, defs } = buildEngine({ list, update: vi.fn() })

    const C = defineComponent({
      setup() {
        useQuery(defs.usersList, { search: '' })
        return () => h('div')
      },
    })
    const m = mountWith(engine, C)
    await flush()
    m.unmount()
  })
})

describe('useInfiniteQuery', () => {
  it('exposes pages/pageParams and fetchNextPage', async () => {
    let n = 0
    const list = vi.fn(async (): Promise<ListUsersResp> => {
      n++
      if (n === 1) return { items: [{ id: '1', name: 'A', age: 1 }], nextCursor: 'c1' }
      return { items: [{ id: '2', name: 'B', age: 2 }], nextCursor: null }
    })
    const { engine, defs } = buildEngine({ list, update: vi.fn() })

    let api!: ReturnType<typeof useInfiniteQuery<{ search?: string }, ListUsersResp, string | null, { ids: string[]; nextCursor: string | null }>>
    const C = defineComponent({
      setup() {
        api = useInfiniteQuery(defs.usersInfinite, { search: '' })
        return () => h('div')
      },
    })
    const m = mountWith(engine, C)
    await flush()
    await flush()

    expect(api.pages.value.length).toBe(1)
    expect(api.pageParams.value.length).toBe(1)
    expect(api.isLoading.value).toBe(false)
    expect(api.error.value).toBeUndefined()
    expect(api.status.value).toBe(Status.Success)

    api.fetchNextPage()
    await flush()
    await flush()
    expect(api.pages.value.length).toBe(2)
    expect(api.pages.value[1].ids).toEqual(['2'])
    m.unmount()
  })

  it('reactive args resubscribe', async () => {
    const list = vi.fn(async (): Promise<ListUsersResp> => ({ items: [], nextCursor: null }))
    const { engine, defs } = buildEngine({ list, update: vi.fn() })
    const search: Ref<string> = ref('')
    const C = defineComponent({
      setup() {
        useInfiniteQuery(defs.usersInfinite, () => ({ search: search.value }))
        return () => h('div')
      },
    })
    const m = mountWith(engine, C)
    await flush()
    search.value = 'q'
    await nextTick()
    await flush()
    expect(list.mock.calls.length).toBeGreaterThanOrEqual(2)
    m.unmount()
  })

  it('pages switch to the new subscription result after args change', async () => {
    const list = vi.fn(async (a: { search?: string }): Promise<ListUsersResp> => ({
      items: a.search ? [{ id: '2', name: 'B', age: 2 }] : [{ id: '1', name: 'A', age: 1 }],
      nextCursor: null,
    }))
    const { engine, defs } = buildEngine({ list, update: vi.fn() })
    const search = ref('')
    let api!: ReturnType<typeof useInfiniteQuery<{ search?: string }, ListUsersResp, string | null, { ids: string[]; nextCursor: string | null }>>
    const C = defineComponent({
      setup() {
        api = useInfiniteQuery(defs.usersInfinite, () => ({ search: search.value }))
        return () => h('div')
      },
    })
    const m = mountWith(engine, C)
    await flush()
    await flush()
    expect(api.pages.value[0]?.ids).toEqual(['1'])

    search.value = 'q'
    await nextTick()
    await flush()
    await flush()
    expect(api.pages.value[0]?.ids).toEqual(['2'])
    m.unmount()
  })
})

describe('useEntity', () => {
  it('reactively returns the entity by id', async () => {
    const list = vi.fn(async () => ({
      items: [{ id: '1', name: 'Ada', age: 30 }],
      nextCursor: null,
    }))
    const { engine, defs } = buildEngine({ list, update: vi.fn() })
    const id = ref<string | undefined>(undefined)
    let entity!: ReturnType<typeof useEntity<User>>
    const C = defineComponent({
      setup() {
        useQuery(defs.usersList, { search: '' })
        entity = useEntity(UserEntity, id)
        return () => h('div')
      },
    })
    const m = mountWith(engine, C)
    await flush()
    await flush()
    expect(entity.value).toBeUndefined()
    id.value = '1'
    await nextTick()
    expect(entity.value?.name).toBe('Ada')
    id.value = undefined
    await nextTick()
    expect(entity.value).toBeUndefined()
    m.unmount()
  })
})

describe('useMutation', () => {
  it('tracks status/data on success', async () => {
    const update = vi.fn(async (i: { id: string; patch: Partial<User> }) => ({
      id: i.id,
      name: 'x',
      age: 1,
      ...i.patch,
    }))
    const list = vi.fn(async () => ({ items: [{ id: '1', name: 'A', age: 1 }], nextCursor: null }))
    const { engine, defs } = buildEngine({ list, update })

    let api!: ReturnType<typeof useMutation<{ id: string; patch: Partial<User> }, User>>
    const C = defineComponent({
      setup() {
        api = useMutation(defs.updateUser)
        return () => h('div')
      },
    })
    const m = mountWith(engine, C)
    api.mutate({ id: '1', patch: { name: 'B' } })
    expect(api.status.value).toBe(Status.Pending)
    await flush()
    await flush()
    await flush()
    expect(api.status.value).toBe(Status.Success)
    expect(api.data.value?.name).toBe('B')
    expect(api.error.value).toBeUndefined()
    m.unmount()
  })

  it('tracks status/error on failure (mutate swallows)', async () => {
    const update = vi.fn(async () => {
      throw new Error('nope')
    })
    const list = vi.fn(async () => ({ items: [{ id: '1', name: 'A', age: 1 }], nextCursor: null }))
    const { engine, defs } = buildEngine({ list, update })

    let api!: ReturnType<typeof useMutation<{ id: string; patch: Partial<User> }, User>>
    const C = defineComponent({
      setup() {
        api = useMutation(defs.updateUser)
        return () => h('div')
      },
    })
    const m = mountWith(engine, C)
    api.mutate({ id: '1', patch: { name: 'B' } })
    await flush()
    await flush()
    await flush()
    expect(api.status.value).toBe(Status.Error)
    expect(api.error.value?.message).toBe('nope')
    m.unmount()
  })

  it('mutateAsync resolves with response', async () => {
    const update = vi.fn(async (i: { id: string; patch: Partial<User> }) => ({
      id: i.id,
      name: 'A',
      age: 1,
      ...i.patch,
    }))
    const list = vi.fn(async () => ({ items: [{ id: '1', name: 'A', age: 1 }], nextCursor: null }))
    const { engine, defs } = buildEngine({ list, update })

    let api!: ReturnType<typeof useMutation<{ id: string; patch: Partial<User> }, User>>
    const C = defineComponent({
      setup() {
        api = useMutation(defs.updateUser)
        return () => h('div')
      },
    })
    const m = mountWith(engine, C)
    const resp = await api.mutateAsync({ id: '1', patch: { name: 'Renamed' } })
    expect(resp.name).toBe('Renamed')
    expect(api.status.value).toBe(Status.Success)
    m.unmount()
  })

  it('mutateAsync rejects on error', async () => {
    const update = vi.fn(async () => {
      throw new Error('bad')
    })
    const list = vi.fn(async () => ({ items: [{ id: '1', name: 'A', age: 1 }], nextCursor: null }))
    const { engine, defs } = buildEngine({ list, update })

    let api!: ReturnType<typeof useMutation<{ id: string; patch: Partial<User> }, User>>
    const C = defineComponent({
      setup() {
        api = useMutation(defs.updateUser)
        return () => h('div')
      },
    })
    const m = mountWith(engine, C)
    await expect(api.mutateAsync({ id: '1', patch: { name: 'X' } })).rejects.toThrow('bad')
    expect(api.status.value).toBe(Status.Error)
    m.unmount()
  })
})
