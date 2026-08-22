import { expect, test } from 'vitest'
import { flush } from '@sync/fiber'
import { Link } from '../../../binary/link'
import { fixedClock } from '../../../land/clock'
import { Land } from '../../../land/land'
import { ROOT } from '../../../land/view'
import { memoryStore } from '../../memory'
import type { UnitStore } from '../../store'
import { openVault } from '../../vault'

/**
 * Регрессия: **отказ хранилища терял правки навсегда и молча**.
 *
 * `land.flush(id)` вычёркивает юниты из журнала несохранённого — и делает это ДО
 * того, как выяснится, приняло ли их хранилище. Первая редакция на отказе звала
 * `report`, по умолчанию `console.error`, и на этом всё заканчивалось: в журнале
 * правок уже нет, в хранилище они не попали, повторить некому.
 *
 * Для local-first это худший класс дефекта. Весь смысл подхода в том, что данные
 * принадлежат пользователю и переживают что угодно; а отказ записи — не
 * экзотика, а будни: кончилось место, кончилась квота IndexedDB, отозвано
 * разрешение, вкладка выгружена посреди транзакции.
 *
 * Лечение: непринятое копится и уезжает следующей попыткой, в порядке рождения.
 */

const LAND = Link.land(Link.peer(new Uint8Array(8).fill(0xb1)), new Uint8Array(8))

function landOf(): Land {
  const land = new Land(Link.peer(new Uint8Array(8).fill(1)), fixedClock(1000))
  land.track()
  return land
}

/** Хранилище, которое отказывает, пока `ok` не станет истиной. */
function flaky(): UnitStore & { ok: boolean; saves: number } {
  const inner = memoryStore()
  const store = {
    ok: false,
    saves: 0,
    load: (id: Link) => inner.load(id),
    save(id: Link, pack: Uint8Array) {
      store.saves += 1
      if (!store.ok) throw new Error('диск полон')
      return inner.save(id, pack)
    },
    lands: () => inner.lands(),
    drop: (id: Link) => inner.drop(id),
  }
  return store as UnitStore & { ok: boolean; saves: number }
}

test('правка, не принятая хранилищем, уезжает следующей попыткой', () => {
  const store = flaky()
  const land = landOf()
  const said: unknown[] = []
  const vault = openVault({ store, id: LAND, land, report: (error) => said.push(error) })

  const first = land.post(ROOT, ROOT, 'первая правка')
  vault.save()
  flush()

  // Отказ обязан быть ГРОМКИМ: молчание здесь и было дефектом.
  expect(said).toHaveLength(1)
  expect(String(said[0])).toMatch(/повторной попытки/)

  // Диск ожил — и та же правка уезжает, хотя журнал ленда её уже не помнит.
  store.ok = true
  // За первой, а не в начало: `lead = ROOT` вставлял бы каждый раз в голову, и
  // чтение шло бы задом наперёд — правильное поведение списка, но не тот
  // порядок, который здесь проверяется.
  land.post(ROOT, first.self, 'вторая правка')
  vault.save()
  flush()

  const restored = landOf()
  // `load` объявлен как `Awaitable`: контракт один на память и на IDB. Здесь
  // хранилище синхронное — это ровно та ветка, ради которой синхронность
  // сохранена, — но сузить тип надо явно, а не молчаливым `as`.
  const bin = store.load(LAND)
  if (bin instanceof Promise) throw new Error('память обязана отвечать синхронно')
  restored.adopt(bin)
  const values = restored.order(ROOT).map((view) => view.value)

  // Обе на месте и в порядке рождения: иначе старая версия легла бы поверх новой.
  expect(values).toEqual(['первая правка', 'вторая правка'])
  vault.close()
})

test('повторный отказ не размножает пачки и не теряет их', () => {
  const store = flaky()
  const land = landOf()
  const vault = openVault({ store, id: LAND, land, report: () => {} })

  let lead = ROOT
  for (let i = 0; i < 5; i++) {
    lead = land.post(ROOT, lead, `правка ${i}`).self
    vault.save()
    flush()
  }

  store.ok = true
  vault.save()
  flush()

  const restored = landOf()
  // `load` объявлен как `Awaitable`: контракт один на память и на IDB. Здесь
  // хранилище синхронное — это ровно та ветка, ради которой синхронность
  // сохранена, — но сузить тип надо явно, а не молчаливым `as`.
  const bin = store.load(LAND)
  if (bin instanceof Promise) throw new Error('память обязана отвечать синхронно')
  restored.adopt(bin)
  expect(restored.order(ROOT).map((view) => view.value)).toEqual([
    'правка 0', 'правка 1', 'правка 2', 'правка 3', 'правка 4',
  ])
  vault.close()
})
