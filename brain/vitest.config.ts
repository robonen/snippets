import { defineConfig } from 'vitest/config';

/**
 * Один конфиг на весь workspace: тесты пакетов, модулей и оболочки лежат рядом
 * с кодом и гоняются одним прогоном.
 *
 * `dedupe` — тот же вопрос, что и в сборке: пакеты подключены симлинками, и без
 * него в прогоне оказываются две Vue, а компонент из кита монтируется в чужой
 * appContext.
 */
export default defineConfig({
  resolve: {
    dedupe: ['vue'],
  },
  test: {
    environment: 'node',
    include: [
      'packages/*/src/**/*.test.ts',
      'modules/*/src/**/*.test.ts',
      'apps/*/src/**/*.test.ts',
      // У сервера нет `src`: корень пакета и есть корень nitro (routes, utils).
      'apps/server/{routes,utils}/**/*.test.ts',
    ],
  },
});
