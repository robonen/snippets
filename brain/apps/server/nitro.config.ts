import { defineConfig } from 'nitro/config';

/**
 * Сервер синка — отдельный nitro-проект, а не часть сборки оболочки.
 *
 * Пресет НЕ vercel, и это решение, а не пропуск: сервер стоит на своём железе
 * (docs/04-server.md), собирается штатным `nitro build` в node-server и
 * запускается `node .output/server/index.mjs` — без платформенной обвязки,
 * эфемерных ФС и лимитов на время соединения.
 */
export default defineConfig({
  // Наш проект и есть сервер: routes/ и utils/ лежат в корне пакета.
  serverDir: '.',
  compatibilityDate: '2026-08-25',
  features: {
    // Живой транспорт: один WebSocket на все ленды (routes/sync.ts).
    websocket: true,
  },

  /**
   * Конфигурация рантайма — через штатный runtimeConfig: значения ниже это
   * умолчания, на рантайме их переопределяет окружение. `envPrefix: ''`
   * оставляет ПЛОСКИЕ имена переменных (`SYNC_TOKEN`, `DATA_DIR`,
   * `PUBLIC_ORIGIN` — как в docs/04 и systemd-юните); `NITRO_`-префикс
   * работает как второй путь сам по себе.
   */
  runtimeConfig: {
    nitro: { envPrefix: '' },
    /** Общий секрет личного сервера. Пусто — сервер отказывает всем. */
    syncToken: '',
    /** Origin для сверки заголовка `Origin` на WS-рукопожатии. */
    publicOrigin: 'http://localhost:4877',
    /** Каталог данных для файлового хранилища. Пусто — маунт из `storage` ниже. */
    dataDir: '',
    /**
     * Продакшен-хранилище: Cloudflare KV по REST (`cloudflare-kv-http`).
     * Заполнены все три поля — плагин перемонтирует `data:` на KV.
     * Env: CLOUDFLARE_KV_ACCOUNT_ID, CLOUDFLARE_KV_NAMESPACE_ID,
     * CLOUDFLARE_KV_API_TOKEN (плоские имена — envPrefix выше).
     */
    cloudflareKv: {
      accountId: '',
      namespaceId: '',
      apiToken: '',
    },
  },

  /**
   * Данные сервера: образы лендов и пир — маунт `data:`. База по умолчанию
   * задаётся здесь (конфиг — build-time); рантаймовые значения — Cloudflare KV
   * или `DATA_DIR` — перемонтируют её в plugins/storage.ts: ровно
   * документированная схема «статичное в конфиге, секреты в плагине».
   */
  storage: {
    data: { driver: 'fs', base: './.data' },
  },
  devStorage: {
    data: { driver: 'fs', base: './.data-dev' },
  },

  /**
   * Единый origin: сервер отдаёт СОБРАННУЮ PWA, а не только API.
   *
   * `dir` — это `apps/web/dist/web`, собранный соседним `vite build`
   * (vite-layers кладёт сборку в подкаталог по имени слоя). nitro копирует
   * содержимое в `.output/public` на своей сборке — собранный сервер
   * самодостаточен.
   *
   * `maxAge` длинный: хешированные ассеты бессмертны по построению, а
   * `index.html` и файлы без хеша обслуживает service worker приложения —
   * протухший кэш чинит он, а не короткий TTL.
   */
  publicAssets: [
    { baseURL: '/', dir: '../web/dist/web', maxAge: 3600 },
  ],
});
