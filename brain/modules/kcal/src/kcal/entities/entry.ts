import type { Nutrients } from './nutrition';

/** Приём пищи, к которому привязана запись дневника. */
export type Meal = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export const MEALS: readonly Meal[] = ['breakfast', 'lunch', 'dinner', 'snack'];

export const MEAL_LABELS: Record<Meal, string> = {
  breakfast: 'Завтрак',
  lunch: 'Обед',
  dinner: 'Ужин',
  snack: 'Перекус',
};

/**
 * Запись дневника. Хранит снапшот имени и итоговых нутриентов на порцию:
 * правка или удаление продукта из каталога не меняет историю.
 */
export interface Entry extends Nutrients {
  id: string;
  /** Локальная дата дня дневника в формате YYYY-MM-DD. */
  date: string;
  meal: Meal;
  /** Ссылка на продукт каталога; отсутствует у быстрых записей «только ккал». */
  foodId?: string;
  name: string;
  /** Размер порции в граммах; отсутствует у быстрых записей. */
  amountG?: number;
  createdAt: number;
}
