import { shallowRef, triggerRef, type ShallowRef } from 'vue'
import type { EntityId, EntityPatch, Patch, QueryStatus } from '../core/types'
import { Op, Status } from '../core/flags'
import { applyPatch } from '../core/patches'
import { entityKey } from '../core/queryKey'

export interface QueryState<T = unknown> {
  status: QueryStatus
  data: T | undefined
  error: { message: string } | undefined
}

export interface MirrorOptions {
  /**
   * Max entities kept per type. When exceeded, the least-recently-used entity is evicted.
   * 0 (default) = unlimited. Reads and writes bump recency; set this above your largest
   * live working set so eviction only ever reclaims off-screen (orphaned) entities.
   */
  entityCap?: number
}

export function createMirror(opts?: MirrorOptions) {
  const cap = opts?.entityCap ?? 0
  const entities = new Map<string, Map<EntityId, unknown>>()
  // Per-entity version refs (keyed by `type id`) give fine-grained reactivity:
  // a reader of one entity only re-runs when *that* entity changes, not when any
  // sibling of the same type does.
  const versions = new Map<string, ShallowRef<number>>()
  const queries = new Map<string, ShallowRef<QueryState>>()

  function entityVersion(key: string): ShallowRef<number> {
    let v = versions.get(key)
    if (!v) {
      v = shallowRef(0)
      versions.set(key, v)
    }
    return v
  }

  function entityBucket(type: string): Map<EntityId, unknown> {
    let b = entities.get(type)
    if (!b) {
      b = new Map()
      entities.set(type, b)
    }
    return b
  }

  // Write a value, moving the key to the most-recently-used position when a cap is active.
  // (Map.set on an existing key keeps its original position, so we delete first.)
  function setVal(bucket: Map<EntityId, unknown>, id: EntityId, val: unknown): void {
    if (cap !== 0) bucket.delete(id)
    bucket.set(id, val)
  }

  function getEntity<T>(type: string, id: EntityId): T | undefined {
    // Lazily create + track this entity's version so that a later create/update/delete
    // of exactly this entity re-runs the calling effect — even if it currently reads undefined.
    entityVersion(entityKey(type, id)).value
    const b = entities.get(type)
    if (b === undefined) return undefined
    const v = b.get(id)
    if (cap !== 0 && v !== undefined) {
      // LRU touch: a read marks the entity as recently used so it survives eviction.
      b.delete(id)
      b.set(id, v)
    }
    return v as T | undefined
  }

  // Notify the entity's readers, then drop its version ref if the entity no longer exists.
  // Readers re-run synchronously on the trigger, call getEntity, and lazily re-create a fresh
  // ref (seeing undefined) — so pruning is safe and keeps `versions` from growing on churn.
  // Refs for entities written-but-never-read are never created, so this is a no-op for them.
  function bumpEntity(type: string, id: EntityId, key: string): void {
    const v = versions.get(key)
    if (v === undefined) return
    triggerRef(v)
    const b = entities.get(type)
    if (b === undefined || !b.has(id)) versions.delete(key)
  }

  // Evict least-recently-used entities (the front of the Map) until the type is within cap.
  function evictOverflow(type: string): void {
    const b = entities.get(type)
    if (b === undefined || b.size <= cap) return
    while (b.size > cap) {
      const oldest = b.keys().next().value as EntityId
      b.delete(oldest)
      const key = entityKey(type, oldest)
      const vref = versions.get(key)
      if (vref !== undefined) {
        triggerRef(vref)
        versions.delete(key)
      }
    }
  }

  function applyEntityPatches(patches: EntityPatch[]): void {
    const n = patches.length
    if (n === 0) return

    // Fast path: a single patch (the common optimistic-update case) needs no Map.
    if (n === 1) {
      const p = patches[0]
      const bucket = entityBucket(p.type)
      const patch = p.patch
      if (patch.op === Op.Delete && patch.path.length === 0) bucket.delete(p.id)
      else setVal(bucket, p.id, applyPatch(bucket.get(p.id), patch))
      bumpEntity(p.type, p.id, entityKey(p.type, p.id))
      if (cap !== 0) evictOverflow(p.type)
      return
    }

    let lastType = ''
    let bucket: Map<EntityId, unknown> | undefined
    // Dedupe touched entities so one patched twice in a batch fires once; retain type+id
    // so pruning can check current existence.
    let touched: Map<string, { type: string; id: EntityId }> | undefined
    let touchedTypes: Set<string> | undefined
    for (let i = 0; i < n; i++) {
      const p = patches[i]
      if (p.type !== lastType) {
        lastType = p.type
        bucket = entityBucket(lastType)
      }
      const patch = p.patch
      if (patch.op === Op.Delete && patch.path.length === 0) {
        bucket!.delete(p.id)
      } else {
        setVal(bucket!, p.id, applyPatch(bucket!.get(p.id), patch))
      }
      const key = entityKey(p.type, p.id)
      if (touched === undefined) touched = new Map()
      if (!touched.has(key)) touched.set(key, { type: p.type, id: p.id })
      if (cap !== 0) (touchedTypes ??= new Set()).add(p.type)
    }
    if (touched !== undefined) for (const [key, { type, id }] of touched) bumpEntity(type, id, key)
    if (touchedTypes !== undefined) for (const t of touchedTypes) evictOverflow(t)
  }

  function ensureQuery<T>(subId: string): ShallowRef<QueryState<T>> {
    let r = queries.get(subId) as ShallowRef<QueryState<T>> | undefined
    if (!r) {
      r = shallowRef<QueryState<T>>({ status: Status.Idle, data: undefined, error: undefined })
      queries.set(subId, r as ShallowRef<QueryState>)
    }
    return r
  }

  function applyQueryPatch(subId: string, status: QueryStatus, patch?: Patch, error?: { message: string }): void {
    const r = ensureQuery(subId)
    const prev = r.value
    r.value = {
      status,
      data: patch ? applyPatch(prev.data, patch) : prev.data,
      error: error ?? prev.error,
    }
  }

  function dropQuery(subId: string): void {
    queries.delete(subId)
  }

  return { entities, versions, getEntity, applyEntityPatches, ensureQuery, applyQueryPatch, dropQuery }
}

export type Mirror = ReturnType<typeof createMirror>
