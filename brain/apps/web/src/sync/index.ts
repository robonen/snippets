import { CORE, packDecode } from '@sync/core';
import { deviceMarks } from './marks';
import { syncEngine } from './engine';
import { socketWire } from './socket';
import { loadSyncSettings, markSyncLive, syncConfigured } from './settings';
import type { Chest, ChestTap, Spaces } from '@brain/module-kit';
import type { LandId } from '@sync/core';
import type { OpenVault } from '@brain/auth';
import type { SyncEngine } from './engine';

/**
 * Сборка синхронизации: сундук + вольт + пространства + сокет.
 *
 * ─── Что НЕ синхронизируется ─────────────────────────────────────────────────
 *
 * Ленды здесь по-прежнему шлют только шифртекст (§8, docs/04-server.md), а
 * мета-ленд с обёртками ключа сюда не входит — он ездит ОТДЕЛЬНЫМ путём,
 * `/account/wraps` (`security/account.ts`), а не через этот журнальный синк.
 * Второе устройство теперь ПОДКЛЮЧАЕТСЯ (docs/01-security.md §7): оно снимает
 * обёртку с сервера через passkey или фразу и получает ТОТ ЖЕ DEK — здесь,
 * в `startSync`, для этого ничего не меняется, вольт просто уже не собственный.
 *
 * ─── Когда живёт ─────────────────────────────────────────────────────────────
 *
 * Между снятием замка и его закрытием, и иначе быть не может: без ключа принятый
 * кусок нечем распечатать. Поэтому подъём идёт из `reveal`, а `conceal` его
 * снимает — вместе с расшифрованными лендами. Присоединение и отзыв
 * (`security/account.ts`) перезапускают этот цикл через `swapVault`
 * (`security/lock.ts`) — той же парой `reveal`/`conceal`, что и обычный
 * замок, только с ДРУГИМ вольтом на входе.
 */

export interface StartSyncOptions {
  readonly spaces: Spaces;
  readonly chest: Chest;
  readonly vault: OpenVault;
  /** Ленды под синхронизацию: модули и ленды оболочки. Мета-ленда здесь нет. */
  readonly lands: readonly LandId[];
}

/**
 * Кран сундука подаётся в `tappedChest` ДО того, как появится ключ, — сундук
 * заводится на старте, а синк живёт только под открытым замком. Поэтому кран
 * здесь один на всё время жизни вкладки, а движок за ним меняется.
 */
let running: SyncEngine | null = null;

export const syncTap: ChestTap = {
  onAppend: (land, chunk, at) => running?.tap.onAppend?.(land, chunk, at),
  onReplace: (land, chunk) => running?.tap.onReplace?.(land, chunk),
  onWipe: land => running?.tap.onWipe?.(land),
};

export function startSync(options: StartSyncOptions): void {
  stopSync();
  const settings = loadSyncSettings();
  // Не настроено — приложение остаётся полностью локальным, без единого запроса.
  if (!syncConfigured(settings)) return;

  const { spaces } = options;
  running = syncEngine({
    lands: options.lands,
    chest: options.chest,
    vault: options.vault,
    marks: deviceMarks(localStorage),
    /**
     * Тот же путь, которым принятая пачка попадает в ленд из соседней вкладки
     * (`syncTabs` в `@sync/core`): разобрать пачку по лендам и применить свою
     * часть. `adopt` здесь был бы дырой — он сваливает в ленд юниты ВСЕХ лендов
     * пачки; `apply` копирует байты и берёт только своё.
     */
    merge: (id, pack) => {
      const owner = spaces.ownerOf(id);
      if (owner === undefined) return;
      const land = spaces.space(owner)[CORE].land;
      for (const [pid, part] of packDecode(pack)) {
        if (pid.str !== id.str) continue;
        if (part.units.length > 0) land.apply(part.units, part.balls);
      }
    },
    // Токена здесь больше нет: cookie сессии едет на рукопожатии сама, единый
    // origin (план Р1/Р2) — `settings.ts` его и не хранит.
    wire: handlers => socketWire({ url: settings.url, onLive: markSyncLive }, handlers),
  });
}

export function stopSync(): void {
  running?.close();
  running = null;
  markSyncLive(false);
}

export { loadSyncSettings, saveSyncSettings, syncConfigured, useSyncSettings } from './settings';
export type { SyncSettings } from './settings';

export {
  fetchAuthenticated,
  fetchLoginOptions,
  fetchRegisterOptions,
  fetchWraps,
  logout,
  putWraps,
  submitLogin,
  submitRegister,
} from './account';
export type { LoginOptions, RegisterOptions, RemoteWrap, RemoteWrapKind } from './account';
