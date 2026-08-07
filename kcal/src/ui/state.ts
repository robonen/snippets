import { reactive, shallowRef } from 'vue';
import type { Meal } from '../domain/types';
import { todayISO } from '../domain/dates';

export type Tab = 'diary' | 'stats' | 'foods' | 'profile';

export const activeTab = shallowRef<Tab>('diary');

/** День, открытый в дневнике. Записи добавляются именно в него. */
export const selectedDate = shallowRef(todayISO());

/** Шторка добавления записи. */
export const addSheet = reactive({ open: false, meal: 'breakfast' as Meal });

/** Шторка редактирования записи дневника. */
export const editEntryId = shallowRef<string | null>(null);

/** Шторка формы продукта; null в foodId — создание нового. */
export const foodForm = reactive({ open: false, foodId: null as string | null });

export function openAddSheet(meal: Meal): void {
  addSheet.meal = meal;
  addSheet.open = true;
}

export function goToday(): void {
  selectedDate.value = todayISO();
}
