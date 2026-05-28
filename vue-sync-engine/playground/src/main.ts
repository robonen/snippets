import { createApp } from 'vue'
import App from './App.vue'
import {
  createTabEngine,
  createSharedWorkerClientTransport,
  installEngine,
  // createEngine,
  // indexedDBAdapter,
} from 'vue-sync-engine'
// import registry from 'virtual:sync-engine-registry'

// ─────────────────────────────────────────────────────────────────────────────
// Variant A — SharedWorker (cross-tab shared state, active)
//
// QueryGraph + storage live in a single SharedWorker that all tabs talk to via
// MessagePort. Fetches are deduplicated across tabs, IndexedDB is opened once,
// and the DevTools "Tabs" node shows every connected tab as a sibling.
// ─────────────────────────────────────────────────────────────────────────────
const worker = new SharedWorker(new URL('./engine.worker.ts', import.meta.url), {
  type: 'module',
  name: 'vue-sync-engine',
})

const engine = createTabEngine({
  transport: createSharedWorkerClientTransport(worker),
})

const app = createApp(App)
installEngine(app, engine)
app.mount('#app')

// ─────────────────────────────────────────────────────────────────────────────
// Variant B — Inline, no worker (single-tab in-process, disabled)
//
// QueryGraph runs in the same thread as the UI via createInlineTransport.
// Same auto-discovered registry as the worker variant (the syncEnginePlugin in
// vite.config.ts is registered for the main bundle too), so adding a new
// *.defs.ts file just works. Trade-off vs. variant A: each tab keeps its own
// cache and refetches independently, and all defs are bundled into the main
// chunk instead of the worker chunk.
//
// To switch: delete variant A above, uncomment the engine/registry imports at
// the top, and uncomment the block below.
// ─────────────────────────────────────────────────────────────────────────────
// const engine = createEngine({
//   ...registry,
//   // engine-level KV store for QuerySnapshot + queued mutations.
//   // Omit to use memoryAdapter() (no persistence across reloads).
//   storage: indexedDBAdapter({ dbName: 'demo-sync-engine' }),
//   defaultStaleTime: 30_000,
//   defaultGcTime: 300_000,
// })
//
// const app = createApp(App)
// installEngine(app, engine, { defaults: { staleTime: 30_000, gcTime: 300_000 } })
// app.mount('#app')
