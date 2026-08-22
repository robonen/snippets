import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { index: 'src/index.ts', inspect: 'src/inspect.ts' },
  format: ['esm'],
  platform: 'neutral',
  target: 'es2022',
  dts: true,
  clean: true,
  treeshake: true,
  sourcemap: true,
})
