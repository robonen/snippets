import { computed, shallowRef } from 'vue';
import type { ComputedRef, ShallowRef } from 'vue';

/**
 * Настройки синка — на УСТРОЙСТВЕ, в localStorage: адрес и токен.
 *
 * Токен вернулся (ревизия 3): серверного WebAuthn-входа больше нет — сервер
 * стал слепым пиром без аккаунтов, и его единственная авторизация — общий
 * секрет личного сервера. Токен в localStorage достаёт XSS — это честно
 * записано в модели угроз: он открывает ШИФРТЕКСТ и метаданные, но не данные
 * (payload юнитов запечатан ключами, которых на сервере нет). Подпись
 * identity-ключом вместо токена — следующий шаг вместе с подписями протокола.
 *
 * Адрес живёт в localStorage по той же причине, что и раньше: это настройка
 * ЭТОГО устройства (домашний сервер снаружи и внутри сети зовётся по-разному),
 * а не общее свойство пространства.
 *
 * ПУСТОЙ АДРЕС — «этот же origin»: PWA раздаёт сам сервер синка, и в обычном
 * деплое вводить адрес самого себя не нужно (socket.ts подставит текущий
 * origin). Выключателем служит ТОКЕН: пустой токен — синк выключен, приложение
 * остаётся полностью local-first (сервер без токена всё равно откажет всем).
 */

const URL_KEY = 'brain.sync.url';
const TOKEN_KEY = 'brain.sync.token';

export interface SyncSettings {
  readonly url: string;
  readonly token: string;
}

const settings = shallowRef<SyncSettings>({ url: '', token: '' });
/** Живо ли соединение. Не настройка — состояние, но показывается там же. */
const live = shallowRef(false);

export function loadSyncSettings(storage: Pick<Storage, 'getItem'> = localStorage): SyncSettings {
  settings.value = {
    url: storage.getItem(URL_KEY) ?? '',
    token: storage.getItem(TOKEN_KEY) ?? '',
  };
  return settings.value;
}

export function saveSyncSettings(
  next: SyncSettings,
  storage: Pick<Storage, 'setItem'> = localStorage,
): void {
  // Хвостовой слэш режется здесь, а не при сборке адреса: иначе «сохранил
  // одно — вижу другое» на экране настроек.
  const url = next.url.trim().replace(/\/+$/, '');
  const token = next.token.trim();
  storage.setItem(URL_KEY, url);
  storage.setItem(TOKEN_KEY, token);
  settings.value = { url, token };
}

export function syncConfigured(value: SyncSettings): boolean {
  return value.token !== '';
}

export function markSyncLive(value: boolean): void {
  live.value = value;
}

export function useSyncSettings(): {
  settings: ShallowRef<SyncSettings>;
  configured: ComputedRef<boolean>;
  live: ShallowRef<boolean>;
  save: (next: SyncSettings) => void;
} {
  return {
    settings,
    configured: computed(() => syncConfigured(settings.value)),
    live,
    save: next => saveSyncSettings(next),
  };
}
