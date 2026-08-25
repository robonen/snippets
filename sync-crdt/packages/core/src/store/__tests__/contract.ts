// Контракт хранилища одним набором на все реализации.
//
// ─── Зачем набор вынесен из тестового файла ──────────────────────────────────
//
// Обещание `store.ts` — «одно обещание на память, IndexedDB, файл и OPFS» — до
// сих пор проверялось ТОЛЬКО на памяти. Набор, живущий в файле одной реализации,
// такое обещание не проверяет вовсе: вторая реализация неизбежно получит свой
// набор, написанный из тех же предположений, что и её код (PRINCIPLES.md,
// «Наблюдение, стоящее отдельной строки»).
//
// Поэтому здесь ни одного упоминания памяти или базы: набор видит только
// {@link UnitStore} и три ручки среды, без которых обещание непроверяемо, —
// перезапуск, счётчик юнитов и занятые байты.
//
// ─── Почему всё через `await` ────────────────────────────────────────────────
//
// Контракт разрешает вернуть значение ИЛИ промис (`store.ts`, п. 5). `await` над
// значением — это микрозадача и ничего больше, а над промисом — ожидание;
// именно поэтому один и тот же файл идёт на синхронной памяти и на асинхронной
// базе БЕЗ ЕДИНОЙ ПРАВКИ. Отдельный набор «для синхронных» и «для асинхронных»
// был бы двумя разными контрактами под одним именем.

import { describe, expect, test } from 'vitest'
import { Link } from '../../binary/link'
import { PACK_STEP, PackCursor, packDecode } from '../../binary/pack'
import { SandUnit } from '../../binary/unit'
import { fixedClock } from '../../land/clock'
import { Land } from '../../land/land'
import { ROOT } from '../../land/view'
import type { LandId } from '../../binary/pack'
import type { UnitStore } from '../store'

/** Ленд, на котором идёт весь набор. */
export const LAND: LandId = Link.land(Link.peer(new Uint8Array(8).fill(0xa1)), new Uint8Array(8))

/**
 * Среда одной реализации.
 *
 * Три ручки сверх контракта, и каждая обязательна по существу:
 * `restart` — потому что «состояние аллокатора восстанавливается разбором»
 * непроверяемо без перезапуска; `units` и `bytes` — потому что «замещение по
 * ключу» и «файл не растёт» это утверждения о ХРАНИЛИЩЕ, а не о выдаче.
 */
export interface StoreCase {
  /** Текущее хранилище. Читается заново после каждого {@link StoreCase.restart}. */
  store(): UnitStore
  /** Перезапуск процесса: образы забыты, носитель цел. */
  restart(): Promise<void>
  /** Сколько юнитов лежит в образе ленда. */
  units(land: LandId): Promise<number>
  /** Сколько байт занято на носителе под этот ленд. */
  bytes(land: LandId): Promise<number>
  /** Отпустить ресурсы среды. */
  dispose(): Promise<void>
}

function peerOf(byte: number): Link {
  return Link.peer(new Uint8Array(8).fill(byte))
}

function landOf(byte = 0x11): Land {
  const land = new Land(peerOf(byte), fixedClock(1000))
  land.track()
  return land
}

/** Значения ленда, поднятого из этих байт, — то, что увидит пользователь. */
function revived(bin: Uint8Array, peer = 0x99): unknown[] {
  const land = new Land(peerOf(peer), fixedClock(2000))
  land.adopt(bin)
  return land.order(ROOT).map(view => view.value)
}

function shotOf(unit: SandUnit): string {
  return [...unit.shot()].map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Прогнать контракт на одной реализации.
 *
 * @example
 * ```ts
 * storeContract('память', async () => ({ store: () => memory, … }))
 * storeContract('IndexedDB', async () => ({ store: () => idb, … }))
 * ```
 */
export function storeContract(name: string, open: () => Promise<StoreCase>): void {
  /** Каждому тесту — своя среда: общая давала бы им видеть чужие ленды. */
  async function fresh(): Promise<StoreCase> {
    return await open()
  }

  describe(`store contract — ${name}`, () => {
    describe('a pack, not units', () => {
      test('save → load yields the same values, external ones included', async () => {
        const it = await fresh()
        try {
          const land = landOf()
          land.post(ROOT, ROOT, 'коротко')
          // 300 букв кириллицы — 600 байт: значение уезжает в `ball`. Ровно тот
          // случай, из-за которого стадия S5 и заведена (docs/11, «Модели S4»).
          land.post(ROOT, ROOT, 'я'.repeat(300))
          land.post(ROOT, ROOT, { вложено: [1, 2, 3] })

          await it.store().save(LAND, land.flush(LAND))
          const back = revived(await it.store().load(LAND))
          expect(back.sort()).toEqual(land.order(ROOT).map(view => view.value).sort())
        } finally {
          await it.dispose()
        }
      })

      test('an unknown land returns an empty pack, not a refusal', async () => {
        const it = await fresh()
        try {
          const bin = await it.store().load(LAND)
          expect(packDecode(bin)).toHaveLength(1)
          expect(packDecode(bin)[0]?.[1].units).toHaveLength(0)
          expect(revived(bin)).toEqual([])
        } finally {
          await it.dispose()
        }
      })

      test('load bytes belong to the caller: editing the image does not touch them', async () => {
        const it = await fresh()
        try {
          const land = landOf()
          land.post(ROOT, ROOT, 'первое')
          await it.store().save(LAND, land.flush(LAND))

          const before = await it.store().load(LAND)
          land.post(ROOT, ROOT, 'второе')
          await it.store().save(LAND, land.flush(LAND))

          expect(revived(before)).toEqual(['первое'])
          expect(revived(await it.store().load(LAND)).sort()).toEqual(['второе', 'первое'].sort())
        } finally {
          await it.dispose()
        }
      })
    })

    describe('removal is replacement by key', () => {
      test('overwriting a value adds no unit to the image', async () => {
        const it = await fresh()
        try {
          const land = landOf()
          const view = land.post(ROOT, ROOT, 'раз')
          await it.store().save(LAND, land.flush(LAND))
          expect(await it.units(LAND)).toBe(1)

          for (const value of ['два', 'три', 'четыре']) {
            land.write(ROOT, ROOT, view.self, value)
            await it.store().save(LAND, land.flush(LAND))
          }

          expect(await it.units(LAND)).toBe(1)
          expect(revived(await it.store().load(LAND))).toEqual(['четыре'])
        } finally {
          await it.dispose()
        }
      })

      test('a tombstone replaces the live version instead of lying beside it', async () => {
        const it = await fresh()
        try {
          const land = landOf()
          const view = land.post(ROOT, ROOT, 'жил')
          land.remove(view.self)
          await it.store().save(LAND, land.flush(LAND))

          expect(await it.units(LAND)).toBe(1)
          expect(revived(await it.store().load(LAND))).toEqual([])
        } finally {
          await it.dispose()
        }
      })

      test('versions of DIFFERENT peers live under different keys', async () => {
        const it = await fresh()
        try {
          const first = landOf(0x11)
          const second = landOf(0x22)
          const view = first.post(ROOT, ROOT, 'от первого')

          second.apply(first.part().units, first.part().balls)
          second.write(ROOT, ROOT, view.self, 'от второго')

          await it.store().save(LAND, first.flush(LAND))
          await it.store().save(LAND, second.flush(LAND))
          expect(await it.units(LAND)).toBe(2)
        } finally {
          await it.dispose()
        }
      })
    })

    describe('the medium is a valid pack and an arena at once', () => {
      test('a restart restores both the data and the allocator state', async () => {
        const it = await fresh()
        try {
          const land = landOf()
          const view = land.post(ROOT, ROOT, 'а'.repeat(40))
          await it.store().save(LAND, land.flush(LAND))

          // Значение другой длины освобождает прежний слот.
          land.write(ROOT, ROOT, view.self, 'б')
          await it.store().save(LAND, land.flush(LAND))
          const grown = await it.bytes(LAND)

          await it.restart()
          expect(revived(await it.store().load(LAND))).toEqual(['б'])

          // Освобождённый слот найден РАЗБОРОМ — новый юнит той же длины садится
          // в него, и носитель не растёт. Именно это обещает docs/06 §4.
          const again = landOf(0x33)
          again.post(ROOT, ROOT, 'в'.repeat(40))
          await it.store().save(LAND, again.flush(LAND))
          expect(await it.bytes(LAND)).toBe(grown)
        } finally {
          await it.dispose()
        }
      })

      test('the image parses with a cursor and carries free slots', async () => {
        const it = await fresh()
        try {
          const land = landOf()
          const view = land.post(ROOT, ROOT, 'коротко')
          await it.store().save(LAND, land.flush(LAND))
          land.write(ROOT, ROOT, view.self, 'значительно длиннее прежнего значения, чтобы слот сменился')
          await it.store().save(LAND, land.flush(LAND))

          // Читаем то, что реально уедет потребителю: пачку живых юнитов. Она
          // обязана разбираться курсором и содержать ровно один юнит.
          const cursor = new PackCursor(await it.store().load(LAND))
          let units = 0
          for (let step = cursor.next(); step !== PACK_STEP.end; step = cursor.next()) {
            if (step === PACK_STEP.unit) units += 1
          }
          expect(units).toBe(1)
        } finally {
          await it.dispose()
        }
      })
    })

    describe('ordering and batches', () => {
      test('load after save sees what was saved, call order is preserved', async () => {
        const it = await fresh()
        try {
          const land = landOf()
          let lead = ROOT
          for (const value of ['а', 'б', 'в']) {
            lead = land.post(ROOT, lead, value).self
            await it.store().save(LAND, land.flush(LAND))
          }
          expect(revived(await it.store().load(LAND))).toEqual(['а', 'б', 'в'])
        } finally {
          await it.dispose()
        }
      })

      test('an empty pack changes nothing', async () => {
        const it = await fresh()
        try {
          const land = landOf()
          land.post(ROOT, ROOT, 'раз')
          await it.store().save(LAND, land.flush(LAND))
          const was = await it.bytes(LAND)

          await it.store().save(LAND, land.flush(LAND))
          expect(await it.bytes(LAND)).toBe(was)
          expect(await it.units(LAND)).toBe(1)
        } finally {
          await it.dispose()
        }
      })

      test('saves submitted back to back without awaiting apply in order', async () => {
        const it = await fresh()
        try {
          // Ровно то, что делает `vault`: пачка уходит из микрозадачи и никто не
          // ждёт её конца. Порядок обязан держать сам стор (п. 4 контракта).
          const land = landOf()
          const view = land.post(ROOT, ROOT, 'раз')
          const packs: Uint8Array[] = [land.flush(LAND)]
          for (const value of ['два', 'три', 'четыре']) {
            land.write(ROOT, ROOT, view.self, value)
            packs.push(land.flush(LAND))
          }

          await Promise.all(packs.map(pack => it.store().save(LAND, pack)))
          expect(revived(await it.store().load(LAND))).toEqual(['четыре'])
          expect(await it.units(LAND)).toBe(1)
        } finally {
          await it.dispose()
        }
      })
    })

    describe('external values', () => {
      test('ball is served by hash without raising the land', async () => {
        const it = await fresh()
        try {
          const land = landOf()
          land.post(ROOT, ROOT, 'я'.repeat(400))
          await it.store().save(LAND, land.flush(LAND))

          const unit = land.part().units[0] as SandUnit
          expect(unit.big()).toBe(true)

          const ball = await it.store().ball(LAND, unit.shot())
          expect(ball).toBeDefined()
          expect([...(ball as Uint8Array)]).toEqual([...(land.part().balls.get(shotOf(unit)) as Uint8Array)])
          expect(await it.store().ball(LAND, new Uint8Array(12).fill(7))).toBeUndefined()
        } finally {
          await it.dispose()
        }
      })

      test('overwriting a big value does not leave the previous ball in the map', async () => {
        const it = await fresh()
        try {
          const land = landOf()
          const view = land.post(ROOT, ROOT, 'я'.repeat(400))
          const first = (land.part().units[0] as SandUnit).shot()
          await it.store().save(LAND, land.flush(LAND))

          land.write(ROOT, ROOT, view.self, 'ю'.repeat(400))
          await it.store().save(LAND, land.flush(LAND))

          expect(await it.store().ball(LAND, first)).toBeUndefined()
          expect(await it.units(LAND)).toBe(1)
        } finally {
          await it.dispose()
        }
      })

      test('an external value survives a restart', async () => {
        const it = await fresh()
        try {
          const land = landOf()
          const long = 'Заголовок обычной длины для заметки пользователя'.repeat(3)
          land.post(ROOT, ROOT, long)
          const shot = (land.part().units[0] as SandUnit).shot()
          await it.store().save(LAND, land.flush(LAND))

          await it.restart()
          expect(revived(await it.store().load(LAND))).toEqual([long])
          expect(await it.store().ball(LAND, shot)).toBeDefined()
        } finally {
          await it.dispose()
        }
      })
    })

    describe('lands', () => {
      test('lands lists the saved ones, drop forgets a land', async () => {
        const it = await fresh()
        try {
          const land = landOf()
          land.post(ROOT, ROOT, 'раз')
          await it.store().save(LAND, land.flush(LAND))

          expect((await it.store().lands()).map(id => id.str)).toEqual([LAND.str])

          await it.store().drop(LAND)
          expect(await it.units(LAND)).toBe(0)
          expect(revived(await it.store().load(LAND))).toEqual([])
          expect((await it.store().lands()).map(id => id.str)).toEqual([])
        } finally {
          await it.dispose()
        }
      })

      test('reading an unknown land does not make it known', async () => {
        const it = await fresh()
        try {
          await it.store().load(LAND)
          // Иначе `lands()` — «какие ленды я когда-то видел», и восстановление
          // после перезагрузки поднимает пустышки.
          expect((await it.store().lands()).map(id => id.str)).toEqual([])
        } finally {
          await it.dispose()
        }
      })

      test('drop of an unknown land is not an error', async () => {
        const it = await fresh()
        try {
          await it.store().drop(LAND)
          expect((await it.store().lands())).toEqual([])
        } finally {
          await it.dispose()
        }
      })
    })
  })
}
