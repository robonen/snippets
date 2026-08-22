import { defineConfig } from 'tsdown'

/**
 * Сборка точки входа бенчей — отдельная от пакетной (`tsdown.config.ts`), и
 * отличается она ровно одним: бандл обязан быть САМОДОСТАТОЧНЫМ.
 *
 * Пакетная сборка правильно оставляет зависимости внешними — их разрешает
 * бандлер потребителя. Но бенч грузится ещё и в Chromium (`bench/cross.mjs`), а
 * у страницы разрешателя нет: голый спецификатор в бандле — это `TypeError:
 * Failed to resolve module specifier`, после которого весь кросс-движковый
 * раздел уходит в `skipped`. Так и случилось на S4: `Land` держит сигналы на
 * `RefNode` из `@sync/fiber`, спецификатор попал в бандл — и двухдвижковый гейт
 * правила 2 перестал работать НЕ ТОЛЬКО для ленда, а для всех разделов сразу,
 * включая бюджеты S2, которые до того в Chromium проходили.
 *
 * Проверяется это не глазами: `bench/cross.mjs` падает в `skipped` с текстом
 * причины, а `budgets.json` хранит `cross_runtime_ns.skipped`.
 */
export default defineConfig({
  entry: { entry: 'bench/entry.ts' },
  outDir: 'bench/dist',
  format: ['esm'],
  platform: 'neutral',
  target: 'es2022',
  logLevel: 'warn',
  dts: true,
  treeshake: true,
  deps: { alwaysBundle: [/^@sync\//, /^alien-signals(\/|$)/] },
})
