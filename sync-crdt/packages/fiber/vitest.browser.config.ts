// Браузерный прогон: `pnpm --filter @sync/fiber test:browser`.
//
// ПОЧЕМУ отдельный конфиг, а не `projects` в основном: обычный `pnpm test`
// обязан остаться быстрым и чисто node'овым. В Chromium едет ровно один файл —
// тот, где заморожен ПОРЯДОК событий.
//
// У бинарного слоя предметом кросс-движковой сверки были байты. Здесь байтов
// нет, и сверять нечего, кроме порядка: ядро стоит на очереди микрозадач и на
// возобновлении после `throw Promise`. Планировщик специально не использует ни
// `WeakRef`, ни `FinalizationRegistry` — сборка идёт по достижимости в `flush`,
// — поэтому след обязан совпасть побуквенно, и любое расхождение движков это
// настоящая находка, а не шум тайминга.
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/cross-runtime.test.ts'],
    globals: false,
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      // Скриншот падения тесту про порядок событий не поможет.
      screenshotFailures: false,
      instances: [{ browser: 'chromium' }],
    },
  },
})
