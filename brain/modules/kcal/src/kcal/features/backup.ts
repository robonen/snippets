import { downloadText } from '@brain/module-kit';
import type { Space } from '@sync/core';
import { MEALS } from '../entities/entry';
import type { Entry, Meal } from '../entities/entry';
import type { Food } from '../entities/food';
import type { Goal, Profile, Sex, WeightLog } from '../entities/profile';
import {
  KcalModel,
  readEntry,
  readFood,
  readProfile,
  readWeight,
  writeEntry,
  writeFood,
  writeProfile,
  writeWeight,
} from '../db/models';

/**
 * Бэкап дневника — формат v1, тот же, что писало отдельное приложение «Ккал».
 *
 * Совместимость здесь не вежливость, а единственная дорога: файл бэкапа — это
 * ЕДИНСТВЕННЫЙ путь, которым данные из старой установки попадают в brain, и
 * менять его номер версии можно только вместе с чтением обеих версий.
 */
export const BACKUP_VERSION = 1;

export interface BackupPayload {
  app: 'kcal';
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  foods: Food[];
  entries: Entry[];
  weights: WeightLog[];
  /**
   * В файлах старого движка профиль носил служебный `id: 'profile'` — артефакт
   * entity-хранилища. Импорт его молча игнорирует: это ЕДИНСТВЕННЫЙ оставшийся
   * путь из старого формата, и он обязан читать такие файлы всегда.
   */
  profile: (Profile & { id?: string }) | null;
}

/** Полный снимок данных для файла-бэкапа. */
export function exportBackup(space: Space): BackupPayload {
  const root = space.root(KcalModel);
  return {
    app: 'kcal',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    foods: root.foods.keys().map(id => readFood(id, root.foods(id))),
    entries: root.entries.keys().map(id => readEntry(id, root.entries(id))),
    weights: root.weights.keys().map(id => readWeight(id, root.weights(id))),
    profile: root.profile().createdAt() > 0 ? readProfile(root.profile()) : null,
  };
}

export interface ImportSummary {
  foods: number;
  entries: number;
  weights: number;
  profile: boolean;
}

/**
 * Восстановление из бэкапа: данные дописываются поверх текущих (слияние по id).
 * Перезагрузка страницы не нужна — чтения реактивны от самого ленда.
 */
export function importBackup(space: Space, payload: BackupPayload): ImportSummary {
  if (payload.app !== 'kcal' || payload.version !== BACKUP_VERSION) {
    throw new Error('File does not look like a Kcal app backup');
  }
  const root = space.root(KcalModel);
  space.edit(() => {
    for (const food of payload.foods) writeFood(root.foods(food.id), food);
    for (const entry of payload.entries) writeEntry(root.entries(entry.id), entry);
    for (const weight of payload.weights) writeWeight(root.weights(weight.id), weight);
    if (payload.profile !== null) writeProfile(root.profile(), payload.profile);
  });

  return {
    foods: payload.foods.length,
    entries: payload.entries.length,
    weights: payload.weights.length,
    profile: payload.profile !== null,
  };
}

/**
 * Разбор файла: текст → выверенный снимок.
 *
 * Проверка идёт до ленда, а не после: `write*` пишет в каналы всё, что дали, и
 * `kcal: "много"` из чужого JSON осел бы в дневнике навсегда — откатывать в
 * CRDT нечего. Поэтому конверт (имя приложения, версия, списки) проверяется
 * строго, а отдельная битая запись выбрасывается, но не топит весь файл: в
 * бэкапе за год одна запись со сбитым id не повод потерять остальные.
 */
export function parseBackup(text: string): { payload: BackupPayload; skipped: number } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  }
  catch {
    throw new Error('File cannot be read: not JSON');
  }
  if (!isRecord(raw)) throw new Error('File does not look like a Kcal app backup');
  if (raw.app !== 'kcal') throw new Error('File does not look like a Kcal app backup');
  if (raw.version !== BACKUP_VERSION) {
    throw new Error(`Format version ${String(raw.version)} is not supported — ${BACKUP_VERSION} required`);
  }

  const foods = list(raw.foods);
  const entries = list(raw.entries);
  const weights = list(raw.weights);
  if (foods === null || entries === null || weights === null) {
    throw new Error('File is corrupted: food and entry lists are out of place');
  }

  const payload: BackupPayload = {
    app: 'kcal',
    version: BACKUP_VERSION,
    exportedAt: str(raw.exportedAt) ?? new Date().toISOString(),
    foods: foods.map(toFood).filter(isPresent),
    entries: entries.map(toEntry).filter(isPresent),
    weights: weights.map(toWeight).filter(isPresent),
    profile: toProfile(raw.profile),
  };
  const kept = payload.foods.length + payload.entries.length + payload.weights.length;
  return { payload, skipped: foods.length + entries.length + weights.length - kept };
}

export function backupFileName(payload: BackupPayload): string {
  return `kcal-backup-${payload.exportedAt.slice(0, 10)}.json`;
}

/** Отдать снимок файлом — общим механизмом скачивания из module-kit. */
export function downloadBackupFile(payload: BackupPayload): void {
  downloadText(backupFileName(payload), JSON.stringify(payload, null, 2), 'application/json');
}

// ── Чтение недоверенного JSON ────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

function list(value: unknown): unknown[] | null {
  // Отсутствующий список — законный старый файл без замеров веса, а не поломка.
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : null;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function maybeNum(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function toFood(raw: unknown): Food | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  const name = str(raw.name);
  if (id === undefined || name === undefined) return null;

  const food: Food = {
    id,
    name,
    category: str(raw.category) ?? 'Прочее',
    kcal: num(raw.kcal),
    protein: num(raw.protein),
    fat: num(raw.fat),
    carbs: num(raw.carbs),
    usedCount: Math.round(num(raw.usedCount)),
    lastUsedAt: num(raw.lastUsedAt),
    createdAt: num(raw.createdAt),
  };
  const pieceGrams = maybeNum(raw.pieceGrams);
  if (pieceGrams !== undefined) food.pieceGrams = pieceGrams;
  const barcode = str(raw.barcode);
  if (barcode !== undefined) food.barcode = barcode;
  if (raw.builtin === true) food.builtin = true;
  const lastAmountG = maybeNum(raw.lastAmountG);
  if (lastAmountG !== undefined) food.lastAmountG = lastAmountG;
  return food;
}

function toEntry(raw: unknown): Entry | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  const date = str(raw.date);
  if (id === undefined || date === undefined) return null;

  const meal = raw.meal;
  const entry: Entry = {
    id,
    date,
    // Незнакомый приём пищи — перекус: запись важнее её раскладки по дню.
    meal: isMeal(meal) ? meal : 'snack',
    name: str(raw.name) ?? 'Запись',
    kcal: num(raw.kcal),
    protein: num(raw.protein),
    fat: num(raw.fat),
    carbs: num(raw.carbs),
    createdAt: num(raw.createdAt),
  };
  const foodId = str(raw.foodId);
  if (foodId !== undefined) entry.foodId = foodId;
  const amountG = maybeNum(raw.amountG);
  if (amountG !== undefined) entry.amountG = amountG;
  return entry;
}

function toWeight(raw: unknown): WeightLog | null {
  if (!isRecord(raw)) return null;
  const date = str(raw.date);
  const kg = maybeNum(raw.kg);
  if (date === undefined || kg === undefined) return null;
  // Замер один на день, поэтому id по умолчанию — сама дата.
  return { id: str(raw.id) ?? date, date, kg, createdAt: num(raw.createdAt) };
}

function toProfile(raw: unknown): Profile | null {
  if (!isRecord(raw)) return null;
  const createdAt = num(raw.createdAt);
  // Профиль «существует» по времени создания — так же, как в ленде.
  if (createdAt <= 0) return null;

  return {
    sex: isSex(raw.sex) ? raw.sex : 'male',
    age: Math.round(num(raw.age, 30)),
    heightCm: num(raw.heightCm, 170),
    weightKg: num(raw.weightKg, 70),
    activity: num(raw.activity, 1.375),
    goal: isGoal(raw.goal) ? raw.goal : 'maintain',
    targetKcal: num(raw.targetKcal, 2000),
    targetProtein: num(raw.targetProtein),
    targetFat: num(raw.targetFat),
    targetCarbs: num(raw.targetCarbs),
    createdAt,
    updatedAt: num(raw.updatedAt, createdAt),
  };
}

function isMeal(value: unknown): value is Meal {
  return typeof value === 'string' && (MEALS as readonly string[]).includes(value);
}

function isSex(value: unknown): value is Sex {
  return value === 'male' || value === 'female';
}

function isGoal(value: unknown): value is Goal {
  return value === 'lose' || value === 'maintain' || value === 'gain';
}
