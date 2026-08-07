/// <reference types="node" />
import { defineConfig } from 'vitest/config';
import vueJsxVapor from 'vue-jsx-vapor/vite';
import tailwindcss from '@tailwindcss/vite';
import { syncEnginePlugin } from 'vue-sync-engine/plugin';

// JSX компилируется сразу в Vapor-код (без interop и virtual DOM).
// Tailwind v4 подключён как Vite-плагин, конфиг живёт в src/app.css (@theme).
// syncEnginePlugin собирает дефы в virtual:sync-engine-registry — его требует
// DevTools-ветка движка в dev-режиме.
export default defineConfig({
  plugins: [vueJsxVapor(), tailwindcss(), syncEnginePlugin({ definitions: ['/src/data/defs.ts'] })],
  resolve: {
    // vue-sync-engine подключён симлинком (link:), поэтому его импорты `vue`
    // уходят в собственную vue из devDependencies движка. Без dedupe в бандл
    // попадают две копии Vue и mount падает на чужом appContext.
    dedupe: ['vue'],
  },
  optimizeDeps: {
    // Движок ходит в virtual-модуль — пребандл прятал бы его от плагина.
    exclude: ['vue-sync-engine'],
  },
  define: {
    __VUE_OPTIONS_API__: 'false',
    __VUE_PROD_DEVTOOLS__: 'false',
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
    // Dev-ветки vue-sync-engine (DevTools-панель) остаются в `vite dev`,
    // вырезаются из прод-сборки.
    __SYNC_ENGINE_DEV__: JSON.stringify(process.env.NODE_ENV !== 'production'),
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
