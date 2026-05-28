/// <reference types="vitest" />
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { syncEnginePlugin } from "./src/engine/plugin";

const enginePlugin = syncEnginePlugin({ definitions: ['/src/**/*.defs.ts'] });

export default defineConfig({
  plugins: [vue(), enginePlugin],
  worker: {
    plugins: () => [syncEnginePlugin({ definitions: ['/src/**/*.defs.ts'] })],
  },
  define: {
    __VUE_OPTIONS_API__: 'false',
    __VUE_PROD_DEVTOOLS__: 'false',
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
    __SYNC_ENGINE_DEV__: JSON.stringify(process.env.NODE_ENV !== 'production'),
  },
  test: {
    environment: "happy-dom",
    include: ["src/**/*.{test,spec}.ts"],
    globals: false,
  },
});
