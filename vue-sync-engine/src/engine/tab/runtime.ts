import { effectScope, type EffectScope } from 'vue'
import type { Transport } from '../transport/protocol'
import type { Mirror } from './mirror'
import { hashKey } from '../core/queryKey'
import { Msg } from '../core/flags'

interface QuerySubHandle {
  subId: string
  refCount: number
  scope: EffectScope
  gcTimer: ReturnType<typeof setTimeout> | null
  release: () => void
  fetchNextPage: () => void
}

export interface TabRuntime {
  mirror: Mirror
  transport: Transport
  subscribeQuery(defName: string, key: readonly unknown[], args: unknown): QuerySubHandle
  mutate(defName: string, input: unknown): Promise<unknown>
  dispose(): void
}

export interface TabRuntimeOptions {
  transport: Transport
  mirror: Mirror
  staleSubGcMs?: number
}

export function createTabRuntime(opts: TabRuntimeOptions): TabRuntime {
  const { transport, mirror } = opts
  const staleSubGcMs = opts.staleSubGcMs ?? 5_000

  const byKey = new Map<string, QuerySubHandle>()
  const pendingMutations = new Map<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>()
  const tabId =
    (typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)) + '-'
  let subSeq = 0
  let mutSeq = 0

  const off = transport.onMessage((msg) => {
    if (msg.type === Msg.QueryPatch) {
      mirror.applyQueryPatch(msg.subId, msg.status, msg.patch, msg.error)
    } else if (msg.type === Msg.EntityPatch) {
      mirror.applyEntityPatches(msg.patches)
    } else if (msg.type === Msg.MutateResult) {
      const p = pendingMutations.get(msg.mutId)
      if (p) {
        pendingMutations.delete(msg.mutId)
        if (msg.ok) p.resolve(msg.data)
        else p.reject(new Error(msg.error?.message ?? 'mutation failed'))
      }
    }
  })

  function subscribeQuery(defName: string, key: readonly unknown[], args: unknown): QuerySubHandle {
    const hash = hashKey(key)
    const existing = byKey.get(hash)
    if (existing) {
      if (existing.gcTimer !== null) {
        clearTimeout(existing.gcTimer)
        existing.gcTimer = null
      }
      existing.refCount++
      return existing
    }

    const subId = `${tabId}s${++subSeq}`
    const scope = effectScope(true)
    mirror.ensureQuery(subId)
    transport.send({ type: Msg.Subscribe, subId, defName, args })

    const handle: QuerySubHandle = {
      subId,
      refCount: 1,
      scope,
      gcTimer: null,
      fetchNextPage() {
        transport.send({ type: Msg.FetchNextPage, subId })
      },
      release() {
        handle.refCount--
        if (handle.refCount > 0) return
        handle.gcTimer = setTimeout(() => {
          byKey.delete(hash)
          transport.send({ type: Msg.Unsubscribe, subId })
          mirror.dropQuery(subId)
          scope.stop()
        }, staleSubGcMs)
      },
    }
    byKey.set(hash, handle)
    return handle
  }

  function mutate(defName: string, input: unknown): Promise<unknown> {
    const mutId = `${tabId}m${++mutSeq}`
    return new Promise((resolve, reject) => {
      pendingMutations.set(mutId, { resolve, reject })
      transport.send({ type: Msg.Mutate, mutId, defName, input })
    })
  }

  function dispose(): void {
    off()
    for (const h of byKey.values()) h.scope.stop()
    byKey.clear()
  }

  return { mirror, transport, subscribeQuery, mutate, dispose }
}
