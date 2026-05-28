import { describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { createInlineTransport } from '../transport/InlineTransport'
import { createMirror } from '../tab/mirror'
import { createTabRuntime } from '../tab/runtime'
import { createQueryGraph, type AnyQueryDef } from '../worker/queryGraph'
import { memoryAdapter } from '../adapters/storageAdapter'
import { memoryStore } from '../adapters/memoryStore'
import { defineEntity, defineMutation, defineQuery } from '../define'
import { Msg, Status } from '../core/flags'
import { flush, makeUserDefs, UserEntity, type User } from './fixtures'

describe('queryGraph — optimistic remove/upsert', () => {
  it('rolls back removeEntity on mutation failure', async () => {
    const list = vi.fn(async () => ({
      items: [{ id: '1', name: 'A', age: 1 }],
      nextCursor: null,
    }))
    const defs = makeUserDefs({ list, update: vi.fn() })
    const removeUser = defineMutation<{ id: string }, undefined>({
      name: 'user.remove',
      fetch: async () => {
        throw new Error('cant remove')
      },
      optimistic: (input, ctx) => ctx.removeEntity(UserEntity, input.id),
    })

    const storage = memoryAdapter()
    const { client, server } = createInlineTransport()
    createQueryGraph({
      storage,
      endpoint: server,
      registry: {
        entities: new Map([[UserEntity.name, UserEntity]]),
        queries: new Map<string, AnyQueryDef>([[defs.usersList.name, defs.usersList]]),
        mutations: new Map([[removeUser.name, removeUser]]),
      },
    })
    const mirror = createMirror()
    const rt = createTabRuntime({ transport: client, mirror, staleSubGcMs: 5 })

    const scope = effectScope()
    scope.run(() => rt.subscribeQuery(defs.usersList.name, defs.usersList.key({}), {}))
    await flush()
    await flush()
    expect(rt.mirror.getEntity<User>('user', '1')?.name).toBe('A')

    await expect(rt.mutate(removeUser.name, { id: '1' })).rejects.toThrow('cant remove')
    await flush()
    // Rollback restored the entity
    expect(rt.mirror.getEntity<User>('user', '1')?.name).toBe('A')
    scope.stop()
    rt.dispose()
  })

  it('upserts a brand-new entity optimistically and rolls back on error', async () => {
    const list = vi.fn(async () => ({ items: [], nextCursor: null }))
    const defs = makeUserDefs({ list, update: vi.fn() })
    const upsertUser = defineMutation<User, User>({
      name: 'user.upsert',
      fetch: async () => {
        throw new Error('refused')
      },
      optimistic: (input, ctx) => ctx.upsertEntity(UserEntity, input),
    })

    const storage = memoryAdapter()
    const { client, server } = createInlineTransport()
    createQueryGraph({
      storage,
      endpoint: server,
      registry: {
        entities: new Map([[UserEntity.name, UserEntity]]),
        queries: new Map<string, AnyQueryDef>([[defs.usersList.name, defs.usersList]]),
        mutations: new Map([[upsertUser.name, upsertUser]]),
      },
    })
    const mirror = createMirror()
    const rt = createTabRuntime({ transport: client, mirror, staleSubGcMs: 5 })

    await expect(
      rt.mutate(upsertUser.name, { id: '9', name: 'Z', age: 99 }),
    ).rejects.toThrow('refused')
    await flush()
    // Rollback: upsert of a brand-new id inverts to delete
    expect(rt.mirror.getEntity<User>('user', '9')).toBeUndefined()
    rt.dispose()
  })

  it('post-success removeEntity emits delete patch', async () => {
    const list = vi.fn(async () => ({
      items: [{ id: '1', name: 'A', age: 1 }],
      nextCursor: null,
    }))
    const defs = makeUserDefs({ list, update: vi.fn() })
    const completeMutation = defineMutation<{ id: string }, { id: string }>({
      name: 'user.complete',
      fetch: async (i) => i,
      onSuccess: (resp, _input, ctx) => ctx.removeEntity(UserEntity, resp.id),
    })

    const storage = memoryAdapter()
    const { client, server } = createInlineTransport()
    createQueryGraph({
      storage,
      endpoint: server,
      registry: {
        entities: new Map([[UserEntity.name, UserEntity]]),
        queries: new Map<string, AnyQueryDef>([[defs.usersList.name, defs.usersList]]),
        mutations: new Map([[completeMutation.name, completeMutation]]),
      },
    })
    const mirror = createMirror()
    const rt = createTabRuntime({ transport: client, mirror, staleSubGcMs: 5 })

    const scope = effectScope()
    scope.run(() => rt.subscribeQuery(defs.usersList.name, defs.usersList.key({}), {}))
    await flush()
    await flush()
    expect(rt.mirror.getEntity<User>('user', '1')?.name).toBe('A')

    await rt.mutate(completeMutation.name, { id: '1' })
    await flush()
    expect(rt.mirror.getEntity<User>('user', '1')).toBeUndefined()
    scope.stop()
    rt.dispose()
  })

  it('post-success patchEntity merges new fields on an existing entity', async () => {
    const list = vi.fn(async () => ({
      items: [{ id: '1', name: 'A', age: 1 }],
      nextCursor: null,
    }))
    const defs = makeUserDefs({ list, update: vi.fn() })
    const patchMut = defineMutation<{ id: string; patch: Partial<User> }, User>({
      name: 'user.postPatch',
      fetch: async (i) => ({ id: i.id, name: 'A', age: 1, ...i.patch }),
      onSuccess: (resp, input, ctx) => ctx.patchEntity(UserEntity, input.id, { age: resp.age }),
    })

    const storage = memoryAdapter()
    const { client, server } = createInlineTransport()
    createQueryGraph({
      storage,
      endpoint: server,
      registry: {
        entities: new Map([[UserEntity.name, UserEntity]]),
        queries: new Map<string, AnyQueryDef>([[defs.usersList.name, defs.usersList]]),
        mutations: new Map([[patchMut.name, patchMut]]),
      },
    })
    const mirror = createMirror()
    const rt = createTabRuntime({ transport: client, mirror, staleSubGcMs: 5 })

    const scope = effectScope()
    scope.run(() => rt.subscribeQuery(defs.usersList.name, defs.usersList.key({}), {}))
    await flush()
    await flush()
    await rt.mutate(patchMut.name, { id: '1', patch: { age: 42 } })
    await flush()
    expect(rt.mirror.getEntity<User>('user', '1')?.age).toBe(42)
    scope.stop()
    rt.dispose()
  })
})

describe('queryGraph — entities with storage on delete', () => {
  it('removes the row from per-entity storage on Delete patch', async () => {
    const PostEntity = defineEntity<{ id: string; v: number }>({
      name: 'post',
      id: (p) => p.id,
      storage: memoryStore<{ id: string; v: number }>(),
    })
    await PostEntity.storage!.write([{ key: 'p1', value: { id: 'p1', v: 1 } }])

    const listPosts = defineQuery<undefined, { items: { id: string; v: number }[] }, { ids: string[] }>({
      name: 'posts.list2',
      key: () => ['posts.list2'],
      fetch: async () => ({ items: [{ id: 'p1', v: 1 }] }),
      normalize: (r) => ({ entities: { post: r.items }, result: { ids: r.items.map((p) => p.id) } }),
    })
    const removePost = defineMutation<{ id: string }, undefined>({
      name: 'post.remove',
      fetch: async () => undefined,
      optimistic: (input, ctx) => ctx.removeEntity(PostEntity, input.id),
    })

    const storage = memoryAdapter()
    const { client, server } = createInlineTransport()
    createQueryGraph({
      storage,
      endpoint: server,
      registry: {
        entities: new Map([[PostEntity.name, PostEntity]]),
        queries: new Map<string, AnyQueryDef>([[listPosts.name, listPosts]]),
        mutations: new Map([[removePost.name, removePost]]),
      },
    })
    const mirror = createMirror()
    const rt = createTabRuntime({ transport: client, mirror, staleSubGcMs: 5 })

    const scope = effectScope()
    scope.run(() => rt.subscribeQuery(listPosts.name, listPosts.key(undefined as never), undefined))
    await flush()
    await flush()
    await rt.mutate(removePost.name, { id: 'p1' })
    await flush()
    await flush()
    expect(await PostEntity.storage!.read('p1')).toBeUndefined()
    scope.stop()
    rt.dispose()
  })
})

describe('mutationQueue — init from persisted', () => {
  it('rehydrates persisted mutations and resumes seq counter', async () => {
    const storage = memoryAdapter()
    await storage.mutations.write([
      {
        key: 'm-old',
        value: {
          id: 'm-old',
          seq: 7,
          name: 'unknown.mutation',
          input: {},
          createdAt: 0,
          attempts: 0,
          state: 'pending',
          inversePatches: [],
        },
      },
    ])

    const list = vi.fn(async () => ({ items: [], nextCursor: null }))
    const defs = makeUserDefs({ list, update: vi.fn() })
    const { client, server } = createInlineTransport()
    createQueryGraph({
      storage,
      endpoint: server,
      registry: {
        entities: new Map([[UserEntity.name, UserEntity]]),
        queries: new Map<string, AnyQueryDef>([[defs.usersList.name, defs.usersList]]),
        mutations: new Map(), // unknown def — runOne will delete it from storage
      },
    })
    const mirror = createMirror()
    const rt = createTabRuntime({ transport: client, mirror, staleSubGcMs: 5 })

    // Wait for drain to remove the orphan
    await flush()
    await flush()
    await flush()
    expect(await storage.mutations.read('m-old')).toBeUndefined()
    rt.dispose()
  })
})

describe('runtime — MutateResult fallback error', () => {
  it('falls back to "mutation failed" when error message is absent', async () => {
    const { client, server } = createInlineTransport()
    const mirror = createMirror()
    const rt = createTabRuntime({ transport: client, mirror, staleSubGcMs: 5 })

    // Capture the mutId the runtime generates by intercepting outgoing messages
    let mutId = ''
    server.onClient((m) => {
      if (m.type === Msg.Mutate) mutId = m.mutId
    })
    const p = rt.mutate('whatever', {})
    await Promise.resolve()
    await Promise.resolve()
    expect(mutId).not.toBe('')

    server.broadcast({ type: Msg.MutateResult, mutId, ok: false })
    await expect(p).rejects.toThrow('mutation failed')
    rt.dispose()
  })

  it('dispose() cancels outstanding scopes and unsubscribes the transport', () => {
    const { client } = createInlineTransport()
    const mirror = createMirror()
    const rt = createTabRuntime({ transport: client, mirror, staleSubGcMs: 5 })
    const h = rt.subscribeQuery('q.unknown', ['x'], {})
    expect(h.scope.active).toBe(true)
    rt.dispose()
    expect(h.scope.active).toBe(false)
  })
})
