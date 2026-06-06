import type { StorageAdapter } from '../adapters/storageAdapter'
import type { EntityDef, EntityId, EntityPatch, InfiniteQueryDef, MutationDef, OptimisticCtx, QueryDef, QuerySnapshot, QueryStatus } from '../core/types'
import { Op, Status, Msg, Kind } from '../core/flags'
import { hashKey, entityKey } from '../core/queryKey'
import type { ServerEndpoint, ClientMsg } from '../transport/protocol'
import { createMutationQueue } from './mutationQueue'
import { DEV } from '../__dev'

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
  // Number of entityRefs contributed by each retained page (infinite queries only),
  // so page windowing can drop the right slice of refs alongside the page.
  pageRefCounts: number[]
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
  /** Default page cap for infinite queries that don't set their own `maxPages`. 0 = unlimited. */
  defaultMaxPages?: number
  /**
   * Reclaim worker-memory entities once no live query references them (and no in-flight
   * mutation pins them). Uses exact reference counts from each node's entityRefs, so it
   * only ever frees provably-orphaned entities. Default false.
   */
  entityGc?: boolean
  isOnline?: () => boolean
  onOnline?: (cb: () => void) => () => void
}

export function createQueryGraph(opts: QueryGraphOptions) {
  const { storage, endpoint, registry } = opts
  const defaultStaleTime = opts.defaultStaleTime ?? 30_000
  const defaultGcTime = opts.defaultGcTime ?? 5 * 60_000
  const defaultMaxPages = opts.defaultMaxPages ?? 0
  // Entity GC bookkeeping. When disabled, the maps are null and every retain/release/pin
  // call short-circuits on the first line — zero overhead on the hot fetch path.
  const entityRefCount = opts.entityGc ? new Map<string, number>() : null
  const entityPins = opts.entityGc ? new Map<string, number>() : null
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

  function evictEntity(type: string, id: EntityId): void {
    const b = entitiesInMemory.get(type)
    if (b !== undefined) b.delete(id)
  }

  type Ref = { type: string; id: EntityId }

  // Increment the query-reference count for each ref. Always called before releaseRefs so an
  // entity present in both the old and new ref sets never transiently drops to 0.
  function retainRefs(refs: ReadonlyArray<Ref>): void {
    if (entityRefCount === null) return
    for (let i = 0; i < refs.length; i++) {
      const k = entityKey(refs[i].type, refs[i].id)
      entityRefCount.set(k, (entityRefCount.get(k) ?? 0) + 1)
    }
  }

  // Decrement counts; an entity that reaches 0 references and isn't pinned is freed immediately.
  function releaseRefs(refs: ReadonlyArray<Ref>): void {
    if (entityRefCount === null) return
    for (let i = 0; i < refs.length; i++) {
      const r = refs[i]
      const k = entityKey(r.type, r.id)
      const c = (entityRefCount.get(k) ?? 0) - 1
      if (c <= 0) {
        entityRefCount.delete(k)
        if (entityPins === null || !entityPins.has(k)) evictEntity(r.type, r.id)
      } else {
        entityRefCount.set(k, c)
      }
    }
  }

  // Atomically swap a node's referenced entities, retaining the new set before releasing the old.
  function setNodeRefs(node: QueryNode, newRefs: Ref[]): void {
    retainRefs(newRefs)
    releaseRefs(node.entityRefs)
    node.entityRefs = newRefs
  }

  // Pins protect entities touched by an in-flight mutation from eviction until it settles.
  function pinEntities(patches: ReadonlyArray<{ type: string; id: EntityId }>): void {
    if (entityPins === null) return
    for (let i = 0; i < patches.length; i++) {
      const p = patches[i]
      const k = entityKey(p.type, p.id)
      entityPins.set(k, (entityPins.get(k) ?? 0) + 1)
    }
  }

  function unpinEntities(patches: ReadonlyArray<{ type: string; id: EntityId }>): void {
    if (entityPins === null) return
    for (let i = 0; i < patches.length; i++) {
      const p = patches[i]
      const k = entityKey(p.type, p.id)
      const c = (entityPins.get(k) ?? 0) - 1
      if (c <= 0) {
        entityPins.delete(k)
        if (entityRefCount === null || !entityRefCount.has(k)) evictEntity(p.type, p.id)
      } else {
        entityPins.set(k, c)
      }
    }
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
    if (DEV && !def) throw new Error(`Unknown query: ${defName}`)
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
        pageRefCounts: [],
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
        releaseRefs(node.entityRefs) // free entities this node was the last to reference
        node.entityRefs = []
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
    if (stored.entityRefs.length > 0) {
      const { patches, missing } = await loadEntityRefs(stored.entityRefs)
      if (missing) {
        // Some referenced entities can't be restored — their type has no
        // per-entity storage and they aren't in worker memory. The cached
        // result is just IDs pointing at nothing the UI can render, so skip
        // hydration and let runFetch repopulate both the query and the
        // entities on this subscribe.
        void storage.queries.delete(node.key)
        return
      }
      if (patches.length > 0) endpoint.broadcast({ type: Msg.EntityPatch, patches })
      setNodeRefs(node, stored.entityRefs.slice()) // node started empty; retains restored refs
      if (stored.pageRefCounts) node.pageRefCounts = stored.pageRefCounts.slice()
    }
    node.result = stored.result
    node.status = Status.Success
    node.updatedAt = stored.updatedAt
    pushSnapshotToSubscribers(node)
  }

  async function loadEntityRefs(
    refs: ReadonlyArray<{ type: string; id: EntityId }>,
  ): Promise<{ patches: EntityPatch[]; missing: boolean }> {
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
    let missing = false
    for (const [type, ids] of byType) {
      const def = registry.entities.get(type)
      if (!def?.storage) {
        // No per-entity storage. The entity is only available if it happens
        // to be in worker memory already (e.g. an earlier query in this
        // session populated it).
        for (let i = 0; i < ids.length; i++) {
          if (getEntity(type, ids[i]) === undefined) {
            missing = true
            break
          }
        }
        continue
      }
      const rows = await def.storage.readMany(ids)
      for (let i = 0; i < rows.length; i++) {
        const data = rows[i]
        const id = ids[i]
        if (data === undefined) {
          if (getEntity(type, id) === undefined) missing = true
          continue
        }
        if (getEntity(type, id) === undefined) setEntity(type, id, data)
        patches.push({ type, id, patch: { op: Op.Set, path: EMPTY_PATH, value: data } })
      }
    }
    return { patches, missing }
  }

  function pushSnapshotToSubscribers(node: QueryNode): void {
    for (const subId of node.subscribers) {
      endpoint.broadcast({
        type: Msg.QueryPatch,
        subId,
        status: node.status,
        patch: { op: Op.Set, path: EMPTY_PATH, value: node.result },
        error: undefined,
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
      endpoint.broadcast({
        type: Msg.QueryPatch,
        subId,
        status: Status.Pending,
        patch: undefined,
        error: undefined,
      })
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
          const maxPages = (node.def as InfiniteQueryDef).maxPages ?? defaultMaxPages
          const prev = (node.result as { pages: unknown[]; pageParams: unknown[] } | undefined) ?? { pages: [], pageParams: [] }
          if (append) {
            // Incremental retain: only the new page's entities, never re-touching the window —
            // keeps append O(page) rather than O(total) for long infinite lists.
            retainRefs(pageRefs)
            const pages = [...prev.pages, pageResult]
            const pageParams = [...prev.pageParams, effectivePageParam]
            let refs = node.entityRefs.concat(pageRefs)
            // Counts stay aligned with pages unless they drifted (e.g. a hydrated snapshot
            // without per-page counts). When aligned we can drop the exact ref slice.
            const counts = node.pageRefCounts.length === prev.pages.length ? node.pageRefCounts.concat(pageRefs.length) : null
            if (maxPages && pages.length > maxPages) {
              const dropN = pages.length - maxPages
              pages.splice(0, dropN)
              pageParams.splice(0, dropN)
              if (counts) {
                let dropRefs = 0
                for (let i = 0; i < dropN; i++) dropRefs += counts[i]
                counts.splice(0, dropN)
                if (dropRefs > 0) {
                  releaseRefs(refs.slice(0, dropRefs))
                  refs = refs.slice(dropRefs)
                }
              }
            }
            node.result = { pages, pageParams }
            node.entityRefs = refs
            node.pageRefCounts = counts ?? []
          } else {
            node.result = { pages: [pageResult], pageParams: [effectivePageParam] }
            setNodeRefs(node, pageRefs)
            node.pageRefCounts = [pageRefs.length]
          }
        } else {
          node.result = pageResult
          setNodeRefs(node, pageRefs)
        }
        node.status = Status.Success
        node.updatedAt = Date.now()
        const snap: QuerySnapshot = {
          status: Status.Success,
          result: node.result,
          updatedAt: node.updatedAt,
          entityRefs: node.entityRefs,
          pageRefCounts: isInfinite ? node.pageRefCounts : undefined,
        }
        await storage.queries.write([{ key: node.key, value: snap }])
        pushSnapshotToSubscribers(node)
      } catch (err) {
        node.status = Status.Error
        const error = { message: (err as Error)?.message ?? String(err) }
        for (const subId of node.subscribers) {
          endpoint.broadcast({
            type: Msg.QueryPatch,
            subId,
            status: Status.Error,
            patch: undefined,
            error,
          })
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
        error: undefined,
      })
      if (!isFresh(node)) void runFetch(node)
      return
    }
    if (node.status === Status.Idle) await hydrate(node)
    const status = node.status as QueryNode['status']
    if (status === Status.Pending) {
      endpoint.broadcast({
        type: Msg.QueryPatch,
        subId: msg.subId,
        status: Status.Pending,
        patch: undefined,
        error: undefined,
      })
    } else if (status === Status.Success) {
      broadcastEntityRefs(node.entityRefs)
      endpoint.broadcast({
        type: Msg.QueryPatch,
        subId: msg.subId,
        status: Status.Success,
        patch: { op: Op.Set, path: EMPTY_PATH, value: node.result },
        error: undefined,
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
    pinEntities,
    unpinEntities,
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

  return { nodes, entitiesInMemory, subscribe, unsubscribe, fetchNextPage, queue }
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
