import { feature } from '#feature';
import type { BrainModule } from '@brain/module-kit';

/**
 * Состав приложения.
 *
 * `feature()` — КОМПАЙЛ-ТАЙМ макрос: плагин подставляет литерал флага, и ветка
 * выключенного модуля становится статически мёртвой. Выключенный модуль не
 * «перестаёт роутиться» — его чанк не эмитится вовсе, вместе со всеми моделями
 * и экранами. Раньше все модули ехали в бандл всегда, и цена набора росла
 * монотонно, хотя пользуются обычно двумя-тремя.
 *
 * Импорты динамические именно поэтому: статический `import` остался бы в
 * графе, и выпиливать было бы нечего. Порядок массива — порядок вкладок.
 */
export async function loadModules(): Promise<BrainModule[]> {
  const loaded = await Promise.all([
    feature('notes') ? import('@/notes/module').then(m => m.notesModule) : null,
    feature('tasks') ? import('@/tasks/module').then(m => m.tasksModule) : null,
    feature('kcal') ? import('@/kcal/module').then(m => m.kcalModule) : null,
    feature('bookmarks') ? import('@/bookmarks/module').then(m => m.bookmarksModule) : null,
    feature('projects') ? import('@/projects/module').then(m => m.projectsModule) : null,
  ]);
  return loaded.filter((module): module is BrainModule => module !== null);
}
