// IndexedDB в Chromium — ГЕЙТ СТАДИИ S5.
//
// Идёт по `pnpm --filter @sync/core test:browser` и гоняет ТОТ ЖЕ `idbSuite`,
// что и node'овый прогон на подделке. Разница ровно в двух ссылках — фабрика и
// построитель диапазонов, — и она подаётся явно (ADR-010), а не берётся из
// ambient внутри хранилища.
//
// ПОЧЕМУ ЭТОТ ФАЙЛ ОБЯЗАН БЫТЬ. Подделка — это чужой JS поверх обычных объектов:
// у неё нет ни настоящих транзакций, ни настоящего structured clone, ни
// собственной оценки того, сколько стоит запись. Всё, ради чего S5 выбирает
// IndexedDB, живёт именно в браузере, а подделка отвечает только за скорость
// основного набора. Проверка, которая может молча не сработать, хуже её
// отсутствия: если Chromium не поднимется, `vitest --browser` упадёт, а не
// уйдёт в «пропущено».

import { ambientIdb } from '../idb-api'
import { idbSuite } from './idb-suite'

const ambient = ambientIdb()
if (ambient.factory === undefined || ambient.ranges === undefined) {
  throw new Error('браузерный прогон без IndexedDB: гейт S5 не может быть исполнен на этой странице')
}

idbSuite({ what: 'Chromium', factory: ambient.factory, ranges: ambient.ranges })
