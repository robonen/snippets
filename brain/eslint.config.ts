import { base, compose, imports, stylistic, typescript, vitest, vue } from '@robonen/eslint';

export default compose(
  {
    name: 'brain/ignores',
    // `.vite-layers` — сгенерированные tsconfig и типы фич: их пишет плагин,
    // и правки в них живут до следующего запуска dev-сервера.
    ignores: ['**/dist/**', '**/.output/**', '**/.vercel/**', '**/node_modules/**', '**/.vite-layers/**'],
  },
  base,
  typescript,
  imports,
  stylistic,
  vitest,
  vue,
);
