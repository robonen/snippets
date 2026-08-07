/** Приём пищи, к которому привязана запись дневника. */
export type Meal = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export const MEALS: readonly Meal[] = ['breakfast', 'lunch', 'dinner', 'snack'];

export const MEAL_LABELS: Record<Meal, string> = {
  breakfast: 'Завтрак',
  lunch: 'Обед',
  dinner: 'Ужин',
  snack: 'Перекус',
};

/** Пищевая ценность. Для Food — на 100 г, для Entry — на порцию целиком. */
export interface Nutrients {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
}

/** Продукт личного каталога. Все значения — на 100 г. */
export interface Food extends Nutrients {
  id: string;
  name: string;
  category: string;
  /** Вес одной штуки в граммах — включает режим «в штуках» при вводе порции. */
  pieceGrams?: number;
  /** EAN/UPC с упаковки — для дедупликации при повторном сканировании. */
  barcode?: string;
  /** Продукт из стартового набора (можно редактировать как свой). */
  builtin?: boolean;
  /** Сколько раз добавляли в дневник — для сортировки «недавних». */
  usedCount: number;
  /** Момент последнего добавления в дневник. */
  lastUsedAt: number;
  /** Последняя введённая порция в граммах — подставляется по умолчанию. */
  lastAmountG?: number;
  createdAt: number;
}

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

/** Замер веса; один на день, id совпадает с датой. */
export interface WeightLog {
  id: string;
  date: string;
  kg: number;
  createdAt: number;
}

export type Sex = 'male' | 'female';
export type Goal = 'lose' | 'maintain' | 'gain';

/** Коэффициенты активности к BMR (множители Харриса—Бенедикта). */
export const ACTIVITY_LEVELS = [
  { value: 1.2, label: 'Минимальная', hint: 'сидячая работа, без тренировок' },
  { value: 1.375, label: 'Лёгкая', hint: '1–3 тренировки в неделю' },
  { value: 1.55, label: 'Средняя', hint: '3–5 тренировок в неделю' },
  { value: 1.725, label: 'Высокая', hint: '6–7 тренировок в неделю' },
  { value: 1.9, label: 'Экстремальная', hint: 'физический труд + тренировки' },
] as const;

export const GOAL_LABELS: Record<Goal, string> = {
  lose: 'Похудение',
  maintain: 'Поддержание',
  gain: 'Набор массы',
};

/** Профиль пользователя — единственная запись с id = 'profile'. */
export interface Profile {
  id: 'profile';
  sex: Sex;
  age: number;
  heightCm: number;
  weightKg: number;
  activity: number;
  goal: Goal;
  /** Дневные цели. Пересчитываются из параметров, но правятся и вручную. */
  targetKcal: number;
  targetProtein: number;
  targetFat: number;
  targetCarbs: number;
  createdAt: number;
  updatedAt: number;
}

export const PROFILE_ID = 'profile' as const;
