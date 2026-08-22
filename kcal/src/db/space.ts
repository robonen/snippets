import {
  Land,
  Link,
  createSpace,
  idbStore,
  openVault,
  randomSession,
  syncTabs,
} from '@sync/core';
import type { Clock, Space } from '@sync/core';
import { SEED_FOODS } from '@/db/seed';
import { KcalModel, writeFood } from '@/db/models';
import { syncServer } from '@/db/server';
import type { ServerSync } from '@/db/server';

/**
 * Сборка пространства — те самые четыре строки, которые мост намеренно не
 * прячет (ADR-018): приложение видит и энтропию сеанса, и выбор хранилища.
 *
 * Пир — 8 случайных байт, чеканится один раз и живёт в localStorage: это
 * идентичность УСТРОЙСТВА до появления ключей (S6). Сеанс — на каждый запуск
 * вкладки свой (ADR-017), иначе две вкладки чеканили бы одинаковые id.
 */

/** Ленд один на приложение, id фиксированный: все вкладки и устройства сходятся в нём. */
const LAND_ID = Link.land(
  Link.peer(new Uint8Array([0x6b, 0x63, 0x61, 0x6c, 0x6b, 0x63, 0x61, 0x6c])),
  new Uint8Array(8),
);

const PEER_KEY = 'kcal.peer';

function devicePeer(): Link {
  const stored = localStorage.getItem(PEER_KEY);
  if (stored !== null) {
    try {
      return Link.parse(stored);
    }
    catch {
      // Битое значение — перечеканиваем: пир не данные, терять нечего.
    }
  }
  const bin = new Uint8Array(8);
  crypto.getRandomValues(bin);
  const link = Link.peer(bin);
  localStorage.setItem(PEER_KEY, link.str);
  return link;
}

/** Часы приложения: секунды эпохи. Ядро время само не берёт — его дают снаружи. */
const wallClock: Clock = {
  now: () => Math.floor(Date.now() / 1000),
};

export interface KcalApp {
  readonly space: Space;
  close(): void;
}

/**
 * Сервер включается переменными окружения — без них дневник остаётся полностью
 * локальным. Сборка Vite подставляет их статически, поэтому в локальной сборке
 * серверного кода нет вовсе.
 */
const SYNC_URL = import.meta.env.VITE_SYNC_URL as string | undefined;
const SYNC_TOKEN = import.meta.env.VITE_SYNC_TOKEN as string | undefined;

/** Поднять дневник: ленд из IndexedDB, канал вкладок, посев или перенос данных. */
export async function openKcal(): Promise<KcalApp> {
  const land = new Land(devicePeer(), wallClock, { session: randomSession() });
  const store = idbStore({ name: 'kcal-sync' });
  const vault = openVault({ store, id: LAND_ID, land });
  const tabs = syncTabs({ land, id: LAND_ID });
  const space = createSpace({ land, id: LAND_ID, ready: vault.ready });

  await vault.opened();
  fillIfEmpty(space);

  let server: ServerSync | null = null;
  // Достаточно токена: сервер живёт в этом же приложении, и по умолчанию обмен
  // идёт со своим origin. VITE_SYNC_URL нужен только для внешнего сервера.
  if (SYNC_TOKEN !== undefined && SYNC_TOKEN !== '') {
    const interval = Number(import.meta.env.VITE_SYNC_INTERVAL ?? '') || undefined;
    server = syncServer({ land, id: LAND_ID, url: SYNC_URL ?? '', token: SYNC_TOKEN, intervalMs: interval });
  }

  return {
    space,
    close() {
      server?.close();
      tabs.close();
      vault.close();
    },
  };
}

// ── Первый запуск ────────────────────────────────────────────────────────────

/**
 * Пустой ленд засевается стартовым каталогом продуктов — один раз.
 * Повторного посева не случится: ленд уже не пуст.
 *
 * Данные старого движка отсюда больше не переносятся; единственный путь из
 * прошлого — импорт файла бэкапа на экране профиля (формат тот же, v1).
 */
function fillIfEmpty(space: Space): void {
  const root = space.root(KcalModel);
  if (root.foods.size() > 0 || root.entries.size() > 0 || root.$.exists()) return;

  space.edit(() => {
    for (const food of SEED_FOODS) writeFood(root.foods(food.id), food);
  });
}
