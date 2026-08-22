// IndexedDB в Node — на подделке.
//
// ЭТО УСКОРИТЕЛЬ, А НЕ ГЕЙТ. Подделка (`fake-indexeddb`, реализация спецификации
// на чистом JS) держит весь набор в общем прогоне `pnpm test`, где он идёт
// секунды. Гейт стадии — `idb.browser.test.ts`: тот же `idbSuite`, но в Chromium
// и против настоящей базы. Если подделка и браузер разойдутся, разойдутся ДВА
// прогона одного файла, и это будет видно.

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import type { IdbFactory, IdbRanges } from '../idb-api'
import { idbSuite } from './idb-suite'

idbSuite({
  what: 'подделка',
  factory: new IDBFactory() as unknown as IdbFactory,
  ranges: IDBKeyRange as unknown as IdbRanges,
})
