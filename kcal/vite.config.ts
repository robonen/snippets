/// <reference types="node" />
import { defineConfig } from 'vite';

import { nitro } from 'nitro/vite';
import vueJsxVapor from 'vue-jsx-vapor/vite';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// Куда nitro кладёт клиентскую статику. На Vercel пресет включается САМ по env
// `VERCEL` — переменной `NITRO_PRESET` там нет, и проверка только по ней молча
// уводила прекеш workbox в несуществующий `.output/public`.
const STATIC_DIR = process.env.NITRO_PRESET === 'vercel' || process.env.VERCEL
  ? '.vercel/output/static'
  : '.output/public';

// JSX компилируется сразу в Vapor-код (без interop и virtual DOM).
// Tailwind v4 подключён как Vite-плагин, конфиг живёт в src/app.css (@theme).
export default defineConfig({
  plugins: [
    vueJsxVapor(),
    tailwindcss(),
    // Сервер синхронизации живёт В ЭТОМ ЖЕ приложении (docs/server-sync.md):
    // nitro подхватывает server/routes, dev-сервер отдаёт и SPA, и /sync/:land,
    // а Vercel-пресет собирает статику и функции одним деплоем — роутинг между
    // ними генерирует сам пресет. У vitest свой конфиг без этого плагина.
    nitro(),
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
        // Прекеш собирается по СТАТИКЕ NITRO, а не по dist: клиентский бандл
        // nitro уносит в .output/public (Vercel — .vercel/output/static), и глоб
        // по dist давал бы sw.js с пустым манифестом — офлайн умирал бы молча.
        // Порядок надёжен: nitro собирает статику до генерации sw.js (поэтому
        // же существует scripts/copy-pwa.mjs — он и проверяет манифест).
        globDirectory: STATIC_DIR,
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
  server: {
    fs: {
      // Пакеты @sync подключены симлинками из соседнего репозитория — за корнем
      // проекта; без разрешения серверные роуты не могут загрузить их dist.
      allow: ['.', '../sync-crdt'],
    },
  },
  environments: {
    // Только БРАУЗЕРНОЕ окружение: серверному бандлу дробление вендоров не даёт
    // ничего (кэша по хэшам там нет), а на общем `build` оно применялось и к
    // функциям nitro — лишний риск в чужом окружении ради нулевой пользы.
    client: {
      build: {
        rollupOptions: {
          output: {
            /**
             * Вендоры — отдельными чанками, и это про КЭШ, а не про скорость парсинга:
             * PWA прекэширует ассеты по хэшам, и при каждом деплое пользователь
             * докачивает только изменившееся. Код приложения меняется каждый релиз,
             * Vue и ядро — раз в месяц; в одном чанке правка одной строки дневника
             * инвалидировала бы все 95 КБ, в раздельных — докачивается ~40.
             */
            codeSplitting: {
              groups: [
                { name: 'vue', test: /node_modules\/@?vue/, priority: 20 },
                { name: 'sync', test: /sync-crdt\/packages|alien-signals/, priority: 10 },
              ],
            },
          },
        },
      },
    },
  },
  resolve: {
    alias: { '@': new URL('./src', import.meta.url).pathname },
    // @sync/vue подключён симлинком (link:), поэтому его импорт `vue` ушёл бы в
    // собственную копию из node_modules пакета. Без dedupe в бандле две Vue, и
    // mount падает на чужом appContext.
    dedupe: ['vue'],
  },
  define: {
    __VUE_OPTIONS_API__: 'false',
    __VUE_PROD_DEVTOOLS__: 'false',
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
  },
  nitro: {
    // Серверные исходники — в `server/` (routes, utils дым-скриптов рядом).
    serverDir: './server',
    features: {
      // WebSocket-транспорт (server/routes/sync/[land].ts); HTTP-роут работает везде.
      websocket: true,
    },
    // Хранилище лендов: в dev — файлы, в бою — Redis (Vercel Marketplace).
    // Роуты ходят в useStorage('lands') и знают только про байты.
    storage: process.env.REDIS_URL
      ? { lands: { driver: 'redis', url: process.env.REDIS_URL, base: 'kcal' } }
      : { lands: { driver: 'fs', base: './server/.data/lands' } },
  },
});
