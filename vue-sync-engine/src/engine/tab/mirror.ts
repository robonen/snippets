import { shallowRef, triggerRef, type ShallowRef } from 'vue'
import type { EntityId, EntityPatch, Patch, QueryStatus } from '../core/types'
import { Op, Status } from '../core/flags'
import { applyPatch } from '../core/patches'

export interface QueryState<T = unknown> {
  status: QueryStatus
  data: T | undefined
  error: { message: string } | undefined
}

export function createMirror() {
  const entities = new Map<string, Map<EntityId, unknown>>()
  const versions = new Map<string, ShallowRef<number>>()
  const queries = new Map<string, ShallowRef<QueryState>>()

  function typeVersion(type: string): ShallowRef<number> {
    let v = versions.get(type)
    if (!v) {
      v = shallowRef(0)
      versions.set(type, v)
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

  function getEntity<T>(type: string, id: EntityId): T | undefined {
    typeVersion(type).value
    const b = entities.get(type)
    return b === undefined ? undefined : (b.get(id) as T | undefined)
  }

  function applyEntityPatches(patches: EntityPatch[]): void {
    if (patches.length === 0) return
    let lastType = ''
    let bucket: Map<EntityId, unknown> | undefined
    let touchedFirst: string | undefined
    let touchedRest: Set<string> | undefined
    for (let i = 0; i < patches.length; i++) {
      const p = patches[i]
      if (p.type !== lastType) {
        lastType = p.type
        bucket = entityBucket(lastType)
        if (touchedFirst === undefined) touchedFirst = lastType
        else if (lastType !== touchedFirst) {
          if (touchedRest === undefined) touchedRest = new Set()
          touchedRest.add(lastType)
        }
      }
      const patch = p.patch
      if (patch.op === Op.Delete && patch.path.length === 0) {
        bucket!.delete(p.id)
      } else {
        bucket!.set(p.id, applyPatch(bucket!.get(p.id), patch))
      }
    }
    if (touchedFirst !== undefined) triggerRef(typeVersion(touchedFirst))
    if (touchedRest !== undefined) for (const t of touchedRest) triggerRef(typeVersion(t))
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

  return { entities, getEntity, applyEntityPatches, ensureQuery, applyQueryPatch, dropQuery }
}

export type Mirror = ReturnType<typeof createMirror>
