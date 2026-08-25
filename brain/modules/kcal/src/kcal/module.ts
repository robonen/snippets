import { defineModule } from '@brain/module-kit';
import { Apple } from 'lucide-vue-next';

import type { Space } from '@sync/core';
import { KcalModel, readFood, writeFood } from './db/models';
import { SEED_FOODS } from './db/seed';
import { SECTIONS, requestSection } from './screens/section';
import DiaryScreen from './screens/diary/DiaryScreen.vue';
import TodayWidget from './widgets/TodayWidget.vue';

/**
 * Дневник питания как модуль brain.
 *
 * Адрес ленда НЕ объявляется здесь: он чеканится китом из имени `kcal` и
 * совпадает с тем, с которым дневник уже живёт отдельным приложением. Поэтому
 * переезд данных — не переливка, а открытие того же ленда: бэкапом, серверным
 * синком или переносом из старой базы.
 */
export const kcalModule = defineModule({
  id: 'kcal',
  title: 'Ккал',
  icon: Apple,
  land: { root: 'kcal/root', seed: fillIfEmpty },
  routes: [
    { path: '', name: 'kcal:diary', component: DiaryScreen },
    { path: 'foods', name: 'kcal:foods', component: () => import('./screens/foods/FoodsScreen.vue') },
    { path: 'stats', name: 'kcal:stats', component: () => import('./screens/stats/StatsScreen.vue') },
    { path: 'profile', name: 'kcal:profile', component: () => import('./screens/profile/ProfileScreen.vue') },
  ],
  widgets: [
    { id: 'today', title: 'Питание сегодня', component: TodayWidget, order: 30 },
  ],
  /**
   * По команде на раздел. Сам переход делает не команда, а экран: `run` получает
   * пространство модуля, но не роутер (`ModuleContext`), и придумывать себе
   * навигацию мимо контракта модуль не станет — он оставляет заявку.
   */
  commands: SECTIONS.map(section => ({
    id: section.id,
    title: `Ккал: ${section.title.toLocaleLowerCase('ru')}`,
    keywords: ['еда', 'ккал', section.title.toLocaleLowerCase('ru')],
    run: () => {
      requestSection(section.id);
    },
  })),
  /**
   * Поиск по каталогу, а не по записям дневника: запись — это «съел вчера
   * гречку», её ищут глазами в нужном дне. Продукт же ищут, чтобы добавить, и
   * попадание в палитру экономит переход.
   */
  search: ({ space }, query) => {
    const text = query.trim().toLowerCase();
    if (text === '') return [];
    const root = space.root(KcalModel);
    return root.foods.keys()
      .map(id => readFood(id, root.foods(id)))
      .filter(food => food.name.toLowerCase().includes(text))
      .slice(0, 8)
      .map(food => ({
        id: food.id,
        title: food.name,
        subtitle: `${food.kcal} ккал · ${food.category}`,
        to: { name: 'kcal:foods' },
      }));
  },
});

/**
 * Пустой ленд засевается стартовым каталогом продуктов — один раз.
 * Повторного посева не случится: ленд уже не пуст.
 */
function fillIfEmpty(space: Space): void {
  const root = space.root(KcalModel);
  if (root.foods.size() > 0 || root.entries.size() > 0 || root.$.exists()) return;

  space.edit(() => {
    for (const food of SEED_FOODS) writeFood(root.foods(food.id), food);
  });
}
