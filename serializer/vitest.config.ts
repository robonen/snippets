import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Standalone config — don't search upward for vite.config in parent dirs.
  configFile: false,
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globals: false,
    benchmark: {
      include: ['test/**/*.bench.ts'],
    },
  },
});
