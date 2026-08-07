import { defineEntity, defineMutation, defineQuery, idbStore } from 'vue-sync-engine';
import type { Entry, Food, Profile, WeightLog } from '../domain/types';
import { PROFILE_ID } from '../domain/types';

/**
 * Бэкенда нет: источник истины — IndexedDB. Каждая сущность персистится в свой
 * object store базы `kcal`; query.fetch читает оттуда же, mutation.fetch туда же
 * пишет (и await'ит запись — поэтому рефетч после invalidate гарантированно
 * видит свежие данные). Optimistic-патчи дают мгновенный UI поверх этого.
 */
export const DB_NAME = 'kcal';

export const FoodEntity = defineEntity<Food>({
  name: 'food',
  id: food => food.id,
  storage: idbStore<Food>({ dbName: DB_NAME }),
});

export const EntryEntity = defineEntity<Entry>({
  name: 'entry',
  id: entry => entry.id,
  storage: idbStore<Entry>({ dbName: DB_NAME }),
});

export const WeightEntity = defineEntity<WeightLog>({
  name: 'weight',
  id: weight => weight.id,
  storage: idbStore<WeightLog>({ dbName: DB_NAME }),
});

export const ProfileEntity = defineEntity<Profile>({
  name: 'profile',
  id: () => PROFILE_ID,
  storage: idbStore<Profile>({ dbName: DB_NAME }),
});

// defineEntity уже инстанцировал KeyedStore-ы — используем их как прямой доступ к idb.
export const foodStore = FoodEntity.storage!;
export const entryStore = EntryEntity.storage!;
export const weightStore = WeightEntity.storage!;
export const profileStore = ProfileEntity.storage!;

// ── Queries ──────────────────────────────────────────────────────────────────

export const foodsQuery = defineQuery<void, Food[], { ids: string[] }>({
  name: 'foods.all',
  key: () => ['foods'],
  fetch: () => foodStore.readAll(),
  normalize: items => ({
    entities: { food: items },
    result: { ids: [...items].sort((a, b) => a.name.localeCompare(b.name, 'ru')).map(f => f.id) },
  }),
  tags: () => ['foods'],
});

export const entriesByDayQuery = defineQuery<{ date: string }, Entry[], { ids: string[] }>({
  name: 'entries.byDay',
  key: args => ['entries', args.date],
  fetch: async ({ date }) => (await entryStore.readAll()).filter(e => e.date === date),
  normalize: items => ({
    entities: { entry: items },
    result: { ids: [...items].sort((a, b) => a.createdAt - b.createdAt).map(e => e.id) },
  }),
  tags: () => ['entries'],
});

export interface DaySummary {
  date: string;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  entries: number;
}

/** Агрегаты по дням для статистики; сущности в кэш не тянем. */
export const daySummariesQuery = defineQuery<void, Entry[], DaySummary[]>({
  name: 'stats.daySummaries',
  key: () => ['stats', 'days'],
  fetch: () => entryStore.readAll(),
  normalize: (items) => {
    const byDate = new Map<string, DaySummary>();
    for (const entry of items) {
      let day = byDate.get(entry.date);
      if (!day) {
        day = { date: entry.date, kcal: 0, protein: 0, fat: 0, carbs: 0, entries: 0 };
        byDate.set(entry.date, day);
      }
      day.kcal += entry.kcal;
      day.protein += entry.protein;
      day.fat += entry.fat;
      day.carbs += entry.carbs;
      day.entries += 1;
    }
    return { result: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)) };
  },
  tags: () => ['entries'],
});

export const weightsQuery = defineQuery<void, WeightLog[], { ids: string[] }>({
  name: 'weights.all',
  key: () => ['weights'],
  fetch: () => weightStore.readAll(),
  normalize: items => ({
    entities: { weight: items },
    result: { ids: [...items].sort((a, b) => a.date.localeCompare(b.date)).map(w => w.id) },
  }),
  tags: () => ['weights'],
});

export const profileQuery = defineQuery<void, Profile | undefined, { exists: boolean }>({
  name: 'profile.get',
  key: () => ['profile'],
  fetch: () => profileStore.read(PROFILE_ID),
  normalize: profile => ({
    entities: { profile: profile ? [profile] : [] },
    result: { exists: profile !== undefined },
  }),
  tags: () => ['profile'],
});

// ── Mutations ────────────────────────────────────────────────────────────────

export const addEntryMutation = defineMutation<{ entry: Entry }, Entry>({
  name: 'entry.add',
  fetch: async ({ entry }) => {
    await entryStore.write([{ key: entry.id, value: entry }]);
    if (entry.foodId) {
      const food = await foodStore.read(entry.foodId);
      if (food) {
        await foodStore.write([{
          key: food.id,
          value: {
            ...food,
            usedCount: food.usedCount + 1,
            lastUsedAt: entry.createdAt,
            lastAmountG: entry.amountG ?? food.lastAmountG,
          },
        }]);
      }
    }
    return entry;
  },
  optimistic: ({ entry }, ctx) => ctx.upsertEntity(EntryEntity, entry),
  invalidate: () => ['entries', 'foods'],
});

export const updateEntryMutation = defineMutation<{ id: string; patch: Partial<Entry> }, Entry | null>({
  name: 'entry.update',
  fetch: async ({ id, patch }) => {
    const current = await entryStore.read(id);
    if (!current) return null;
    const next = { ...current, ...patch };
    await entryStore.write([{ key: id, value: next }]);
    return next;
  },
  optimistic: ({ id, patch }, ctx) => ctx.patchEntity(EntryEntity, id, patch),
  invalidate: () => ['entries'],
});

export const removeEntryMutation = defineMutation<{ id: string }, string>({
  name: 'entry.remove',
  fetch: async ({ id }) => {
    await entryStore.delete(id);
    return id;
  },
  optimistic: ({ id }, ctx) => ctx.removeEntity(EntryEntity, id),
  invalidate: () => ['entries'],
});

export const upsertFoodMutation = defineMutation<{ food: Food }, Food>({
  name: 'food.upsert',
  fetch: async ({ food }) => {
    await foodStore.write([{ key: food.id, value: food }]);
    return food;
  },
  optimistic: ({ food }, ctx) => ctx.upsertEntity(FoodEntity, food),
  invalidate: () => ['foods'],
});

export const removeFoodMutation = defineMutation<{ id: string }, string>({
  name: 'food.remove',
  fetch: async ({ id }) => {
    await foodStore.delete(id);
    return id;
  },
  optimistic: ({ id }, ctx) => ctx.removeEntity(FoodEntity, id),
  invalidate: () => ['foods'],
});

export const saveProfileMutation = defineMutation<{ profile: Profile }, Profile>({
  name: 'profile.save',
  fetch: async ({ profile }) => {
    await profileStore.write([{ key: PROFILE_ID, value: profile }]);
    return profile;
  },
  optimistic: ({ profile }, ctx) => ctx.upsertEntity(ProfileEntity, profile),
  invalidate: () => ['profile'],
});

export const logWeightMutation = defineMutation<{ weight: WeightLog }, WeightLog>({
  name: 'weight.log',
  fetch: async ({ weight }) => {
    await weightStore.write([{ key: weight.id, value: weight }]);
    return weight;
  },
  optimistic: ({ weight }, ctx) => ctx.upsertEntity(WeightEntity, weight),
  invalidate: () => ['weights'],
});

export const removeWeightMutation = defineMutation<{ id: string }, string>({
  name: 'weight.remove',
  fetch: async ({ id }) => {
    await weightStore.delete(id);
    return id;
  },
  optimistic: ({ id }, ctx) => ctx.removeEntity(WeightEntity, id),
  invalidate: () => ['weights'],
});

export const allEntities = [FoodEntity, EntryEntity, WeightEntity, ProfileEntity];
export const allQueries = [foodsQuery, entriesByDayQuery, daySummariesQuery, weightsQuery, profileQuery];
export const allMutations = [
  addEntryMutation,
  updateEntryMutation,
  removeEntryMutation,
  upsertFoodMutation,
  removeFoodMutation,
  saveProfileMutation,
  logWeightMutation,
  removeWeightMutation,
];
