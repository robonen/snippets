import { describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h } from 'vue'

vi.mock('@vue/devtools-api', () => ({
  setupDevtoolsPlugin: () => {},
}))

import { bootstrapWorker, createEngine, createTabEngine, installEngine } from '../createEngine'
import { createInlineTransport } from '../transport/InlineTransport'
import { memoryAdapter } from '../adapters/storageAdapter'
import { EngineKey, useEngine } from '../composables/useEngine'
import { useQuery } from '../composables/useQuery'
import { flush, makeUserDefs, UserEntity, type ListUsersResp } from './fixtures'

describe('createEngine', () => {
  it('wires worker + tab end-to-end and returns a TabRuntime', async () => {
    const list = vi.fn(async (): Promise<ListUsersResp> => ({
      items: [{ id: '1', name: 'A', age: 1 }],
      nextCursor: null,
    }))
    const defs = makeUserDefs({ list, update: vi.fn() })
    const engine = createEngine({
      entities: [UserEntity],
      queries: [defs.usersList, defs.usersInfinite],
      mutations: [defs.updateUser],
    })
    expect(typeof engine.subscribeQuery).toBe('function')
    expect(typeof engine.mutate).toBe('function')
    const h2 = engine.subscribeQuery(defs.usersList.name, defs.usersList.key({}), {})
    await flush()
    await flush()
    const r = engine.mirror.ensureQuery<{ ids: string[] }>(h2.subId)
    expect(r.value.data).toEqual({ ids: ['1'] })
    engine.dispose()
  })

  it('forwards defaultStaleTime/defaultGcTime to the worker', async () => {
    const list = vi.fn(async (): Promise<ListUsersResp> => ({ items: [], nextCursor: null }))
    const defs = makeUserDefs({ list, update: vi.fn() })
    const engine = createEngine({
      entities: [UserEntity],
      queries: [defs.usersList, defs.usersInfinite],
      mutations: [defs.updateUser],
      defaultStaleTime: 1,
      defaultGcTime: 1,
    })
    const h1 = engine.subscribeQuery(defs.usersList.name, defs.usersList.key({}), {})
    await flush()
    expect(list).toHaveBeenCalled()
    h1.release()
    engine.dispose()
  })
})

describe('bootstrapWorker', () => {
  it('starts a query graph on the provided endpoint', async () => {
    const list = vi.fn(async (): Promise<ListUsersResp> => ({ items: [], nextCursor: null }))
    const defs = makeUserDefs({ list, update: vi.fn() })
    const { client, server } = createInlineTransport()
    const storage = memoryAdapter()
    bootstrapWorker({
      entities: [UserEntity],
      queries: [defs.usersList, defs.usersInfinite],
      mutations: [defs.updateUser],
      storage,
      endpoint: server,
    })
    const tab = createTabEngine({ transport: client })
    tab.subscribeQuery(defs.usersList.name, defs.usersList.key({}), {})
    await flush()
    await flush()
    expect(list).toHaveBeenCalled()
    tab.dispose()
  })
})

describe('installEngine', () => {
  it('provides the engine to descendants', () => {
    const list = vi.fn(async () => ({ items: [], nextCursor: null }))
    const defs = makeUserDefs({ list, update: vi.fn() })
    const engine = createEngine({
      entities: [UserEntity],
      queries: [defs.usersList, defs.usersInfinite],
      mutations: [defs.updateUser],
    })

    let resolved: unknown
    const C = defineComponent({
      setup() {
        resolved = useEngine()
        return () => h('div')
      },
    })
    const app = createApp(C)
    installEngine(app, engine, { defaults: { staleTime: 1000, gcTime: 1000 } })
    const root = document.createElement('div')
    app.mount(root)
    expect(resolved).toBe(engine)
    app.unmount()
  })

  it('also resolves via the EngineKey symbol', () => {
    const defs = makeUserDefs({
      list: vi.fn(async () => ({ items: [], nextCursor: null })),
      update: vi.fn(),
    })
    const engine = createEngine({
      entities: [UserEntity],
      queries: [defs.usersList, defs.usersInfinite],
      mutations: [defs.updateUser],
    })
    const C = defineComponent({
      setup() {
        return () => h('div')
      },
    })
    const app = createApp(C)
    app.provide(EngineKey, engine)
    const root = document.createElement('div')
    app.mount(root)
    // useQuery requires being in setup; this also exercises the EngineKey path.
    expect(() => {
      const C2 = defineComponent({
        setup() {
          useQuery(defs.usersList, { search: '' })
          return () => h('div')
        },
      })
      const app2 = createApp(C2)
      app2.provide(EngineKey, engine)
      const root2 = document.createElement('div')
      app2.mount(root2)
      app2.unmount()
    }).not.toThrow()
    app.unmount()
  })
})
