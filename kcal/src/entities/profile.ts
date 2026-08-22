import type { Nutrients } from '@/entities/nutrition';
import { roundTo } from '@/shared/lib/numbers';

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

/** Профиль пользователя — единственный на устройство. */
export interface Profile {
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

/** Замер веса; один на день, id совпадает с датой. */
export interface WeightLog {
  id: string;
  date: string;
  kg: number;
  createdAt: number;
}

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
