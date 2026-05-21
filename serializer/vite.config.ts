import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { DevTools } from '@vitejs/devtools';
import { serializerCodegen } from './plugin/compile/vite.ts';

/**
 * Vite config for the example app at `src/main.ts`.
 *
 * Two things wired up:
 *
 * 1. **Path alias** — `@perf/serializer` resolves to `./plugin/index.ts`.
 *    The example code (and any consumer) writes `from '@perf/serializer'`
 *    without ever touching relative paths.
 *
 * 2. **Compile-only AOT plugin** — every `type(...)` and `oneOf(...)` call
 *    found in the source is replaced at build time with an inline codec
 *    literal. The runtime never calls `new Function`. CSP-safe, tree-shakeable,
 *    no first-call warmup.
 */
export default defineConfig({
  devtools: {
    enabled: true,
  },
  build: {
    rolldownOptions: {
      devtools: {}, // enable devtools mode
    },
  },
  resolve: {
    alias: {
      '@perf/serializer': fileURLToPath(new URL('./plugin/index.ts', import.meta.url)),
    },
  },
  plugins: [serializerCodegen(), DevTools()],
});
