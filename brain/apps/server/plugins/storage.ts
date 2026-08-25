import { definePlugin } from 'nitro';
import { useStorage } from 'nitro/storage';
import fsDriver from 'unstorage/drivers/fs';
import { serverConfig } from '../utils/config';
import { syncHub } from '../utils/instance';

/**
 * Рантаймовое переопределение маунта `data:`.
 *
 * Статичное умолчание объявлено в `nitro.config.ts` (`storage`/`devStorage` —
 * build-time); здесь — документированный путь для значения, известного только
 * на рантайме: задан `DATA_DIR` — маунт перемонтируется на него. Так каталог
 * данных задаётся и в systemd, и в контейнере (`DATA_DIR=/data` + том,
 * docs/04-server.md §3).
 */
export default definePlugin(async (app) => {
  const { dataDir } = serverConfig();
  if (dataDir !== '') {
    const storage = useStorage();
    // Снять маунт из конфига обязательно: mount() поверх существующей базы
    // бросает «already mounted». dispose=false — у fs-драйвера нечего гасить,
    // и снятие происходит без ожидания.
    await storage.unmount('data', false);
    storage.mount('data', fsDriver({ base: dataDir }));
  }

  // Остановка процесса дописывает отложенные образы лендов. Потеря здесь и так
  // не фатальна (клиенты дошлют по фейсам, utils/hub.ts), но зачем терять то,
  // что можно дописать за миллисекунды.
  app.hooks.hook('close', async () => {
    await syncHub().flush();
  });
});
