import { describe, expect, it } from 'vitest';
import { portionNutrients, sumNutrients } from './nutrition';

describe(portionNutrients, () => {
  const buckwheat = { kcal: 110, protein: 4.2, fat: 1.1, carbs: 21.3 };

  it('scales per-100g values to a portion', () => {
    expect(portionNutrients(buckwheat, 250)).toEqual({ kcal: 275, protein: 10.5, fat: 2.8, carbs: 53.3 });
  });

  it('portion of 0 g — zeros', () => {
    expect(portionNutrients(buckwheat, 0)).toEqual({ kcal: 0, protein: 0, fat: 0, carbs: 0 });
  });
});

describe(sumNutrients, () => {
  it('sums entries and rounds macros to tenths', () => {
    const total = sumNutrients([
      { kcal: 275, protein: 10.5, fat: 2.8, carbs: 53.3 },
      { kcal: 157, protein: 12.7, fat: 11.5, carbs: 0.7 },
    ]);
    expect(total).toEqual({ kcal: 432, protein: 23.2, fat: 14.3, carbs: 54 });
  });

  it('empty list — zeros', () => {
    expect(sumNutrients([])).toEqual({ kcal: 0, protein: 0, fat: 0, carbs: 0 });
  });
});
