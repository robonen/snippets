import { landId } from '@brain/module-kit';
import { syncEngine } from './engine';
import { socketWire } from './socket';
import { loadSyncSettings, markSyncLive, syncConfigured } from './settings';
import type { Spaces } from '@brain/module-kit';
import type { SecretRing } from '@sync/core';
import type { SyncEngine } from './engine';

/**
 * Сборка синхронизации: ленды + связка + сокет.
 *
 * Живёт между снятием замка и его закрытием, и иначе быть не может: без связки
 * принятые юниты нечем распечатать. Поэтому подъём идёт из `reveal`, а
 * `conceal` его снимает — вместе с открытыми лендами (`app/boot.ts`).
 *
 * Мета-путей больше нет: обёртки ключей не ездят на сервер вовсе
 * (`security/keys.ts` — локальные), а секреты между устройствами едут внутри
 * пространства (`security/pairing.ts`), тем же синком, что и данные.
 */

export interface StartSyncOptions {
  readonly spaces: Spaces;
  /** Связка секретов — та же, что открыла ленды. */
  readonly ring: SecretRing;
  /** Ленды под синхронизацию: модули и ленды оболочки. */
  readonly lands: readonly string[];
}

let running: SyncEngine | null = null;
/** Последняя сборка — чтобы смена адреса в настройках пересобрала движок. */
let lastOptions: StartSyncOptions | null = null;

export function startSync(options: StartSyncOptions): void {
  stopSync();
  lastOptions = options;
  const settings = loadSyncSettings();
  // Не настроено — приложение остаётся полностью локальным, без единого запроса.
  if (!syncConfigured(settings)) return;

  running = syncEngine({
    lands: options.lands.map(id => ({ id: landId(id), land: options.spaces.landOf(id) })),
    ring: options.ring,
    wire: handlers => socketWire(
      { url: settings.url, token: settings.token, onLive: markSyncLive },
      handlers,
    ),
  });
}

export function stopSync(): void {
  running?.close();
  running = null;
  markSyncLive(false);
}

/**
 * Пересобрать движок с новыми настройками. Дешёвая операция: ленды и связка
 * не трогаются — прежний `restartSync` через полный teardown лендов умер
 * вместе с конвертом.
 */
export function restartSync(): void {
  if (lastOptions !== null) startSync(lastOptions);
}

export { loadSyncSettings, saveSyncSettings, syncConfigured, useSyncSettings } from './settings';
export type { SyncSettings } from './settings';
