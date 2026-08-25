import { definePlugin } from 'nitro';
import { useStorage } from 'nitro/storage';
import cloudflareKvHttpDriver from 'unstorage/drivers/cloudflare-kv-http';
import fsDriver from 'unstorage/drivers/fs';
import { serverConfig } from '../utils/config';
import { syncHub } from '../utils/instance';

/**
 * Рантаймовое переопределение маунта `data:`.
 *
 * Статичное умолчание объявлено в `nitro.config.ts` (`storage`/`devStorage` —
 * build-time); здесь — документированный путь для значений, известных только
 * на рантайме, по старшинству:
 *
 *   1. **Cloudflare KV** (`CLOUDFLARE_KV_*` заполнены целиком) — продакшен.
 *      Драйвер REST-овый (`cloudflare-kv-http`): сервер остаётся обычным
 *      node-процессом, ключей Workers ему не нужно. Сырые байты образов ядро
 *      unstorage возит через base64-фолбэк само — хабу всё равно.
 *      KV эвентуально консистентен — для нас это не угроза по построению:
 *      истина живёт в памяти процесса (один инстанс), KV — ленивый снапшот, а
 *      отставший после рестарта образ долечивает первый же привет клиента по
 *      фейсам (docs/04-server.md «персист ленив»).
 *   2. **`DATA_DIR`** — файловое хранилище своего железа (systemd).
 *   3. Ничего не задано — маунт из конфига (./.data | ./.data-dev).
 */
export default definePlugin((app) => {
  const { cloudflareKv, dataDir } = serverConfig();

  const kvReady = cloudflareKv.accountId !== ''
    && cloudflareKv.namespaceId !== ''
    && cloudflareKv.apiToken !== '';

  if (kvReady) {
    useStorage().mount('data', cloudflareKvHttpDriver({
      accountId: cloudflareKv.accountId,
      namespaceId: cloudflareKv.namespaceId,
      apiToken: cloudflareKv.apiToken,
    }));
  }
  else if (dataDir !== '') {
    useStorage().mount('data', fsDriver({ base: dataDir }));
  }

  // Остановка процесса дописывает отложенные образы лендов. Потеря здесь и так
  // не фатальна (клиенты дошлют по фейсам, utils/hub.ts), но зачем терять то,
  // что можно дописать за миллисекунды.
  app.hooks.hook('close', async () => {
    await syncHub().flush();
  });
});
