import type { Space } from '@sync/core';
import type { Entry } from '@/entities/entry';
import type { Food } from '@/entities/food';
import type { Profile, WeightLog } from '@/entities/profile';
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
} from '@/db/models';

export interface BackupPayload {
  app: 'kcal';
  version: 1;
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

/** Полный снимок данных для файла-бэкапа. Формат совместим со старым (v1). */
export function exportBackup(space: Space): BackupPayload {
  const root = space.root(KcalModel);
  return {
    app: 'kcal',
    version: 1,
    exportedAt: new Date().toISOString(),
    foods: root.foods.keys().map(id => readFood(id, root.foods(id))),
    entries: root.entries.keys().map(id => readEntry(id, root.entries(id))),
    weights: root.weights.keys().map(id => readWeight(id, root.weights(id))),
    profile: root.profile().createdAt() > 0 ? readProfile(root.profile()) : null,
  };
}

/**
 * Восстановление из бэкапа: данные дописываются поверх текущих (слияние по id).
 * Перезагрузка страницы больше не нужна — чтения реактивны от самого ленда.
 */
export function importBackup(space: Space, payload: BackupPayload): void {
  if (payload.app !== 'kcal' || payload.version !== 1) {
    throw new Error('Файл не похож на бэкап приложения «Ккал»');
  }
  const root = space.root(KcalModel);
  space.edit(() => {
    for (const food of payload.foods) writeFood(root.foods(food.id), food);
    for (const entry of payload.entries) writeEntry(root.entries(entry.id), entry);
    for (const weight of payload.weights) writeWeight(root.weights(weight.id), weight);
    if (payload.profile !== null) writeProfile(root.profile(), payload.profile);
  });
}

export function downloadBackupFile(payload: BackupPayload): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `kcal-backup-${payload.exportedAt.slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
