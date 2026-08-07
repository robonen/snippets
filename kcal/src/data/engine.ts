import { createEngine, indexedDBAdapter } from 'vue-sync-engine';
import { DB_NAME, allEntities, allMutations, allQueries, foodStore } from './defs';
import { SEED_FOODS } from './seed';

export const CACHE_DEFAULTS = {
  // Локальные чтения стоят миллисекунды — рефетчим при каждой подписке,
  // консистентность важнее экономии на readAll.
  staleTime: 0,
  gcTime: 10 * 60_000,
};

/** Наполняет каталог стартовым набором при первом запуске. */
export async function seedIfEmpty(): Promise<void> {
  const existing = await foodStore.readAll();
  if (existing.length > 0) return;
  await foodStore.write(SEED_FOODS.map(food => ({ key: food.id, value: food })));
}

/** Inline-движок: QueryGraph и Mirror в одном треде, снапшоты запросов — в idb. */
export function createKcalEngine() {
  return createEngine({
    entities: allEntities,
    queries: allQueries,
    mutations: allMutations,
    storage: indexedDBAdapter({ dbName: DB_NAME }),
    defaultStaleTime: CACHE_DEFAULTS.staleTime,
    defaultGcTime: CACHE_DEFAULTS.gcTime,
  });
}
