import { defineConfig } from 'tsdown'

/**
 * Library build for publishing. In this repo dev stays **buildless** — the example apps and tests
 * import `../src/*` directly, and the package's top-level `exports` point at `./src/*.ts`. This build
 * produces the `dist/` that `publishConfig.exports` points at (see package.json), so consumers get
 * compiled ESM + `.d.ts` while local development keeps running straight off source.
 *
 * One entry per public subpath (`.`, `./feature`, `./devtools`). All runtime deps and the `vite` /
 * `@vitejs/devtools-kit` peers are externalized automatically (tsdown externalizes dependencies and
 * peerDependencies), so only vite-layers' own code is bundled.
 */
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    feature: 'src/feature.ts',
    devtools: 'src/devtools.ts',
  },
  format: 'esm',
  platform: 'node',
  target: 'node24',
  dts: true,
  sourcemap: true,
  clean: true,
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  publint: 'ci-only',
})
