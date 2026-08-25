import { useStorage } from 'nitro/storage';
import { createHub } from './hub';
import type { Hub } from './hub';

/**
 * Хаб процесса — один на инстанс, над маунтом `data:` (plugins/storage.ts).
 *
 * Отдельный от `hub.ts` файл, потому что `useStorage` живёт только внутри
 * рантайма nitro: сам хаб получает хранилище через DI и гоняется vitest'ом без
 * фреймворка (hub.test.ts).
 */
let hub: Hub | null = null;

export function syncHub(): Hub {
  hub ??= createHub(useStorage('data'));
  return hub;
}
