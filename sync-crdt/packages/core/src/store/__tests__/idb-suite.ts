// Всё, что обещано про IndexedDB, — ОДНИМ файлом на две среды.
//
// В Node его зовёт `idb.test.ts` с подделкой (быстрый набор), в Chromium —
// `idb.browser.test.ts` с настоящей базой (гейт стадии). Ни одной ветки «если
// браузер»: расхождение сред, которое проверяют разными наборами, — это не
// проверка, а два разных обещания под одним именем.

import { describe, expect, test } from 'vitest'
import { async as fiberAsync, flush } from '@sync/fiber'
import { ROOT, type LocalId } from '../../land/view'
import { atom, createSpace, model, t } from '../../model'
import { idbStore, type IdbStore } from '../idb'
import { openVault } from '../vault'
import { storeContract } from './contract'
import {
  batchOf,
  dbName,
  idbCase,
  landOf,
  revived,
  tornFactory,
  LAND,
  type IdbEnv,
  type Kill,
} from './idb-harness'

const Memo = model('memo-idb', { title: atom(t.string) })

declare module '../../model/registry' {
  interface Models {
    'memo-idb': typeof Memo
  }
}

/**
 * Раскладка `kill9`.
 *
 * Позиций обрыва обязано быть не меньше 1000 (гейт стадии, docs/11 §3), и это
 * проверяет сам тест — считает и краснеет, если их меньше. Числа подобраны так,
 * чтобы позиции набирались ЧАСТО, а образ рос МЕДЛЕННО: каждая позиция стоит
 * одной проверочной загрузки, а её цена — размер образа. Батч поэтому мелкий и
 * наполовину состоит из перезаписей, которые не двигают файл вовсе.
 */
const KILL9_BATCHES = 200
const KILL9_PAGE = 64

export function idbSuite(env: IdbEnv): void {
  // ── Контракт: тот же файл, что и у памяти, без единой правки ────────────────
  //
  // Трижды и с разной раскладкой намеренно: размер страницы и число зеркал — это
  // решения о носителе, и они не имеют права менять СЕМАНТИКУ. Если бы меняли,
  // это была бы находка, а не настройка.
  storeContract(`IndexedDB (${env.what}, страница 4 КиБ)`, idbCase(env))
  storeContract(`IndexedDB (${env.what}, страница 64 Б)`, idbCase(env, { page: 64 }))
  storeContract(`IndexedDB (${env.what}, два зеркала)`, idbCase(env, { mirrors: 2 }))

  describe(`IndexedDB — обрыв записи (${env.what})`, () => {
    test('на каждой позиции обрыва состояние либо до батча, либо после', async () => {
      const name = dbName()
      const kill: Kill = { left: Number.MAX_SAFE_INTEGER, done: 0 }
      const torn = tornFactory(env.factory, kill)

      const make = (factory = torn): IdbStore =>
        idbStore({ name, factory, ranges: env.ranges, page: KILL9_PAGE })

      const store = make()
      const land = landOf()
      const alive: LocalId[] = []

      /** Состояние, которое ОБЯЗАНО читаться после обрыва на этом батче. */
      let before: string[] = []
      let positions = 0

      try {
        for (let batch = 0; batch < KILL9_BATCHES; batch++) {
          // Батч наполовину из перезаписей: они держат образ маленьким, а слот
          // — тем же, то есть проверяют самый частый вход арены.
          let lead = alive.length === 0 ? ROOT : (alive[alive.length - 1] as LocalId)
          for (let i = 0; i < 2; i++) {
            lead = land.post(ROOT, lead, `б${batch}-${i}`).self
            alive.push(lead)
          }
          if (alive.length > 4) {
            const old = alive[batch % (alive.length - 2)] as LocalId
            // Каждая четвёртая перезапись — выносным значением: обрыв обязан быть
            // безопасен и посреди `ball`.
            land.write(ROOT, ROOT, old, batch % 4 === 3 ? `правка-${batch}-${'я'.repeat(80)}` : `правка-${batch}`)
          }
          const pack = land.flush(LAND)

          // Обрываем на 0, 1, 2… `put` — пока транзакция не пройдёт целиком.
          // Каждый оборванный прогон это одна позиция; последний, прошедший, —
          // переход к следующему батчу.
          for (let cut = 0; ; cut++) {
            if (cut > 4096) throw new Error('обрыв не кончается: сохранение не проходит ни при каком запасе')
            kill.left = cut
            let broke = false
            try {
              await store.save(LAND, pack)
            } catch {
              broke = true
            }
            if (!broke) break

            positions += 1

            // «Следующая загрузка» — это ДРУГОЕ соединение, а не наш кэш.
            const fresh = make(env.factory)
            const state = revived(await fresh.load(LAND))
            await fresh.close()

            expect(state, `батч ${batch}, обрыв на ${cut}-м put`).toEqual(before)
          }

          before = revived(await store.load(LAND))
        }

        // Сторож самой модели: если бы обрыв ни разу не случился, весь тест был
        // бы двумя сотнями зелёных прогонов ни о чём.
        console.log(`kill9/${env.what}: ${positions} позиций обрыва, ${KILL9_BATCHES} батчей, страница ${KILL9_PAGE} Б`)
        expect(positions, 'гейт стадии — 1000 позиций обрыва').toBeGreaterThanOrEqual(1000)

        // И данные целы после всего.
        const last = make(env.factory)
        expect(revived(await last.load(LAND))).toEqual(before)
        await last.close()
      } finally {
        kill.left = Number.MAX_SAFE_INTEGER
        await store.close()
      }
    }, 900_000)

    test('оборванная транзакция не оставляет образ в памяти впереди базы', async () => {
      // Самый опасный исход из возможных и единственный, которого нет у файла:
      // `Mirrors.save` правит образ СИНХРОННО, а транзакция отваливается потом.
      // Не забудь мы образ — следующее сохранение записало бы только свежие
      // страницы поверх состояния, которого в базе нет.
      const name = dbName()
      const kill: Kill = { left: Number.MAX_SAFE_INTEGER, done: 0 }
      const store = idbStore({ name, factory: tornFactory(env.factory, kill), ranges: env.ranges })

      try {
        const land = landOf()
        await store.save(LAND, batchOf(land, 'основа', 6))
        const base = revived(await store.load(LAND))

        kill.left = 0
        await expect(store.save(LAND, batchOf(land, 'рвём', 6))).rejects.toThrow(/транзакция/)

        // Тем же стором: он обязан был забыть образ и поднять его из базы.
        kill.left = Number.MAX_SAFE_INTEGER
        expect(revived(await store.load(LAND))).toEqual(base)

        const next = batchOf(land, 'после', 6)
        await store.save(LAND, next)
        const after = revived(await store.load(LAND))
        expect(after.length).toBe(base.length + 6)
        for (const value of base) expect(after).toContain(value)

        // И у следующего соединения то же самое — то есть в базе лежит пачка, а
        // не половина.
        const fresh = idbStore({ name, factory: env.factory, ranges: env.ranges })
        expect(revived(await fresh.load(LAND))).toEqual(after)
        await fresh.close()
      } finally {
        await store.close()
      }
    })
  })

  describe(`IndexedDB — гидрация файбером (${env.what})`, () => {
    /** 47 букв, 91 байт: тот самый заголовок, который до S5 не сохранялся вовсе. */
    const TITLE = 'Заголовок обычной длины для заметки пользователя'

    test('чтение поля модели остаётся синхронным, хотя под ним база', async () => {
      const name = dbName()
      const writer = idbStore({ name, factory: env.factory, ranges: env.ranges })
      const reader = idbStore({ name, factory: env.factory, ranges: env.ranges })

      try {
        const one = landOf()
        createSpace({ land: one }).root(Memo).title(TITLE)
        flush()
        await writer.save(LAND, one.flush(LAND))

        // Читающая сторона: ленд пуст, данные в базе, а прикладное чтение —
        // синхронное. Между ними приостановка файбера, а не `await` (ADR-002).
        const two = landOf(0x55)
        const vault = openVault({ store: reader, id: LAND, land: two })
        const doc = createSpace({ land: two, ready: vault.ready }).root(Memo)

        const seen = await fiberAsync(() => doc.title())
        expect(seen).toBe(TITLE)
        // После гидрации то же чтение уже ничего не стоит — и остаётся синхронным.
        expect(doc.title()).toBe(TITLE)

        vault.close()
      } finally {
        await reader.close()
        await writer.close()
      }
    })

    test('правки уезжают в базу батчем из микрозадачи, а не по юниту', async () => {
      const name = dbName()
      const store = idbStore({ name, factory: env.factory, ranges: env.ranges })

      try {
        const land = landOf()
        const vault = openVault({ store, id: LAND, land })
        await vault.opened()

        const was = store.writes()
        let lead = ROOT
        for (let i = 0; i < 50; i++) lead = land.post(ROOT, lead, `значение-${i}`).self
        flush()

        // Дать микрозадаче хранилища встать в очередь: она поставлена `flush`,
        // а таймер срабатывает уже после всех микрозадач.
        await new Promise<void>(done => setTimeout(done, 0))

        // `load` встаёт в ТУ ЖЕ очередь, что и сохранение, и потому дожидается
        // его конца — ждать по таймеру было бы гонкой: в Chromium запрос к базе
        // не успевает за `setTimeout(0)`, и первая редакция теста краснела
        // ровно на этом, а в Node зеленела.
        expect(revived(await store.load(LAND))).toHaveLength(50)
        // Микрозадача одна на весь тик — значит и транзакция одна, а не 50.
        expect(store.writes() - was).toBe(1)
        vault.close()
      } finally {
        await store.close()
      }
    })
  })
}
