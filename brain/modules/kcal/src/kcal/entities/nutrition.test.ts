import { describe, expect, it } from 'vitest';
import { portionNutrients, sumNutrients } from './nutrition';

describe(portionNutrients, () => {
  const buckwheat = { kcal: 110, protein: 4.2, fat: 1.1, carbs: 21.3 };

  it('масштабирует значения на 100 г к порции', () => {
    expect(portionNutrients(buckwheat, 250)).toEqual({ kcal: 275, protein: 10.5, fat: 2.8, carbs: 53.3 });
  });

  it('порция 0 г — нули', () => {
    expect(portionNutrients(buckwheat, 0)).toEqual({ kcal: 0, protein: 0, fat: 0, carbs: 0 });
  });
});

describe(sumNutrients, () => {
  it('складывает записи и округляет макросы до десятых', () => {
    const total = sumNutrients([
      { kcal: 275, protein: 10.5, fat: 2.8, carbs: 53.3 },
      { kcal: 157, protein: 12.7, fat: 11.5, carbs: 0.7 },
    ]);
    expect(total).toEqual({ kcal: 432, protein: 23.2, fat: 14.3, carbs: 54 });
  });

  it('пустой список — нули', () => {
    expect(sumNutrients([])).toEqual({ kcal: 0, protein: 0, fat: 0, carbs: 0 });
  });
});
