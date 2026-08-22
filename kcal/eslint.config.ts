import { base, compose, imports, stylistic, typescript, vitest } from '@robonen/eslint';

export default compose(
  {
    name: 'kcal/ignores',
    // Дымовые скрипты сервера: их вывод — и есть console.log, линтовать нечего.
    ignores: ['server/smoke.mjs', 'server/ws-smoke.mjs', 'server/.data/**', '.output/**', '.vercel/**', 'scripts/copy-pwa.mjs'],
  },
  base,
  typescript,
  imports,
  stylistic,
  vitest,
  {
    name: 'kcal/overrides',
    rules: {
      // Дефы движка и доменные расчёты плотно работают с числовыми литералами.
      'unicorn/no-zero-fractions': 'off',
    },
  },
);
