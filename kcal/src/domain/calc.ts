import type { Food, Goal, Nutrients, Sex } from './types';

/** Базовый обмен по Миффлину—Сан Жеору, ккал/сутки. */
export function bmr(sex: Sex, age: number, heightCm: number, weightKg: number): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === 'male' ? base + 5 : base - 161;
}

/** Суточный расход с учётом активности. */
export function tdee(sex: Sex, age: number, heightCm: number, weightKg: number, activity: number): number {
  return bmr(sex, age, heightCm, weightKg) * activity;
}

/**
 * Пресеты целей: множитель калорийности от TDEE и нормы белка/жира на кг веса.
 * Похудение — умеренный дефицит 15%, белок повышен для сохранения мышц;
 * набор — профицит 10%. Углеводы добираются из остатка калорий.
 */
const GOAL_PRESETS: Record<Goal, { kcalFactor: number; proteinPerKg: number; fatPerKg: number }> = {
  lose: { kcalFactor: 0.85, proteinPerKg: 1.8, fatPerKg: 0.9 },
  maintain: { kcalFactor: 1.0, proteinPerKg: 1.6, fatPerKg: 1.0 },
  gain: { kcalFactor: 1.1, proteinPerKg: 1.8, fatPerKg: 1.0 },
};

/** Безопасный минимум калорийности; ниже — предупреждаем, но не запрещаем. */
export function safeKcalFloor(sex: Sex): number {
  return sex === 'male' ? 1500 : 1200;
}

export interface TargetInput {
  sex: Sex;
  age: number;
  heightCm: number;
  weightKg: number;
  activity: number;
  goal: Goal;
}

/** Дневные цели по калориям и БЖУ из параметров тела и цели. */
export function computeTargets(input: TargetInput): Nutrients {
  const preset = GOAL_PRESETS[input.goal];
  const kcal = roundTo(tdee(input.sex, input.age, input.heightCm, input.weightKg, input.activity) * preset.kcalFactor, 10);
  const protein = Math.round(input.weightKg * preset.proteinPerKg);
  const fat = Math.round(input.weightKg * preset.fatPerKg);
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return { kcal, protein, fat, carbs };
}

/** Нутриенты порции продукта: значения каталога даны на 100 г. */
export function portionNutrients(food: Nutrients, amountG: number): Nutrients {
  const k = amountG / 100;
  return {
    kcal: Math.round(food.kcal * k),
    protein: round1(food.protein * k),
    fat: round1(food.fat * k),
    carbs: round1(food.carbs * k),
  };
}

/** Сумма нутриентов по записям. */
export function sumNutrients(items: readonly Nutrients[]): Nutrients {
  const total = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
  for (const item of items) {
    total.kcal += item.kcal;
    total.protein += item.protein;
    total.fat += item.fat;
    total.carbs += item.carbs;
  }
  total.protein = round1(total.protein);
  total.fat = round1(total.fat);
  total.carbs = round1(total.carbs);
  return total;
}

/** Порция по умолчанию для продукта: прошлая → одна штука → 100 г. */
export function defaultAmount(food: Food): number {
  return food.lastAmountG ?? food.pieceGrams ?? 100;
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}
