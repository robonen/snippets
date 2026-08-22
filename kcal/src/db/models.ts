import { atom, model, part, parts, t } from '@sync/core';
import type { Doc } from '@sync/core';
import { MEALS } from '@/entities/entry';
import type { Entry } from '@/entities/entry';
import type { Food } from '@/entities/food';
import type { Profile, WeightLog } from '@/entities/profile';

/**
 * Модели дневника на `@sync/core` (ADR-018): схема — данные, документ — объект
 * каналов, поле — атом. Никаких запросов и нормализации: «запрос» здесь —
 * реактивное чтение, запись — вызов канала, слияние между вкладками — работа
 * ленда, а не кэша.
 *
 * Снимки (`readFood` и родня) переводят документ в плоские доменные типы:
 * `calc`, `format` и экраны продолжают работать с обычными объектами, а
 * опциональные поля домена (`undefined`) отображаются в `null` модели и
 * обратно — у каналов один сентинел (docs/05, решение Р6).
 */

export const FoodModel = model('food', {
  name: atom(t.string),
  category: atom(t.string),
  kcal: atom(t.number),
  protein: atom(t.number),
  fat: atom(t.number),
  carbs: atom(t.number),
  pieceGrams: atom(t.maybe(t.number)),
  barcode: atom(t.maybe(t.string)),
  builtin: atom(t.bool),
  usedCount: atom(t.int),
  lastUsedAt: atom(t.number),
  lastAmountG: atom(t.maybe(t.number)),
  createdAt: atom(t.number),
});

export const EntryModel = model('entry', {
  date: atom(t.string),
  meal: atom(t.enum(MEALS).or('snack')),
  foodId: atom(t.maybe(t.string)),
  name: atom(t.string),
  amountG: atom(t.maybe(t.number)),
  kcal: atom(t.number),
  protein: atom(t.number),
  fat: atom(t.number),
  carbs: atom(t.number),
  createdAt: atom(t.number),
});

export const WeightModel = model('weight', {
  date: atom(t.string),
  kg: atom(t.number),
  createdAt: atom(t.number),
});

export const ProfileModel = model('profile', {
  sex: atom(t.enum(['male', 'female']).or('male')),
  age: atom(t.int),
  heightCm: atom(t.number),
  weightKg: atom(t.number),
  activity: atom(t.number),
  goal: atom(t.enum(['lose', 'maintain', 'gain']).or('maintain')),
  targetKcal: atom(t.number),
  targetProtein: atom(t.number),
  targetFat: atom(t.number),
  targetCarbs: atom(t.number),
  createdAt: atom(t.number),
  updatedAt: atom(t.number),
});

/** Корень ленда: каталоги по id плюс единственный профиль. */
export const KcalModel = model('kcal', {
  foods: parts(t.string, 'food'),
  entries: parts(t.string, 'entry'),
  weights: parts(t.string, 'weight'),
  profile: part('profile'),
});

declare module '@sync/core' {
  interface Models {
    food: typeof FoodModel;
    entry: typeof EntryModel;
    weight: typeof WeightModel;
    profile: typeof ProfileModel;
    kcal: typeof KcalModel;
  }
}

export type KcalDoc = Doc<'kcal'>;

// ── Снимки: документ → доменный тип ──────────────────────────────────────────

export function readFood(id: string, doc: Doc<'food'>): Food {
  const food: Food = {
    id,
    name: doc.name(),
    category: doc.category(),
    kcal: doc.kcal(),
    protein: doc.protein(),
    fat: doc.fat(),
    carbs: doc.carbs(),
    usedCount: doc.usedCount(),
    lastUsedAt: doc.lastUsedAt(),
    createdAt: doc.createdAt(),
  };
  const pieceGrams = doc.pieceGrams();
  if (pieceGrams !== null) food.pieceGrams = pieceGrams;
  const barcode = doc.barcode();
  if (barcode !== null) food.barcode = barcode;
  if (doc.builtin()) food.builtin = true;
  const lastAmountG = doc.lastAmountG();
  if (lastAmountG !== null) food.lastAmountG = lastAmountG;
  return food;
}

export function readEntry(id: string, doc: Doc<'entry'>): Entry {
  const entry: Entry = {
    id,
    date: doc.date(),
    meal: doc.meal(),
    name: doc.name(),
    kcal: doc.kcal(),
    protein: doc.protein(),
    fat: doc.fat(),
    carbs: doc.carbs(),
    createdAt: doc.createdAt(),
  };
  const foodId = doc.foodId();
  if (foodId !== null) entry.foodId = foodId;
  const amountG = doc.amountG();
  if (amountG !== null) entry.amountG = amountG;
  return entry;
}

export function readWeight(id: string, doc: Doc<'weight'>): WeightLog {
  return { id, date: doc.date(), kg: doc.kg(), createdAt: doc.createdAt() };
}

export function readProfile(doc: Doc<'profile'>): Profile {
  return {
    sex: doc.sex(),
    age: doc.age(),
    heightCm: doc.heightCm(),
    weightKg: doc.weightKg(),
    activity: doc.activity(),
    goal: doc.goal(),
    targetKcal: doc.targetKcal(),
    targetProtein: doc.targetProtein(),
    targetFat: doc.targetFat(),
    targetCarbs: doc.targetCarbs(),
    createdAt: doc.createdAt(),
    updatedAt: doc.updatedAt(),
  };
}

// ── Запись: доменный тип → документ ──────────────────────────────────────────
// Запись равного значения юнитов не порождает (write/idempotent из гейта S4),
// поэтому «сохранить форму целиком» — дёшево и не шумит в ленде.

export function writeFood(doc: Doc<'food'>, food: Food): void {
  doc.name(food.name);
  doc.category(food.category);
  doc.kcal(food.kcal);
  doc.protein(food.protein);
  doc.fat(food.fat);
  doc.carbs(food.carbs);
  doc.pieceGrams(food.pieceGrams ?? null);
  doc.barcode(food.barcode ?? null);
  doc.builtin(food.builtin === true);
  doc.usedCount(food.usedCount);
  doc.lastUsedAt(food.lastUsedAt);
  doc.lastAmountG(food.lastAmountG ?? null);
  doc.createdAt(food.createdAt);
}

export function writeEntry(doc: Doc<'entry'>, entry: Entry): void {
  doc.date(entry.date);
  doc.meal(entry.meal);
  doc.foodId(entry.foodId ?? null);
  doc.name(entry.name);
  doc.amountG(entry.amountG ?? null);
  doc.kcal(entry.kcal);
  doc.protein(entry.protein);
  doc.fat(entry.fat);
  doc.carbs(entry.carbs);
  doc.createdAt(entry.createdAt);
}

export function writeWeight(doc: Doc<'weight'>, weight: WeightLog): void {
  doc.date(weight.date);
  doc.kg(weight.kg);
  doc.createdAt(weight.createdAt);
}

export function writeProfile(doc: Doc<'profile'>, profile: Profile): void {
  doc.sex(profile.sex);
  doc.age(profile.age);
  doc.heightCm(profile.heightCm);
  doc.weightKg(profile.weightKg);
  doc.activity(profile.activity);
  doc.goal(profile.goal);
  doc.targetKcal(profile.targetKcal);
  doc.targetProtein(profile.targetProtein);
  doc.targetFat(profile.targetFat);
  doc.targetCarbs(profile.targetCarbs);
  doc.createdAt(profile.createdAt);
  doc.updatedAt(profile.updatedAt);
}
