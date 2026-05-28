import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    plugin: 'src/plugin.ts',
    devtools: 'src/devtools.ts',
  },
  format: ['esm'],
  platform: 'neutral',
  target: 'es2022',
  dts: true,
  clean: true,
  treeshake: true,
  sourcemap: true,
  deps: {
    neverBundle: ['virtual:sync-engine-registry'],
  },
})
