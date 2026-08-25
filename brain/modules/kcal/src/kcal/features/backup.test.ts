import { describe, expect, it } from 'vitest';
import { Land, Link, createSpace, fixedClock } from '@sync/core';
import type { Space } from '@sync/core';
import { KcalModel, writeEntry, writeFood, writeProfile, writeWeight } from '../db/models';
import type { Entry } from '../entities/entry';
import type { Food } from '../entities/food';
import type { Profile, WeightLog } from '../entities/profile';
import { BACKUP_VERSION, backupFileName, exportBackup, importBackup, parseBackup } from './backup';

function spaceOf(seed = 0x77): Space {
  const land = new Land(Link.peer(new Uint8Array(8).fill(seed)), fixedClock(1_700_000));
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
  barcode: '5449000000996',
  builtin: true,
  usedCount: 3,
  lastUsedAt: 1_700_100,
  lastAmountG: 60,
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

const WEIGHT: WeightLog = { id: '2026-08-16', date: '2026-08-16', kg: 80.4, createdAt: 1_700_300 };

const PROFILE: Profile = {
  sex: 'female',
  age: 29,
  heightCm: 168,
  weightKg: 61.5,
  activity: 1.375,
  goal: 'lose',
  targetKcal: 1900,
  targetProtein: 110,
  targetFat: 63,
  targetCarbs: 210,
  createdAt: 1_700_000,
  updatedAt: 1_700_400,
};

function filled(): Space {
  const space = spaceOf();
  const root = space.root(KcalModel);
  space.edit(() => {
    writeFood(root.foods(FOOD.id), FOOD);
    writeEntry(root.entries(ENTRY.id), ENTRY);
    writeWeight(root.weights(WEIGHT.id), WEIGHT);
    writeProfile(root.profile(), PROFILE);
  });
  return space;
}

describe('цикл экспорт → импорт', () => {
  it('через файл данные переезжают без потерь', () => {
    const file = JSON.stringify(exportBackup(filled()));

    const target = spaceOf(0x33);
    const { payload, skipped } = parseBackup(file);
    const summary = importBackup(target, payload);

    expect(skipped).toBe(0);
    expect(summary).toEqual({ foods: 1, entries: 1, weights: 1, profile: true });
    // Снимок нового ленда совпадает со снимком старого — вплоть до опциональных полей.
    expect(exportBackup(target)).toMatchObject({
      foods: [FOOD],
      entries: [ENTRY],
      weights: [WEIGHT],
      profile: PROFILE,
    });
  });

  it('импорт поверх существующих данных сливает по id, а не задваивает', () => {
    const target = filled();
    const { payload } = parseBackup(JSON.stringify(exportBackup(filled())));
    importBackup(target, payload);

    const after = exportBackup(target);
    expect(after.foods).toHaveLength(1);
    expect(after.entries).toHaveLength(1);
  });

  it('пустой ленд экспортируется без профиля', () => {
    const payload = exportBackup(spaceOf());
    expect(payload).toMatchObject({ app: 'kcal', version: 1, foods: [], entries: [], weights: [], profile: null });
  });

  it('имя файла несёт дату снимка', () => {
    expect(backupFileName({ ...exportBackup(spaceOf()), exportedAt: '2026-08-24T10:00:00.000Z' }))
      .toBe('kcal-backup-2026-08-24.json');
  });
});

describe(parseBackup, () => {
  const payload = exportBackup(filled());

  it('чужой файл отвергается', () => {
    expect(() => parseBackup(JSON.stringify({ ...payload, app: 'notes' })))
      .toThrow(/не похож на бэкап/);
    expect(() => parseBackup(JSON.stringify([1, 2, 3]))).toThrow(/не похож на бэкап/);
  });

  it('битый JSON отвергается', () => {
    expect(() => parseBackup('{ это не json')).toThrow(/не читается/);
  });

  it('версия формата проверяется', () => {
    expect(() => parseBackup(JSON.stringify({ ...payload, version: 2 }))).toThrow(/Версия формата 2/);
    expect(() => parseBackup(JSON.stringify({ ...payload, version: undefined }))).toThrow(/Версия формата/);
    expect(parseBackup(JSON.stringify(payload)).payload.version).toBe(BACKUP_VERSION);
  });

  it('подменённые списки — повреждённый файл', () => {
    expect(() => parseBackup(JSON.stringify({ ...payload, foods: 'всё' }))).toThrow(/повреждён/);
  });

  it('файл старого приложения читается: служебный id профиля игнорируется', () => {
    const legacy = {
      app: 'kcal',
      version: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      foods: [{ id: 'f9', name: 'Хлеб', category: 'Хлеб', kcal: 250, protein: 8, fat: 3, carbs: 48, usedCount: 0, lastUsedAt: 0, createdAt: 1 }],
      entries: [{ id: 'e9', date: '2026-01-01', meal: 'dinner', name: 'Хлеб', kcal: 125, protein: 4, fat: 1.5, carbs: 24, createdAt: 1 }],
      // Замеров веса в самых старых файлах не было вовсе.
      profile: { id: 'profile', ...PROFILE },
    };

    const target = spaceOf(0x11);
    const { payload: parsed, skipped } = parseBackup(JSON.stringify(legacy));
    expect(skipped).toBe(0);
    expect(importBackup(target, parsed)).toEqual({ foods: 1, entries: 1, weights: 0, profile: true });

    const restored = exportBackup(target);
    expect(restored.profile).toEqual(PROFILE);
    expect(Object.hasOwn(restored.profile ?? {}, 'id')).toBeFalsy();
  });

  it('битые записи выбрасываются поштучно, остальной файл доезжает', () => {
    const broken = {
      ...payload,
      foods: [...payload.foods, { name: 'Без id' }, 42],
      entries: [...payload.entries, { id: 'e2' }],
      weights: [...payload.weights, { date: '2026-08-17' }],
    };

    const { payload: parsed, skipped } = parseBackup(JSON.stringify(broken));
    expect(skipped).toBe(4);
    expect(parsed.foods).toHaveLength(1);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.weights).toHaveLength(1);
  });

  it('мусор в числах не доезжает до ленда', () => {
    const dirty = {
      ...payload,
      entries: [{ ...ENTRY, kcal: 'много', meal: 'полдник', protein: null }],
    };
    const target = spaceOf(0x22);
    importBackup(target, parseBackup(JSON.stringify(dirty)).payload);

    expect(exportBackup(target).entries[0]).toMatchObject({ kcal: 0, protein: 0, meal: 'snack' });
  });

  it('импорт мимо разбора всё равно проверяет конверт', () => {
    expect(() => importBackup(spaceOf(), { ...payload, version: 7 as never }))
      .toThrow(/не похож на бэкап/);
  });
});
