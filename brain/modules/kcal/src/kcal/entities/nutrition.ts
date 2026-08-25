import { round1 } from '@brain/std';

/** Пищевая ценность. Для продукта — на 100 г, для записи — на порцию целиком. */
export interface Nutrients {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
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
