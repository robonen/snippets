import type { NitroConfig } from 'nitro/types';

/**
 * Сервер синка — отдельный nitro-проект, а не часть сборки оболочки.
 *
 * У kcal сервер жил внутри vite-приложения и собирался Vercel-пресетом. Здесь
 * пресет НЕ vercel, и это решение, а не пропуск: сервер стоит на своём железе
 * (docs/04-server.md), собирается штатным `nitro build` в node-server и
 * запускается `node .output/server/index.mjs` — без платформенной обвязки,
 * эфемерных ФС и лимитов на время соединения.
 */
const config: NitroConfig = {
  // Наш проект и есть сервер: routes/ и utils/ лежат в корне пакета,
  // а не в подкаталоге server/ (тот же приём, что в kcal).
  serverDir: '.',
  compatibilityDate: '2026-08-24',
  features: {
    // Живой транспорт: один WebSocket на все ленды (routes/sync/index.ts).
    websocket: true,
  },
  /**
   * Единый origin (план Р1): сервер отдаёт СОБРАННУЮ PWA, а не только API.
   * HttpOnly-cookie и rpId passkey живут только при одном origin — раздельные
   * дев-порты web/server работали бы для API, но не для входа.
   *
   * `dir` — это `apps/web/dist/web`, СОБРАННЫЙ соседним `vite build`
   * (`pnpm --filter @brain/web build`, гейт запускает его ДО `--filter
   * @brain/server build`). Не `apps/web/dist` — vite-layers кладёт сборку в
   * подкаталог по имени СЛОЯ (`defineLayerConfig({ name: 'web' })` в
   * `apps/web/app.config.ts`), то есть `dist/web/index.html`, а не
   * `dist/index.html` (проверено самой сборкой, не документацией). nitro
   * копирует содержимое в `.output/public` на своей сборке — собранный сервер
   * самодостаточен, `apps/web/dist` ему рядом уже не нужен (docs/04-server.md
   * «Запуск на своём сервере»).
   *
   * `maxAge` — скромные 5 минут, а не год: у файлов сборки нет сервис-воркера,
   * который умел бы починить протухший кэш сам, а имена без хеша (`index.html`,
   * `manifest.webmanifest`) переживают передеплой раньше, чем истечёт кэш
   * браузера. Короткий кэш — компромисс, а не то, чем стоило бы гордиться.
   */
  publicAssets: [
    { baseURL: '/', dir: '../web/dist/web', maxAge: 300 },
  ],
};

export default config;
