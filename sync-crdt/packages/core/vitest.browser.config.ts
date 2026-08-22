// Браузерный прогон: `pnpm --filter @sync/core test:browser`.
//
// ПОЧЕМУ отдельный конфиг, а не `projects` в основном: обычный `pnpm test`
// обязан остаться быстрым и чисто node'овым (470 тестов, включая property-наборы
// на десятки тысяч прогонов — гонять их через мост в браузер бессмысленно).
// В Chromium едут файлы, у которых предмет проверки ЖИВЁТ в браузере:
//   • `cross-runtime.test.ts` — формат в двух движках побайтово один и тот же
//     (DoD S2, docs/11-roadmap.md);
//   • `*.browser.test.ts` — хранилище на IndexedDB (гейт S5). Подделка в Node
//     остаётся ускорителем основного набора, но гейт стадии обязан идти против
//     настоящей базы: транзакции, structured clone и цена записи есть только
//     здесь.
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/cross-runtime.test.ts', 'src/**/*.browser.test.ts'],
    globals: false,
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      // Скриншот падения тесту про байты не поможет, а тайм-аутов и мусора в
      // артефактах добавит.
      screenshotFailures: false,
      instances: [{ browser: 'chromium' }],
    },
  },
})
