/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import { playwright } from '@vitest/browser-playwright'
import { syncEnginePlugin } from './src/plugin'

export default defineConfig({
  // The lib's own DevTools setup does `import('virtual:sync-engine-registry')`;
  // register the plugin (with no matching defs in lib/) so Vite can resolve
  // the virtual module to an empty registry instead of throwing at transform.
  plugins: [syncEnginePlugin({ definitions: ['/lib/**/*.defs.ts'] })],
  define: {
    __VUE_OPTIONS_API__: 'true',
    __VUE_PROD_DEVTOOLS__: 'false',
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
    // Enable dev-only assertions and DevTools branches in the lib source.
    __SYNC_ENGINE_DEV__: 'true',
  },
  test: {
    include: ['src/**/*.{test,spec}.ts'],
    globals: false,
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      screenshotFailures: false,
      instances: [{ browser: 'chromium' }],
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/__tests__/**',
        'src/index.ts',
        'src/__dev.ts',
        'src/core/types.ts',
        'src/core/keyedStore.ts',
        'src/transport/protocol.ts',
        'src/devtools.ts',
      ],
      reporter: ['text', 'html'],
      thresholds: {
        statements: 90,
        branches: 75,
        functions: 90,
        lines: 95,
      },
    },
  },
})
