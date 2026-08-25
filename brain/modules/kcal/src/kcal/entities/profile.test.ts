import { describe, expect, it } from 'vitest';
import { bmr, computeTargets, safeKcalFloor, tdee } from './profile';

describe('bmr (Mifflin—St Jeor)', () => {
  it('man, 30 years, 180 cm, 80 kg', () => {
    // 10*80 + 6.25*180 - 5*30 + 5 = 800 + 1125 - 150 + 5
    expect(bmr('male', 30, 180, 80)).toBe(1780);
  });

  it('woman, 25 years, 165 cm, 60 kg', () => {
    // 10*60 + 6.25*165 - 5*25 - 161 = 600 + 1031.25 - 125 - 161
    expect(bmr('female', 25, 165, 60)).toBeCloseTo(1345.25, 2);
  });
});

describe(tdee, () => {
  it('multiplies BMR by the activity factor', () => {
    expect(tdee('male', 30, 180, 80, 1.55)).toBeCloseTo(1780 * 1.55, 5);
  });
});

describe(computeTargets, () => {
  const params = { sex: 'male' as const, age: 30, heightCm: 180, weightKg: 80, activity: 1.55 };

  it('weight loss: 15% deficit, protein 1.8 g/kg, fat 0.9 g/kg', () => {
    const t = computeTargets({ ...params, goal: 'lose' });
    expect(t.kcal).toBe(2350); // 2759 * 0.85 = 2345.15 → к ближайшим 10
    expect(t.protein).toBe(144);
    expect(t.fat).toBe(72);
    // Углеводы добираются из остатка: (2350 - 144*4 - 72*9) / 4
    expect(t.carbs).toBe(Math.round((2350 - 144 * 4 - 72 * 9) / 4));
  });

  it('maintenance: no deficit', () => {
    const t = computeTargets({ ...params, goal: 'maintain' });
    expect(t.kcal).toBe(2760);
    expect(t.protein).toBe(128);
  });

  it('gain: 10% surplus', () => {
    const t = computeTargets({ ...params, goal: 'gain' });
    expect(t.kcal).toBe(3030); // 2759 * 1.1 = 3034.9 → к ближайшим 10
  });

  it('carbs do not go negative on extreme inputs', () => {
    const t = computeTargets({ sex: 'female', age: 70, heightCm: 150, weightKg: 45, activity: 1.2, goal: 'lose' });
    expect(t.carbs).toBeGreaterThanOrEqual(0);
    expect(t.kcal).toBeLessThan(safeKcalFloor('female') + 500);
  });
});
