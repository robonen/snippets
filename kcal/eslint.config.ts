import { base, compose, imports, stylistic, typescript, vitest } from '@robonen/eslint';

export default compose(
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
