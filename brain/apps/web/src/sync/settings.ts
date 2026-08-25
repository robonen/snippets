import { computed, shallowRef } from 'vue';
import type { ComputedRef, ShallowRef } from 'vue';

/**
 * Адрес сервера — на УСТРОЙСТВЕ, в localStorage.
 *
 * Токена здесь больше НЕТ (план Р2): раньше `SYNC_TOKEN` жил тут же и уходил
 * на КАЖДЫЙ синк-запрос — ровно тот класс поверхности, которого
 * docs/01-security.md §3 просит избежать («токен в localStorage не кладём»).
 * После входа синк авторизуется HttpOnly-cookie, которую браузер прикладывает
 * сам; токен нужен только ОДИН РАЗ — при привязке нового сервера
 * (`security/account.ts`, `bindAccount`) — и НЕ переживает эту функцию: поле
 * ввода в UI существует, поле хранения — нет.
 *
 * Адрес живёт в localStorage по той же причине, что и раньше: это настройка
 * ЭТОГО устройства (домашний сервер снаружи и внутри сети зовётся по-разному),
 * а не общее свойство пространства.
 *
 * Пусто — синк выключен. Приложение остаётся полностью local-first: сервер
 * добавляет внешнюю копию шифртекста, но ничего не держит.
 */

const URL_KEY = 'brain.sync.url';

export interface SyncSettings {
  readonly url: string;
}

const settings = shallowRef<SyncSettings>({ url: '' });
/** Живо ли соединение. Не настройка — состояние, но показывается там же. */
const live = shallowRef(false);

export function loadSyncSettings(storage: Pick<Storage, 'getItem'> = localStorage): SyncSettings {
  settings.value = { url: storage.getItem(URL_KEY) ?? '' };
  return settings.value;
}

export function saveSyncSettings(
  next: SyncSettings,
  storage: Pick<Storage, 'setItem'> = localStorage,
): void {
  // Хвостовой слэш режется здесь, а не при сборке адреса: иначе «сохранил
  // одно — вижу другое» на экране настроек.
  const url = next.url.trim().replace(/\/+$/, '');
  storage.setItem(URL_KEY, url);
  settings.value = { url };
}

/**
 * Настроен ли синк. Только адрес: авторизация теперь на cookie, а не на
 * хранимом секрете, — её наличие или отсутствие проверяется САМИМ соединением
 * (сервер откажет на рукопожатии, если сессии нет), а не заранее по localStorage.
 */
export function syncConfigured(value: SyncSettings): boolean {
  return value.url !== '';
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
