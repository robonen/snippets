import { defineLayerConfig } from 'vite-layers';

/**
 * Проекты как СЛОЙ: приложение наследует файлы модуля, и любой из них можно
 * перекрыть, положив свой по тому же пути слоем выше. `package.json` рядом —
 * ради резолва зависимостей и своих гейтов; слои и пакеты решают разные задачи.
 */
export default defineLayerConfig({
  name: 'projects',
});
