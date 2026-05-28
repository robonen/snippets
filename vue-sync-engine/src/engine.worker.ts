import { bootstrapWorker, indexedDBAdapter, createSharedWorkerServerEndpoint } from './engine'
import registry from 'virtual:sync-engine-registry'

interface SharedWorkerScopeLike {
  onconnect: ((ev: { ports: readonly MessagePort[] }) => void) | null
}

bootstrapWorker({
  ...registry,
  storage: indexedDBAdapter({ dbName: 'demo-sync-engine' }),
  endpoint: createSharedWorkerServerEndpoint(self as unknown as SharedWorkerScopeLike),
})
