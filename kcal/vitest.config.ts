import { defineConfig } from 'vitest/config';

// Свой конфиг у vitest — намеренно, и это не только про типы. Общий vite.config
// несёт nitro-плагин (сервер синхронизации), которому в тестах делать нечего, а
// его ключ `nitro` дополняет UserConfig таким рекурсивным типом, что обёртка
// vitest/config складывала стек чекера (ts2321). Раздельные файлы решают оба
// вопроса без гейтов через переменные окружения.
export default defineConfig({
  resolve: {
    alias: { '@': new URL('./src', import.meta.url).pathname },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
