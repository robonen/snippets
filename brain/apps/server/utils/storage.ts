import { createStorage } from 'unstorage';
import fsDriver from 'unstorage/drivers/fs';
import type { Storage } from 'unstorage';

/**
 * Единое хранилище инстанса: журнал лендов, сессии, WebAuthn-credentials,
 * challenge'и и обёртки ключа живут в ОДНОМ unstorage (docs/04-server.md §0 —
 * «файлы через unstorage fs-драйвер, и никакого Redis»).
 *
 * Один инстанс `Storage` на процесс, а не пять раздельных: `DATA_DIR` обязан
 * читаться на рантайме (systemd подаёт окружение уже запущенному процессу), и
 * заводить пять драйверов над одним и тем же каталогом — лишняя жизнь без
 * пользы. Разделение — по префиксу ключа (`head:`, `chunk:`, `session:`,
 * `credential:`, `challenge:`, `wrap:`, `account:`); fs-драйвер превращает `:` в
 * разделитель пути, так что каждый префикс — это свой подкаталог, и раскладки
 * друг другу не мешают (см. `journal.ts` §1 в docs/04-server.md).
 */
let shared: Storage | null = null;

export function useStorage(): Storage {
  shared ??= createStorage({ driver: fsDriver({ base: process.env.DATA_DIR ?? './data' }) });
  return shared;
}
