import { describe, expect, it } from 'vitest';
import { bmr, computeTargets, portionNutrients, safeKcalFloor, sumNutrients, tdee } from './calc';

describe('bmr (Миффлин—Сан Жеор)', () => {
  it('мужчина 30 лет, 180 см, 80 кг', () => {
    // 10*80 + 6.25*180 - 5*30 + 5 = 800 + 1125 - 150 + 5
    expect(bmr('male', 30, 180, 80)).toBe(1780);
  });

  it('женщина 25 лет, 165 см, 60 кг', () => {
    // 10*60 + 6.25*165 - 5*25 - 161 = 600 + 1031.25 - 125 - 161
    expect(bmr('female', 25, 165, 60)).toBeCloseTo(1345.25, 2);
  });
});

describe(tdee, () => {
  it('умножает BMR на коэффициент активности', () => {
    expect(tdee('male', 30, 180, 80, 1.55)).toBeCloseTo(1780 * 1.55, 5);
  });
});

describe(computeTargets, () => {
  const params = { sex: 'male' as const, age: 30, heightCm: 180, weightKg: 80, activity: 1.55 };

  it('похудение: дефицит 15%, белок 1.8 г/кг, жир 0.9 г/кг', () => {
    const t = computeTargets({ ...params, goal: 'lose' });
    expect(t.kcal).toBe(2350); // 2759 * 0.85 = 2345.15 → к ближайшим 10
    expect(t.protein).toBe(144);
    expect(t.fat).toBe(72);
    // Углеводы добираются из остатка: (2350 - 144*4 - 72*9) / 4
    expect(t.carbs).toBe(Math.round((2350 - 144 * 4 - 72 * 9) / 4));
  });

  it('поддержание: без дефицита', () => {
    const t = computeTargets({ ...params, goal: 'maintain' });
    expect(t.kcal).toBe(2760);
    expect(t.protein).toBe(128);
  });

  it('набор: профицит 10%', () => {
    const t = computeTargets({ ...params, goal: 'gain' });
    expect(t.kcal).toBe(3030); // 2759 * 1.1 = 3034.9 → к ближайшим 10
  });

  it('углеводы не уходят в минус на экстремальных входных', () => {
    const t = computeTargets({ sex: 'female', age: 70, heightCm: 150, weightKg: 45, activity: 1.2, goal: 'lose' });
    expect(t.carbs).toBeGreaterThanOrEqual(0);
    expect(t.kcal).toBeLessThan(safeKcalFloor('female') + 500);
  });
});

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
