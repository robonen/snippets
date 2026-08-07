/// <reference types="node" />
import { defineConfig } from 'vitest/config';
import vueJsxVapor from 'vue-jsx-vapor/vite';
import tailwindcss from '@tailwindcss/vite';
import { syncEnginePlugin } from 'vue-sync-engine/plugin';
import { VitePWA } from 'vite-plugin-pwa';

// JSX компилируется сразу в Vapor-код (без interop и virtual DOM).
// Tailwind v4 подключён как Vite-плагин, конфиг живёт в src/app.css (@theme).
// syncEnginePlugin собирает дефы в virtual:sync-engine-registry — его требует
// DevTools-ветка движка в dev-режиме.
export default defineConfig({
  plugins: [
    vueJsxVapor(),
    tailwindcss(),
    syncEnginePlugin({ definitions: ['/src/data/defs.ts'] }),
    // Установка на домашний экран — единственный способ вывести IndexedDB
    // из-под 7-дневной очистки ITP в WebKit (Safari и Chrome на iOS).
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      // Иконки и <link>-теги берутся из pwa-assets.config.ts.
      pwaAssets: { config: true },
      manifest: {
        name: 'Ккал — дневник питания',
        short_name: 'Ккал',
        description: 'Локальный дневник питания: калории, БЖУ, вес. Данные хранятся только на устройстве.',
        lang: 'ru',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        theme_color: '#12100d',
        background_color: '#12100d',
      },
      workbox: {
        // woff тут дубли woff2 от fontsource — в прекеш идёт только woff2.
        globPatterns: ['**/*.{js,css,html,woff2,svg,png,ico}'],
        runtimeCaching: [
          // Распознавание штрихкодов на WebKit — ~1 МБ wasm. В прекеш его класть
          // жалко (нужен не всем), поэтому кэшируем после первого запуска
          // сканера: дальше он работает и офлайн. Файл с хэшем в имени, так что
          // CacheFirst безопасен.
          {
            urlPattern: /\.wasm$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'wasm',
              expiration: { maxEntries: 4 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Штрихкоды из Open Food Facts: сеть свежее, но офлайн отдаём кэш.
          {
            urlPattern: /^https:\/\/world\.openfoodfacts\.org\/.*/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'off-api',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
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
