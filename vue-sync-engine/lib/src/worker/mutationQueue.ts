import type { StorageAdapter } from '../adapters/storageAdapter'
import type { EntityPatch, MutationDef, OptimisticCtx, QueuedMutation } from '../core/types'
import { DEV } from '../__dev'

export interface MutationQueueDeps {
  storage: StorageAdapter
  mutations: Map<string, MutationDef>
  emitEntityPatches: (patches: EntityPatch[]) => void
  buildCtx: (forward: EntityPatch[], inverse: EntityPatch[]) => OptimisticCtx
  buildPostCtx: (post: EntityPatch[]) => OptimisticCtx
  invalidate: (def: MutationDef, input: unknown, resp: unknown) => void
  isOnline: () => boolean
  onOnline: (cb: () => void) => () => void
  onResult: (mutId: string, ok: boolean, data?: unknown, error?: { message: string }) => void
}

interface InMemoryEntry {
  queued: QueuedMutation
  inverse: EntityPatch[]
}

export function createMutationQueue(deps: MutationQueueDeps) {
  let seq = 0
  const inflight = new Map<string, InMemoryEntry>()
  let processing = false

  function persist(m: QueuedMutation): Promise<void> {
    return deps.storage.mutations.write([{ key: m.id, value: m }])
  }

  async function init(): Promise<void> {
    const persisted = await deps.storage.mutations.readAll()
    for (const m of persisted) {
      if (m.seq > seq) seq = m.seq
      inflight.set(m.id, { queued: m, inverse: m.inversePatches ?? [] })
    }
    void drain()
    deps.onOnline(() => void drain())
  }

  async function enqueue(mutId: string, defName: string, input: unknown): Promise<void> {
    const def = deps.mutations.get(defName)
    if (!def) {
      if (DEV) {
        deps.onResult(mutId, false, undefined, { message: `Unknown mutation: ${defName}` })
      }
      return
    }

    const forward: EntityPatch[] = []
    const inverse: EntityPatch[] = []
    if (def.optimistic) {
      def.optimistic(input, deps.buildCtx(forward, inverse))
      if (forward.length) deps.emitEntityPatches(forward)
    }

    const queued: QueuedMutation = {
      id: mutId,
      seq: ++seq,
      name: defName,
      input,
      inversePatches: inverse,
      createdAt: Date.now(),
      attempts: 0,
      state: 'pending',
    }
    await persist(queued)
    inflight.set(mutId, { queued, inverse })
    void drain()
  }

  async function drain(): Promise<void> {
    if (processing) return
    processing = true
    try {
      const ordered = [...inflight.values()].sort((a, b) => a.queued.seq - b.queued.seq)
      for (const entry of ordered) {
        if (!deps.isOnline()) break
        if (entry.queued.state === 'inflight') continue
        await runOne(entry)
      }
    } finally {
      processing = false
    }
  }

  async function runOne(entry: InMemoryEntry): Promise<void> {
    const def = deps.mutations.get(entry.queued.name)
    if (!def) {
      inflight.delete(entry.queued.id)
      await deps.storage.mutations.delete(entry.queued.id)
      return
    }
    entry.queued.state = 'inflight'
    entry.queued.attempts++
    await persist(entry.queued)
    const ctrl = new AbortController()
    try {
      const resp = await def.fetch(entry.queued.input, { signal: ctrl.signal })
      if (def.onSuccess) {
        const post: EntityPatch[] = []
        def.onSuccess(resp, entry.queued.input, deps.buildPostCtx(post))
        if (post.length) deps.emitEntityPatches(post)
      }
      deps.invalidate(def, entry.queued.input, resp)
      inflight.delete(entry.queued.id)
      await deps.storage.mutations.delete(entry.queued.id)
      deps.onResult(entry.queued.id, true, resp)
    } catch (err) {
      const networkLike = !deps.isOnline() || isNetworkError(err)
      if (networkLike && entry.queued.attempts < (def.maxRetries ?? 5)) {
        entry.queued.state = 'pending'
        await persist(entry.queued)
        return
      }
      if (entry.inverse.length) {
        // Build the reversed rollback list in one pass — avoids the
        // spread+reverse double-allocation on the error path. Push into a
        // fresh packed array (not `new Array(n)`, which V8 marks HOLEY).
        const inv = entry.inverse
        const reversed: EntityPatch[] = []
        for (let i = inv.length - 1; i >= 0; i--) reversed.push(inv[i])
        deps.emitEntityPatches(reversed)
      }
      inflight.delete(entry.queued.id)
      await deps.storage.mutations.delete(entry.queued.id)
      deps.onResult(entry.queued.id, false, undefined, { message: (err as Error)?.message ?? String(err) })
    }
  }

  return { init, enqueue, drain }
}

function isNetworkError(err: unknown): boolean {
  const msg = (err as Error)?.message?.toLowerCase() ?? ''
  return msg.includes('network') || msg.includes('fetch') || msg.includes('failed to fetch')
}
