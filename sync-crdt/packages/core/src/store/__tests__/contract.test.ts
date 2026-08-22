// Контракт хранилища на памяти.
//
// Тот же файл `contract.ts` идёт на IndexedDB (`idb.test.ts` в Node,
// `idb.browser.test.ts` в Chromium). Обещание «одно на память, IndexedDB, файл и
// OPFS» проверяется одним набором, а не тремя похожими.

import { memoryStore } from '../memory'
import { storeContract, type StoreCase } from './contract'

storeContract('память', async (): Promise<StoreCase> => {
  const store = memoryStore()
  return {
    store: () => store,
    restart: async (): Promise<void> => {
      // Перезапуск процесса: образы забыты, тома целы. Индексы и пул при
      // следующем обращении восстановятся РАЗБОРОМ.
      store.reopen()
    },
    units: async land => store.units(land),
    // У памяти байты считаются по всем лендам сразу, но набор заводит на тест
    // своё хранилище и живёт в одном ленде — числа совпадают.
    bytes: async () => store.bytes(),
    dispose: async (): Promise<void> => {},
  }
})
