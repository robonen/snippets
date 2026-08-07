import { entryStore, foodStore, profileStore, weightStore } from './defs';
import type { Entry, Food, Profile, WeightLog } from '../domain/types';

export interface BackupPayload {
  app: 'kcal';
  version: 1;
  exportedAt: string;
  foods: Food[];
  entries: Entry[];
  weights: WeightLog[];
  profile: Profile | null;
}

/** Полный снимок данных для файла-бэкапа. */
export async function exportBackup(): Promise<BackupPayload> {
  const [foods, entries, weights, profiles] = await Promise.all([
    foodStore.readAll(),
    entryStore.readAll(),
    weightStore.readAll(),
    profileStore.readAll(),
  ]);
  return {
    app: 'kcal',
    version: 1,
    exportedAt: new Date().toISOString(),
    foods,
    entries,
    weights,
    profile: profiles[0] ?? null,
  };
}

/**
 * Восстановление из бэкапа: данные дописываются поверх текущих (merge по id).
 * После импорта проще всего перезагрузить страницу — кэш запросов пересоберётся.
 */
export async function importBackup(payload: BackupPayload): Promise<void> {
  if (payload.app !== 'kcal' || payload.version !== 1) {
    throw new Error('Файл не похож на бэкап приложения «Ккал»');
  }
  await Promise.all([
    payload.foods.length > 0 ? foodStore.write(payload.foods.map(f => ({ key: f.id, value: f }))) : Promise.resolve(),
    payload.entries.length > 0 ? entryStore.write(payload.entries.map(e => ({ key: e.id, value: e }))) : Promise.resolve(),
    payload.weights.length > 0 ? weightStore.write(payload.weights.map(w => ({ key: w.id, value: w }))) : Promise.resolve(),
    payload.profile ? profileStore.write([{ key: payload.profile.id, value: payload.profile }]) : Promise.resolve(),
  ]);
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
