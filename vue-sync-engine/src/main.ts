import { createApp } from 'vue'
import App from './App.vue'
import { createTabEngine, createSharedWorkerClientTransport, installEngine } from './engine'

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
