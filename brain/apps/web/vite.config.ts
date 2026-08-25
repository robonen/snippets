// Собранная точка входа, а не пакетный спецификатор: `exports` пакета ведёт на
// `src/index.ts`, а его внутренние импорты безрасширенные (`./config`), и
// нативный ESM-загрузчик Node, которым Vite читает этот файл, такое не резолвит.
// Остальные конфиги слоёв грузит сам vite-layers через jiti — им спецификатор
// подходит. Когда `exports` в vite-layers будет указывать на сборку, эта
// строка станет обычным `from 'vite-layers'`.
import { buildViteConfig } from '../../../vite-layers/dist/index.js';

/**
 * Весь конфиг живёт в `app.config.ts` — здесь только сборка стека слоёв.
 */
export default buildViteConfig(import.meta.dirname);
