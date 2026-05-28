export * from './core/types'
export type { KeyedStore, KeyedStoreFactory } from './core/keyedStore'
export { hashKey, entityKey } from './core/queryKey'
export { Op, Status, Msg, Kind } from './core/flags'
export type { OpFlag, StatusFlag, MsgKind, KindFlag } from './core/flags'
export { defineEntity, defineQuery, defineInfiniteQuery, defineMutation } from './define'
export {
  createEngine,
  installEngine,
  bootstrapWorker,
  createTabEngine,
  type EngineOptions,
  type TabEngineOptions,
  type WorkerBootstrapOptions,
  type InstallEngineOptions,
} from './createEngine'
export { EngineKey, useEngine } from './composables/useEngine'
export { useQuery } from './composables/useQuery'
export { useInfiniteQuery } from './composables/useInfiniteQuery'
export { useEntity } from './composables/useEntity'
export { useMutation } from './composables/useMutation'
export type { StorageAdapter } from './adapters/storageAdapter'
export { memoryAdapter, indexedDBAdapter, type IndexedDBAdapterOptions } from './adapters/storageAdapter'
export { memoryStore, noopStore } from './adapters/memoryStore'
export { idbStore, type IdbStoreOptions } from './adapters/idbStore'
export { createInlineTransport } from './transport/InlineTransport'
export { createSharedWorkerClientTransport, createSharedWorkerServerEndpoint } from './transport/SharedWorkerTransport'
export type { Transport, ServerEndpoint, ClientMsg, ServerMsg } from './transport/protocol'
export { createMirror } from './tab/mirror'
export { createTabRuntime, type TabRuntime } from './tab/runtime'
export { createQueryGraph } from './worker/queryGraph'
// Subpath entries (kept out of the main bundle to avoid pulling Node-side
// Vite plugin code or Vue DevTools API into client bundles by default):
//   import { syncEnginePlugin } from 'vue-sync-engine/plugin'
//   import { setupSyncEngineDevtools } from 'vue-sync-engine/devtools'
export type { SyncEnginePluginOptions } from './plugin'
export type { SyncEngineDevtoolsOptions } from './devtools'
