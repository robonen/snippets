import type { StorageAdapter } from '../adapters/storageAdapter'
import type { EntityDef, EntityId, EntityPatch, InfiniteQueryDef, MutationDef, OptimisticCtx, QueryDef, QuerySnapshot, QueryStatus } from '../core/types'
import { Op, Status, Msg, Kind } from '../core/flags'
import { hashKey } from '../core/queryKey'
import type { ServerEndpoint, ClientMsg } from '../transport/protocol'
import { createMutationQueue } from './mutationQueue'

export type AnyQueryDef = (QueryDef | InfiniteQueryDef) & { name: string }

const EMPTY_PATH: readonly (string | number)[] = Object.freeze([])

interface QueryNode {
  key: string
  def: AnyQueryDef
  args: unknown
  subscribers: Set<string>
  status: QueryStatus
  result: unknown
  updatedAt: number
  inflight: Promise<void> | null
  abort: AbortController | null
  gcTimer: ReturnType<typeof setTimeout> | null
  entityRefs: Array<{ type: string; id: EntityId }>
}

interface Registry {
  queries: Map<string, AnyQueryDef>
  mutations: Map<string, MutationDef>
  entities: Map<string, EntityDef>
}

export interface QueryGraphOptions {
  storage: StorageAdapter
  endpoint: ServerEndpoint
  registry: Registry
  defaultStaleTime?: number
  defaultGcTime?: number
  isOnline?: () => boolean
  onOnline?: (cb: () => void) => () => void
}

export function createQueryGraph(opts: QueryGraphOptions) {
  const { storage, endpoint, registry } = opts
  const defaultStaleTime = opts.defaultStaleTime ?? 30_000
  const defaultGcTime = opts.defaultGcTime ?? 5 * 60_000
  const isOnline = opts.isOnline ?? (() => (typeof navigator !== 'undefined' ? navigator.onLine : true))
  const onOnline =
    opts.onOnline ??
    ((cb: () => void) => {
      if (typeof self === 'undefined') return () => {}
      self.addEventListener('online', cb)
      return () => self.removeEventListener('online', cb)
    })

  const nodes = new Map<string, QueryNode>()
  const subToNode = new Map<string, QueryNode>()
  const entitiesInMemory = new Map<string, Map<EntityId, unknown>>()

  function entityBucket(type: string): Map<EntityId, unknown> {
    let b = entitiesInMemory.get(type)
    if (!b) entitiesInMemory.set(type, (b = new Map()))
    return b
  }

  function setEntity(type: string, id: EntityId, data: unknown): void {
    entityBucket(type).set(id, data)
  }

  function getEntity(type: string, id: EntityId): unknown {
    return entityBucket(type).get(id)
  }

  function emitEntityPatches(patches: EntityPatch[]): Promise<void> {
    if (patches.length === 0) return Promise.resolve()
    const writesByType = new Map<string, Array<{ key: EntityId; value: unknown }>>()
    const tasks: Promise<void>[] = []
    for (let i = 0; i < patches.length; i++) {
      const p = patches[i]
      const def = registry.entities.get(p.type)
      if (p.patch.op === Op.Delete) {
        if (def?.storage) tasks.push(def.storage.delete(p.id))
      } else if (def?.storage) {
        let arr = writesByType.get(p.type)
        if (!arr) {
          arr = []
          writesByType.set(p.type, arr)
        }
        arr.push({ key: p.id, value: getEntity(p.type, p.id) })
      }
    }
    for (const [type, writes] of writesByType) {
      const def = registry.entities.get(type)
      if (def?.storage) tasks.push(def.storage.write(writes))
    }
    endpoint.broadcast({ type: Msg.EntityPatch, patches })
    return tasks.length === 0 ? Promise.resolve() : Promise.all(tasks).then(noop)
  }

  function mergeEntity(type: string, id: EntityId, data: unknown): EntityPatch | null {
    const prev = getEntity(type, id) as Record<string, unknown> | undefined
    if (prev && shallowEqual(prev, data as Record<string, unknown>)) return null
    setEntity(type, id, data)
    return { type, id, patch: { op: Op.Set, path: EMPTY_PATH, value: data } }
  }

  function ingestEntities(
    buckets: Record<string, ReadonlyArray<unknown>>,
    refs?: Array<{ type: string; id: EntityId }>,
  ): EntityPatch[] {
    const patches: EntityPatch[] = []
    for (const name in buckets) {
      const def = registry.entities.get(name)
      if (!def) continue
      const arr = buckets[name]
      for (let i = 0; i < arr.length; i++) {
        const e = arr[i]
        const id = def.id(e)
        if (refs) refs.push({ type: name, id })
        const p = mergeEntity(name, id, e)
        if (p) patches.push(p)
      }
    }
    return patches
  }

  function ensureNode(defName: string, args: unknown): QueryNode {
    const def = registry.queries.get(defName)!
    if (__SYNC_ENGINE_DEV__ && !def) throw new Error(`Unknown query: ${defName}`)
    const key = def.staticHash ?? hashKey(def.key(args as never))
    let node = nodes.get(key)
    if (!node) {
      node = {
        key,
        def,
        args,
        subscribers: new Set(),
        status: Status.Idle,
        result: undefined,
        updatedAt: 0,
        inflight: null,
        abort: null,
        gcTimer: null,
        entityRefs: [],
      }
      nodes.set(key, node)
    } else if (node.gcTimer !== null) {
      clearTimeout(node.gcTimer)
      node.gcTimer = null
    }
    return node
  }

  function scheduleGc(node: QueryNode): void {
    if (node.subscribers.size > 0) return
    const gc = node.def.gcTime ?? defaultGcTime
    node.gcTimer = setTimeout(() => {
      if (node.subscribers.size === 0) {
        nodes.delete(node.key)
        void storage.queries.delete(node.key)
      }
    }, gc)
  }

  function isFresh(node: QueryNode): boolean {
    if (!node.updatedAt) return false
    const stale = node.def.staleTime ?? defaultStaleTime
    return Date.now() - node.updatedAt < stale
  }

  async function hydrate(node: QueryNode): Promise<void> {
    const stored = await storage.queries.read(node.key)
    if (!stored || node.status !== Status.Idle) return
    if (!stored.entityRefs) {
      void storage.queries.delete(node.key)
      return
    }
    node.result = stored.result
    node.status = Status.Success
    node.updatedAt = stored.updatedAt
    if (stored.entityRefs.length > 0) {
      node.entityRefs = stored.entityRefs.slice()
      const patches = await loadEntityRefs(stored.entityRefs)
      if (patches.length > 0) endpoint.broadcast({ type: Msg.EntityPatch, patches })
    }
    pushSnapshotToSubscribers(node)
  }

  async function loadEntityRefs(
    refs: ReadonlyArray<{ type: string; id: EntityId }>,
  ): Promise<EntityPatch[]> {
    const byType = new Map<string, EntityId[]>()
    for (let i = 0; i < refs.length; i++) {
      const r = refs[i]
      let list = byType.get(r.type)
      if (!list) {
        list = []
        byType.set(r.type, list)
      }
      list.push(r.id)
    }
    const patches: EntityPatch[] = []
    for (const [type, ids] of byType) {
      const def = registry.entities.get(type)
      if (!def?.storage) continue
      const rows = await def.storage.readMany(ids)
      for (let i = 0; i < rows.length; i++) {
        const data = rows[i]
        if (data === undefined) continue
        const id = ids[i]
        if (getEntity(type, id) === undefined) setEntity(type, id, data)
        patches.push({ type, id, patch: { op: Op.Set, path: EMPTY_PATH, value: data } })
      }
    }
    return patches
  }

  function pushSnapshotToSubscribers(node: QueryNode): void {
    for (const subId of node.subscribers) {
      endpoint.broadcast({
        type: Msg.QueryPatch,
        subId,
        status: node.status,
        patch: { op: Op.Set, path: EMPTY_PATH, value: node.result },
      })
    }
  }

  function broadcastEntityRefs(refs: ReadonlyArray<{ type: string; id: EntityId }>): void {
    if (refs.length === 0) return
    const patches: EntityPatch[] = []
    for (let i = 0; i < refs.length; i++) {
      const r = refs[i]
      const data = getEntity(r.type, r.id)
      if (data === undefined) continue
      patches.push({ type: r.type, id: r.id, patch: { op: Op.Set, path: EMPTY_PATH, value: data } })
    }
    if (patches.length > 0) endpoint.broadcast({ type: Msg.EntityPatch, patches })
  }

  async function runFetch(node: QueryNode, pageParam?: unknown, append = false): Promise<void> {
    if (node.inflight) return node.inflight
    node.status = Status.Pending
    for (const subId of node.subscribers) {
      endpoint.broadcast({ type: Msg.QueryPatch, subId, status: Status.Pending })
    }
    node.abort = new AbortController()
    const isInfinite = node.def.kind === Kind.Infinite
    const effectivePageParam = isInfinite
      ? pageParam ?? (node.def as InfiniteQueryDef).initialPageParam
      : undefined
    const exec = (async () => {
      try {
        const pageRefs: Array<{ type: string; id: EntityId }> = []
        const { pageResult, entities } = await node.def.exec!(node.args as never, {
          signal: node.abort!.signal,
          pageParam: effectivePageParam,
        })
        if (entities !== null) await emitEntityPatches(ingestEntities(entities, pageRefs))
        if (isInfinite) {
          const prev = (node.result as { pages: unknown[]; pageParams: unknown[] } | undefined) ?? { pages: [], pageParams: [] }
          node.result = append
            ? { pages: [...prev.pages, pageResult], pageParams: [...prev.pageParams, effectivePageParam] }
            : { pages: [pageResult], pageParams: [effectivePageParam] }
          node.entityRefs = append ? node.entityRefs.concat(pageRefs) : pageRefs
        } else {
          node.result = pageResult
          node.entityRefs = pageRefs
        }
        node.status = Status.Success
        node.updatedAt = Date.now()
        const snap: QuerySnapshot = {
          status: Status.Success,
          result: node.result,
          updatedAt: node.updatedAt,
          entityRefs: node.entityRefs,
        }
        await storage.queries.write([{ key: node.key, value: snap }])
        pushSnapshotToSubscribers(node)
      } catch (err) {
        node.status = Status.Error
        const error = { message: (err as Error)?.message ?? String(err) }
        for (const subId of node.subscribers) {
          endpoint.broadcast({ type: Msg.QueryPatch, subId, status: Status.Error, error })
        }
      } finally {
        node.inflight = null
        node.abort = null
      }
    })()
    node.inflight = exec
    return exec
  }

  function fetchNextPage(subId: string): void {
    const node = subToNode.get(subId)
    if (!node || node.def.kind !== Kind.Infinite) return
    const def = node.def as InfiniteQueryDef
    const cur = (node.result as { pages: unknown[]; pageParams: unknown[] } | undefined) ?? { pages: [], pageParams: [] }
    const last = cur.pages[cur.pages.length - 1]
    if (last === undefined) {
      void runFetch(node, def.initialPageParam, false)
      return
    }
    const next = def.getNextPageParam(last as never, cur.pages as never[])
    if (next === null || next === undefined) return
    void runFetch(node, next, true)
  }

  async function subscribe(msg: { subId: string; defName: string; args: unknown }): Promise<void> {
    const node = ensureNode(msg.defName, msg.args)
    node.subscribers.add(msg.subId)
    subToNode.set(msg.subId, node)

    if (node.status === Status.Success) {
      broadcastEntityRefs(node.entityRefs)
      endpoint.broadcast({
        type: Msg.QueryPatch,
        subId: msg.subId,
        status: Status.Success,
        patch: { op: Op.Set, path: EMPTY_PATH, value: node.result },
      })
      if (!isFresh(node)) void runFetch(node)
      return
    }
    if (node.status === Status.Idle) await hydrate(node)
    const status = node.status as QueryNode['status']
    if (status === Status.Pending) endpoint.broadcast({ type: Msg.QueryPatch, subId: msg.subId, status: Status.Pending })
    else if (status === Status.Success) {
      broadcastEntityRefs(node.entityRefs)
      endpoint.broadcast({
        type: Msg.QueryPatch,
        subId: msg.subId,
        status: Status.Success,
        patch: { op: Op.Set, path: EMPTY_PATH, value: node.result },
      })
    }
    if (!isFresh(node)) void runFetch(node)
  }

  function unsubscribe(subId: string): void {
    const node = subToNode.get(subId)
    if (!node) return
    subToNode.delete(subId)
    node.subscribers.delete(subId)
    if (node.subscribers.size === 0) scheduleGc(node)
  }

  function buildCtx(forward: EntityPatch[], inverse: EntityPatch[]): OptimisticCtx {
    return {
      patchEntity: (entDef, id, patch) => {
        const prev = getEntity(entDef.name, id) as Record<string, unknown> | undefined
        const next = { ...(prev ?? {}), ...(patch as Record<string, unknown>) }
        setEntity(entDef.name, id, next)
        forward.push({ type: entDef.name, id, patch: { op: Op.Merge, path: EMPTY_PATH, value: patch as Record<string, unknown> } })
        if (prev !== undefined) {
          const prevSlice: Record<string, unknown> = {}
          for (const k of Object.keys(patch as Record<string, unknown>)) prevSlice[k] = (prev as any)[k]
          inverse.push({ type: entDef.name, id, patch: { op: Op.Merge, path: EMPTY_PATH, value: prevSlice } })
        } else {
          inverse.push({ type: entDef.name, id, patch: { op: Op.Delete, path: EMPTY_PATH } })
        }
      },
      removeEntity: (entDef, id) => {
        const prev = getEntity(entDef.name, id)
        entityBucket(entDef.name).delete(id)
        forward.push({ type: entDef.name, id, patch: { op: Op.Delete, path: EMPTY_PATH } })
        if (prev !== undefined) inverse.push({ type: entDef.name, id, patch: { op: Op.Set, path: EMPTY_PATH, value: prev } })
      },
      upsertEntity: (entDef, entity) => {
        const id = entDef.id(entity)
        const prev = getEntity(entDef.name, id)
        setEntity(entDef.name, id, entity)
        forward.push({ type: entDef.name, id, patch: { op: Op.Set, path: EMPTY_PATH, value: entity } })
        if (prev === undefined) inverse.push({ type: entDef.name, id, patch: { op: Op.Delete, path: EMPTY_PATH } })
        else inverse.push({ type: entDef.name, id, patch: { op: Op.Set, path: EMPTY_PATH, value: prev } })
      },
    }
  }

  function buildPostCtx(post: EntityPatch[]): OptimisticCtx {
    return {
      patchEntity: (entDef, id, patch) => {
        const prev = getEntity(entDef.name, id) as Record<string, unknown> | undefined
        const next = { ...(prev ?? {}), ...(patch as Record<string, unknown>) }
        setEntity(entDef.name, id, next)
        post.push({ type: entDef.name, id, patch: { op: Op.Merge, path: EMPTY_PATH, value: patch as Record<string, unknown> } })
      },
      removeEntity: (entDef, id) => {
        entityBucket(entDef.name).delete(id)
        post.push({ type: entDef.name, id, patch: { op: Op.Delete, path: EMPTY_PATH } })
      },
      upsertEntity: (entDef, entity) => {
        const id = entDef.id(entity)
        setEntity(entDef.name, id, entity)
        post.push({ type: entDef.name, id, patch: { op: Op.Set, path: EMPTY_PATH, value: entity } })
      },
    }
  }

  function invalidate(def: MutationDef, input: unknown, resp: unknown): void {
    if (!def.invalidate) return
    const targets = def.invalidate(input, resp)
    for (const t of targets) {
      if (typeof t === 'string') {
        for (const node of nodes.values()) if (node.def.tags?.(node.args as never).includes(t)) void runFetch(node)
      } else {
        for (const node of nodes.values()) if (node.def === t) void runFetch(node)
      }
    }
  }

  const queue = createMutationQueue({
    storage,
    mutations: registry.mutations,
    emitEntityPatches,
    buildCtx,
    buildPostCtx,
    invalidate,
    isOnline,
    onOnline,
    onResult: (mutId, ok, data, error) =>
      endpoint.broadcast({ type: Msg.MutateResult, mutId, ok, data, error }),
  })

  void queue.init()

  endpoint.onClient((msg: ClientMsg) => {
    if (msg.type === Msg.Subscribe) void subscribe(msg)
    else if (msg.type === Msg.Unsubscribe) unsubscribe(msg.subId)
    else if (msg.type === Msg.Mutate) void queue.enqueue(msg.mutId, msg.defName, msg.input)
    else if (msg.type === Msg.FetchNextPage) fetchNextPage(msg.subId)
  })

  return { nodes, subscribe, unsubscribe, fetchNextPage, queue }
}

function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const ak = Object.keys(a)
  let bn = 0
  for (const _ in b) bn++
  if (ak.length !== bn) return false
  for (let i = 0; i < ak.length; i++) {
    const k = ak[i]
    if (a[k] !== b[k]) return false
  }
  return true
}

function noop(): void {}
