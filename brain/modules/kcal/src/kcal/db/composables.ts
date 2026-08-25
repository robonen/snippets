import { computed } from 'vue';
import type { ComputedRef } from 'vue';
import { useDoc, useSpace, useSync, useValue } from '@sync/vue';
import type { Entry } from '../entities/entry';
import type { Food } from '../entities/food';
import type { Profile, WeightLog } from '../entities/profile';
import {
  KcalModel,
  readEntry,
  readFood,
  readProfile,
  readWeight,
  writeEntry,
  writeFood,
  writeProfile,
  writeWeight,
} from './models';

/**
 * Хуки дневника поверх моста `@sync/vue`.
 *
 * Снимки целых коллекций, а не адресные подписки, — решение по размеру данных:
 * личный дневник это сотни записей, и один файбер на коллекцию с фильтрацией в
 * Vue-computed проще и дешевле, чем файбер на строку. Важно и другое: дата дня —
 * Vue-реф, а файберный наблюдатель Vue-рефов не видит; фильтр по дате обязан
 * жить на стороне Vue.
 */

/** Все продукты каталога, отсортированные по имени. */
export function useFoods(): ComputedRef<Food[]> {
  const root = useDoc(KcalModel);
  const snapshot = useValue(() => root.foods.keys().map(id => readFood(id, root.foods(id))));
  return computed(() =>
    [...(snapshot.value ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'ru')));
}

/** Все записи дневника в порядке создания. Фильтр по дате — у вызывающего. */
export function useEntries(): ComputedRef<Entry[]> {
  const root = useDoc(KcalModel);
  const snapshot = useValue(() => root.entries.keys().map(id => readEntry(id, root.entries(id))));
  return computed(() => [...(snapshot.value ?? [])].sort((a, b) => a.createdAt - b.createdAt));
}

/** Замеры веса по возрастанию даты. */
export function useWeights(): ComputedRef<WeightLog[]> {
  const root = useDoc(KcalModel);
  const snapshot = useValue(() => root.weights.keys().map(id => readWeight(id, root.weights(id))));
  return computed(() => [...(snapshot.value ?? [])].sort((a, b) => a.date.localeCompare(b.date)));
}

export interface ProfileState {
  /** Профиль или `undefined`, пока ленд едет из хранилища. */
  data: ComputedRef<Profile | undefined>;
  /** Гидрация закончилась — по ленду уже можно судить. */
  ready: ComputedRef<boolean>;
  /** Профиль заполнялся хотя бы раз. */
  exists: ComputedRef<boolean>;
}

export function useProfile(): ProfileState {
  const root = useDoc(KcalModel);
  const state = useSync(() => {
    const doc = root.profile();
    return { profile: readProfile(doc), exists: doc.createdAt() > 0 };
  });
  return {
    data: computed(() => (state.data.value?.exists === true ? state.data.value.profile : undefined)),
    ready: computed(() => state.data.value !== undefined && !state.pending.value),
    exists: computed(() => state.data.value?.exists === true),
  };
}

// ── Запись ───────────────────────────────────────────────────────────────────
// Мутаций как понятия больше нет: запись — прямой вызов каналов в транзакции
// (`space.edit`: одна метка времени и один сброс на всё). Оптимистичность
// бесплатна — запись сразу локальная и настоящая, откатывать нечего.

export interface KcalActions {
  addEntry(entry: Entry): void;
  updateEntry(id: string, patch: Partial<Entry>): void;
  removeEntry(id: string): void;
  upsertFood(food: Food): void;
  removeFood(id: string): void;
  saveProfile(profile: Profile): void;
  logWeight(weight: WeightLog): void;
  removeWeight(id: string): void;
}

export function useActions(): KcalActions {
  const space = useSpace();
  const root = useDoc(KcalModel);

  return {
    addEntry(entry) {
      space.edit(() => {
        writeEntry(root.entries(entry.id), entry);
        // Статистика использования продукта — как в старой мутации entry.add.
        if (entry.foodId !== undefined && root.foods.has(entry.foodId)) {
          const food = root.foods(entry.foodId);
          food.usedCount(food.usedCount() + 1);
          food.lastUsedAt(entry.createdAt);
          if (entry.amountG !== undefined) food.lastAmountG(entry.amountG);
        }
      });
    },
    updateEntry(id, patch) {
      if (!root.entries.has(id)) return;
      space.edit(() => {
        const doc = root.entries(id);
        writeEntry(doc, { ...readEntry(id, doc), ...patch, id });
      });
    },
    removeEntry(id) {
      root.entries.delete(id);
    },
    upsertFood(food) {
      space.edit(() => writeFood(root.foods(food.id), food));
    },
    removeFood(id) {
      root.foods.delete(id);
    },
    saveProfile(profile) {
      space.edit(() => writeProfile(root.profile(), profile));
    },
    logWeight(weight) {
      space.edit(() => writeWeight(root.weights(weight.id), weight));
    },
    removeWeight(id) {
      root.weights.delete(id);
    },
  };
}
