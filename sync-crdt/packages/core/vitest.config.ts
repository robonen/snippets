import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Браузерные файлы едут только в `test:browser`: в Node у них нет ни
    // IndexedDB, ни того, ради чего они написаны. Явное исключение, а не
    // «упадёт и ладно»: тест, который не может выполниться, обязан не
    // запускаться, а не краснеть по обстоятельствам среды.
    exclude: ['**/node_modules/**', '**/dist/**', 'src/**/*.browser.test.ts'],
    globals: false,
    environment: 'node',
    // Тесты типов — часть набора, а не бонус (PRINCIPLES, «Типы»). Без этой
    // строки `expectTypeOf` и `@ts-expect-error` проверял бы только `pnpm
    // typecheck`, то есть другой гейт и другой прогон: зелёный `pnpm test` при
    // сломанном выводе типов — ровно тот случай, когда гейт есть, а красным не
    // становится никогда.
    typecheck: {
      enabled: true,
      include: ['src/**/*.test-d.ts'],
      tsconfig: './tsconfig.json',
    },
  },
})
