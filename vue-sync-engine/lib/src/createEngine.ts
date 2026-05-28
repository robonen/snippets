import type { App } from 'vue'
import type { EntityDef, InfiniteQueryDef, MutationDef, QueryDef } from './core/types'
import type { StorageAdapter } from './adapters/storageAdapter'
import { memoryAdapter } from './adapters/storageAdapter'
import { createInlineTransport } from './transport/InlineTransport'
import { createQueryGraph } from './worker/queryGraph'
import type { ServerEndpoint, Transport } from './transport/protocol'
import { createMirror } from './tab/mirror'
import { createTabRuntime, type TabRuntime } from './tab/runtime'
import { EngineKey } from './composables/useEngine'
import { setupSyncEngineDevtools } from './devtools'
import { DEV } from './__dev'

export interface WorkerBootstrapOptions {
  entities: ReadonlyArray<EntityDef>
  queries: ReadonlyArray<(QueryDef | InfiniteQueryDef) & { name: string }>
  mutations: ReadonlyArray<MutationDef>
  storage: StorageAdapter
  endpoint: ServerEndpoint
  defaultStaleTime?: number
  defaultGcTime?: number
}

export function bootstrapWorker(opts: WorkerBootstrapOptions): void {
  const registry = {
    entities: new Map(opts.entities.map((e) => [e.name, e])),
    queries: new Map(opts.queries.map((q) => [q.name, q])),
    mutations: new Map(opts.mutations.map((m) => [m.name, m])),
  }
  createQueryGraph({
    storage: opts.storage,
    endpoint: opts.endpoint,
    registry,
    defaultStaleTime: opts.defaultStaleTime,
    defaultGcTime: opts.defaultGcTime,
  })
}

export interface TabEngineOptions {
  transport: Transport
  staleSubGcMs?: number
}

export function createTabEngine(opts: TabEngineOptions): TabRuntime {
  const mirror = createMirror()
  return createTabRuntime({ transport: opts.transport, mirror, staleSubGcMs: opts.staleSubGcMs })
}

export interface EngineOptions {
  entities: ReadonlyArray<EntityDef>
  queries: ReadonlyArray<(QueryDef | InfiniteQueryDef) & { name: string }>
  mutations: ReadonlyArray<MutationDef>
  storage?: StorageAdapter
  defaultStaleTime?: number
  defaultGcTime?: number
}

export function createEngine(opts: EngineOptions): TabRuntime {
  const storage = opts.storage ?? memoryAdapter()
  const { client, server } = createInlineTransport()
  bootstrapWorker({
    entities: opts.entities,
    queries: opts.queries,
    mutations: opts.mutations,
    storage,
    endpoint: server,
    defaultStaleTime: opts.defaultStaleTime,
    defaultGcTime: opts.defaultGcTime,
  })
  return createTabEngine({ transport: client })
}

export interface InstallEngineOptions {
  /**
   * Cache defaults used by the worker. They live on the worker side and are
   * not part of the wire protocol, so the tab cannot read them on its own —
   * pass the same values you gave to `bootstrapWorker` / `createEngine` here
   * to surface them in the DevTools panel.
   */
  defaults?: { staleTime?: number; gcTime?: number }
}

export function installEngine(app: App, runtime: TabRuntime, opts?: InstallEngineOptions): void {
  app.provide(EngineKey, runtime)
  if (DEV) setupSyncEngineDevtools(app, runtime, opts)
}
