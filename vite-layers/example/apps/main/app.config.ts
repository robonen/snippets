import vue from '@vitejs/plugin-vue'
import tailwind from '@tailwindcss/vite'
import { DevTools } from '@vitejs/devtools'
import { defineLayerConfig } from '../../../src/index.ts'

export default defineLayerConfig({
  name: 'main',
  // `billing` gates a whole page (build-time DCE); `betaBanner` toggles a UI accent and is
  // turned off in production via the `$production` env override below.
  features: { billing: true, betaBanner: true },

  // Framework + CSS plugins live in the layer config, not in vite-layers' core. Brands inherit them.
  // The Vite DevTools hub is added in dev only (`DevTools()` is async → a Promise<Plugin[]>, a valid
  // plugin entry); vite-layers auto-mounts its Layers / Features / Resolver / Public & TS panels into
  // it via `buildViteConfig`. Build output is untouched (the hub is excluded when command is 'build').
  vite: ({ command }) => ({
    plugins: [vue(), tailwind(), command === 'serve' && DevTools()],
    build: { rolldownOptions: { input: { main: '@/main.ts' } } },
  }),

  // Per-layer tsconfig tweaks (merged across the stack, like Nuxt's typescript.tsConfig).
  // `vite/client` supplies ambient module decls for the CSS side-effect imports (`*.css`) and
  // `import.meta.env`. It flows into every brand's generated app tsconfig too.
  tsConfig: { compilerOptions: { jsx: 'preserve', jsxImportSource: 'vue', types: ['vite/client'] } },

  $production: {
    features: { betaBanner: false }, // the beta accent never ships to prod
  },
})
