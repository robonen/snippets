import { describe, expect, it } from 'vitest';
import { Land, Link, createSpace, fixedClock } from '@sync/core';
import type { Space } from '@sync/core';
import type { Entry } from '../entities/entry';
import type { Food } from '../entities/food';
import type { Profile } from '../entities/profile';
import {
  KcalModel,
  readEntry,
  readFood,
  readProfile,
  writeEntry,
  writeFood,
  writeProfile,
} from './models';

function spaceOf(): Space {
  const land = new Land(Link.peer(new Uint8Array(8).fill(0x77)), fixedClock(1_700_000));
  return createSpace({ land });
}

const FOOD: Food = {
  id: 'f1',
  name: 'Овсянка',
  category: 'Крупы',
  kcal: 370,
  protein: 12.3,
  fat: 6.2,
  carbs: 62,
  pieceGrams: 40,
  builtin: true,
  usedCount: 3,
  lastUsedAt: 1_700_100,
  createdAt: 1_699_000,
};

const ENTRY: Entry = {
  id: 'e1',
  date: '2026-08-16',
  meal: 'breakfast',
  foodId: 'f1',
  name: 'Овсянка',
  amountG: 60,
  kcal: 222,
  protein: 7.4,
  fat: 3.7,
  carbs: 37.2,
  createdAt: 1_700_200,
};

describe('модели дневника на @sync/core', () => {
  it('продукт переживает круг документ → снимок, включая опциональные поля', () => {
    const root = spaceOf().root(KcalModel);
    writeFood(root.foods(FOOD.id), FOOD);

    expect(readFood(FOOD.id, root.foods(FOOD.id))).toEqual(FOOD);
    // Отсутствующие опциональные поля отсутствуют, а не равны null:
    // доменные типы не меняются из-за смены хранилища.
    expect(Object.hasOwn(readFood(FOOD.id, root.foods(FOOD.id)), 'barcode')).toBeFalsy();
  });

  it('ключи каталога видны и удаляются', () => {
    const root = spaceOf().root(KcalModel);
    writeFood(root.foods('a'), { ...FOOD, id: 'a' });
    writeFood(root.foods('b'), { ...FOOD, id: 'b', name: 'Гречка' });

    expect([...root.foods.keys()].sort()).toEqual(['a', 'b']);
    root.foods.delete('a');
    expect([...root.foods.keys()]).toEqual(['b']);
  });

  it('запись дневника: снимок совпадает, быстрая запись без продукта — без лишних полей', () => {
    const root = spaceOf().root(KcalModel);
    writeEntry(root.entries(ENTRY.id), ENTRY);
    expect(readEntry(ENTRY.id, root.entries(ENTRY.id))).toEqual(ENTRY);

    const quick: Entry = {
      id: 'q1',
      date: '2026-08-16',
      meal: 'snack',
      name: 'Кофе с сиропом',
      kcal: 90,
      protein: 0,
      fat: 3,
      carbs: 14,
      createdAt: 1_700_300,
    };
    writeEntry(root.entries(quick.id), quick);
    const back = readEntry(quick.id, root.entries(quick.id));
    expect(back).toEqual(quick);
    expect(Object.hasOwn(back, 'foodId')).toBeFalsy();
    expect(Object.hasOwn(back, 'amountG')).toBeFalsy();
  });

  it('профиль: до первого сохранения его нет, после — есть', () => {
    const root = spaceOf().root(KcalModel);
    expect(root.profile().createdAt()).toBe(0);

    const profile: Profile = {
      sex: 'female',
      age: 29,
      heightCm: 168,
      weightKg: 61.5,
      activity: 1.375,
      goal: 'maintain',
      targetKcal: 1900,
      targetProtein: 110,
      targetFat: 63,
      targetCarbs: 210,
      createdAt: 1_700_000,
      updatedAt: 1_700_400,
    };
    writeProfile(root.profile(), profile);
    expect(readProfile(root.profile())).toEqual(profile);
  });

  it('две вкладки сходятся: запись из одной видна в другой', () => {
    const clock = fixedClock(1_700_000);
    const peer = Link.peer(new Uint8Array(8).fill(0x77));
    const tabA = new Land(peer, clock, { session: 0x000100 });
    const tabB = new Land(peer, clock, { session: 0x800100 });

    const rootA = createSpace({ land: tabA }).root(KcalModel);
    const rootB = createSpace({ land: tabB }).root(KcalModel);

    writeFood(rootA.foods('x'), { ...FOOD, id: 'x' });
    writeEntry(rootB.entries('y'), { ...ENTRY, id: 'y' });

    // Обмен как по каналу вкладок, только руками и детерминированно.
    tabB.apply(tabA.part().units);
    tabA.apply(tabB.part().units);

    expect(readFood('x', rootB.foods('x')).name).toBe('Овсянка');
    expect(readEntry('y', rootA.entries('y')).name).toBe('Овсянка');
  });
});
