/// <reference types="node" />
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import VueDevTools from 'vite-plugin-vue-devtools'
import { syncEnginePlugin } from 'vue-sync-engine/plugin'

const enginePlugin = syncEnginePlugin({ definitions: ['/src/**/*.defs.ts'] })

export default defineConfig({
  plugins: [VueDevTools(), vue(), enginePlugin],
  worker: {
    plugins: () => [syncEnginePlugin({ definitions: ['/src/**/*.defs.ts'] })],
  },
  define: {
    __VUE_OPTIONS_API__: 'false',
    __VUE_PROD_DEVTOOLS__: 'false',
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
    // Strip dev-only assertions and DevTools setup in `vite build`; keep them
    // in `vite dev` so the Sync Engine panel works while developing.
    __SYNC_ENGINE_DEV__: JSON.stringify(process.env.NODE_ENV !== 'production'),
  },
})
