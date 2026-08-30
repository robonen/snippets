import { CryptoError } from '@sync/core';
import { landId } from '@brain/module-kit';
import { syncEngine } from './engine';
import { socketWire } from './socket';
import { loadSyncSettings, markSyncLive, syncConfigured } from './settings';
import type { Spaces } from '@brain/module-kit';
import type { Secure, SyncEngine } from './engine';

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
  /** Крипто-политика провода: шифр + подпись (`security/signing`). */
  readonly secure: Secure;
  /** Ленды под синхронизацию: модули и ленды оболочки. */
  readonly lands: readonly string[];
  /** Первый ответ сервера применён — см. `SyncEngineOptions.settled`. */
  readonly settled?: () => void;
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
    secure: options.secure,
    report: syncReporter(),
    ...(options.settled !== undefined && { settled: options.settled }),
    wire: handlers => socketWire(
      { url: settings.url, token: settings.token, onLive: markSyncLive },
      handlers,
    ),
  });
}

/**
 * Отказы приёма — в консоль, но по-человечески. Главный ожидаемый случай:
 * устройство ещё не подключено к пространству, и дельты запечатаны чужими
 * секретами — GCM честно не сходится на каждом кадре. Это не поломка, а
 * состояние «ждёт подключения», и спамить стеками на каждый кадр незачем:
 * одна подсказка на ленд.
 */
function syncReporter(): (error: unknown) => void {
  const hinted = new Set<string>();
  return (error) => {
    if (error instanceof CryptoError) {
      if (hinted.has(error.at)) return;
      hinted.add(error.at);
      console.warn(
        `[brain] синк: данные (${error.at}) запечатаны другим секретом. `
        + 'Если это новое устройство — подключите его: на старом устройстве '
        + 'экран «Доступ» → «Доверять», затем здесь — «Присоединиться».',
      );
      return;
    }
    console.error('[brain] sync:', error);
  };
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
