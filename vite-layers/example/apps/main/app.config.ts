import vue from '@vitejs/plugin-vue'
import { defineLayerConfig } from '../../../src/index.ts'

export default defineLayerConfig({
  name: 'main',
  features: { billing: true, p2p: true },
  // The framework plugin lives in the layer config, not in vite-layers' core.
  vite: {
    plugins: [vue()],
    build: { rolldownOptions: { input: { main: '@/main.ts' } } },
  },
  // Per-layer tsconfig tweaks (merged across the stack, like Nuxt's typescript.tsConfig).
  tsConfig: { compilerOptions: { jsx: 'preserve', jsxImportSource: 'vue' } },

  $production: {
    features: { p2p: false },
  }
})
