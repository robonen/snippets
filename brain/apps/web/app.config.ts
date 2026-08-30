import vue from '@vitejs/plugin-vue';
import tailwind from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { defineLayerConfig } from 'vite-layers';

/**
 * Оболочка — верхний слой стека; модули лежат под ней в порядке `extends`.
 *
 * Что это даёт сверх pnpm-workspace:
 *
 * 1. **Флаги фич выпиливают модуль из бандла.** `feature('finance')` —
 *    компайл-тайм макрос, а не рантайм-проверка: выключенный модуль не
 *    «перестаёт роутиться», его чанк не эмитится вовсе. Раньше все модули
 *    ехали в сборку всегда, и цена набора росла монотонно.
 * 2. **Файл модуля можно перекрыть, не трогая модуль.** Свой экран кладётся
 *    по тому же относительному пути слоем выше; базовый достаётся через
 *    `#super`. Форк ради одной правки больше не нужен.
 *
 * Порядок в `extends` — это приоритет резолва `@/…` (слева выше). Модули
 * занимают непересекающиеся пути, поэтому порядок здесь про предсказуемость,
 * а не про конфликты.
 */
export default defineLayerConfig({
  name: 'web',

  extends: [
    '../../modules/notes',
    '../../modules/tasks',
    '../../modules/kcal',
    '../../modules/bookmarks',
    '../../modules/finance',
  ],

  /**
   * Ключи объявляются ЗДЕСЬ, в базе, все сразу: флаг, существующий только в
   * `$env`-блоке, неизвестен в dev и валит сборку на первом же обращении.
   */
  features: {
    notes: true,
    tasks: true,
    kcal: true,
    bookmarks: true,
    finance: true,
  },

  vite: {
    plugins: [
      vue(),
      tailwind(),
      /**
       * Офлайн-оболочка: local-first без холодного старта офлайн — декларация.
       * Прекэш по хэшам сборки, `index.html` как navigation fallback; манифест
       * остаётся рукописным в public/ (share_target и иконки — там).
       */
      ...VitePWA({
        registerType: 'autoUpdate',
        manifest: false,
        // Иконки и фавикон — в прекэш: установленное приложение офлайн
        // не должно терять лицо.
        includeAssets: ['favicon.svg', '*.png'],
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
          navigateFallback: '/index.html',
          // Кадры синка и админ-ручки не перехватываются воркером.
          navigateFallbackDenylist: [/^\/sync/, /^\/lands/],
          // Прекэш прошлых сборок не копится: новая версия воркера чистит старые.
          cleanupOutdatedCaches: true,
        },
      }),
    ],
    server: {
      fs: {
        // Пакеты @sync подключены симлинками из соседнего репозитория — за корнем.
        allow: ['../..', '../../../sync-crdt'],
      },
      /**
       * Единый origin в dev: вкладка открыта на порту vite, а `/sync` (WS) и
       * `/lands` (админ-ручка отзыва) уходят на сервер синка так, будто он и
       * есть текущий origin. `4877` — порт сервера по умолчанию
       * (`runtimeConfig` в `apps/server/nitro.config.ts`).
       */
      proxy: {
        '/sync': { target: 'http://localhost:4877', ws: true },
        '/lands': { target: 'http://localhost:4877' },
      },
    },
    optimizeDeps: {
      // Пакеты workspace отдают ИСХОДНИКИ (`exports` → `src/index.ts`), а не dist.
      // Пребандлер на esbuild разбирать `.vue` не умеет и роняет dev-сервер
      // «Install @vitejs/plugin-vue»; пусть они идут обычным конвейером Vite.
      exclude: ['@brain/ui', '@brain/kcal', '@brain/module-kit', '@brain/std', '@brain/auth'],
    },
    resolve: {
      // Кит и @sync/vue подключены симлинками: без dedupe их импорт `vue` уходит
      // в собственную копию, в бандле оказываются две Vue, и mount падает на
      // чужом appContext.
      dedupe: ['vue'],
    },
    build: {
      rollupOptions: {
        output: {
          /**
           * Вендоры отдельными чанками — это про КЭШ, а не про парсинг: код
           * оболочки меняется каждый релиз, Vue и ядро — раз в месяц.
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
    define: {
      __VUE_OPTIONS_API__: 'false',
      __VUE_PROD_DEVTOOLS__: 'false',
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
    },
  },

  tsConfig: {
    compilerOptions: {
      types: ['vite/client', 'node', 'vite-plugin-pwa/client'],
    },
  },
});
