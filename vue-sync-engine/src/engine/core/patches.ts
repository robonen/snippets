import type { Patch } from './types'
import { Op } from './flags'

export function applyPatch<T>(target: T, patch: Patch): T {
  if (patch.path.length === 0) {
    if (patch.op === Op.Set) return patch.value as T
    if (patch.op === Op.Merge) return { ...(target as object), ...patch.value } as T
    return undefined as T
  }
  const next: any = Array.isArray(target) ? [...target] : { ...(target as any) }
  let cur = next
  for (let i = 0; i < patch.path.length - 1; i++) {
    const k = patch.path[i] as any
    const child = cur[k]
    cur[k] = Array.isArray(child) ? [...child] : { ...(child ?? {}) }
    cur = cur[k]
  }
  const last = patch.path[patch.path.length - 1] as any
  if (patch.op === Op.Set) cur[last] = patch.value
  else if (patch.op === Op.Merge) cur[last] = { ...(cur[last] ?? {}), ...patch.value }
  else cur[last] = undefined
  return next
}

export function invertEntityPatch<T>(prev: T | undefined, patch: Patch): Patch {
  if (patch.op === Op.Set) {
    return prev === undefined
      ? { op: Op.Delete, path: patch.path }
      : { op: Op.Set, path: patch.path, value: getAt(prev, patch.path) }
  }
  if (patch.op === Op.Delete) {
    return { op: Op.Set, path: patch.path, value: prev === undefined ? undefined : getAt(prev, patch.path) }
  }
  const prevSlice: Record<string, unknown> = {}
  for (const k of Object.keys(patch.value)) {
    prevSlice[k] = prev === undefined ? undefined : (getAt(prev, [...patch.path, k]) as unknown)
  }
  return { op: Op.Merge, path: patch.path, value: prevSlice }
}

function getAt(obj: any, path: readonly (string | number)[]): unknown {
  let cur = obj
  for (const k of path) {
    if (cur == null) return undefined
    cur = cur[k as any]
  }
  return cur
}
