// Оснастка для IndexedDB: среда, обрыв записи и общие построители наборов.
//
// Живёт отдельно от самого набора, потому что меняется по другой оси: набор — это
// «что обещано», а здесь «как подсунуть базу и как её сломать». Обе среды
// (подделка в Node и настоящая база в Chromium) отличаются ровно двумя ссылками
// — фабрикой и построителем диапазонов, — и это единственное, что тест обязан
// знать о платформе.

import { Link } from '../../binary/link'
import type { LandId } from '../../binary/pack'
import { fixedClock } from '../../land/clock'
import { Land } from '../../land/land'
import { ROOT } from '../../land/view'
import { idbStore, idbWipe, type IdbStore } from '../idb'
import type {
  IdbDatabase,
  IdbFactory,
  IdbObjectStore,
  IdbOpenRequest,
  IdbRanges,
  IdbRequest,
  IdbTransaction,
} from '../idb-api'
import type { StoreCase } from './contract'

/** Всё, что тесту нужно знать о платформе. */
export interface IdbEnv {
  readonly what: string
  readonly factory: IdbFactory
  readonly ranges: IdbRanges
}

let counter = 0

/** Имя базы, своё на каждый прогон: тесты не имеют права видеть чужие ленды. */
export function dbName(): string {
  counter += 1
  return `sync-crdt-test-${counter}-${Math.floor(Math.random() * 1e9)}`
}

export interface IdbCaseOptions {
  readonly page?: number
  readonly mirrors?: 1 | 2
}

/** Среда контракта поверх IndexedDB. Перезапуск — новое соединение с той же базой. */
export function idbCase(env: IdbEnv, options: IdbCaseOptions = {}): () => Promise<StoreCase> {
  return async (): Promise<StoreCase> => {
    const name = dbName()
    const make = (): IdbStore =>
      idbStore({ name, factory: env.factory, ranges: env.ranges, page: options.page, mirrors: options.mirrors })

    let store = make()

    return {
      store: () => store,
      restart: async (): Promise<void> => {
        // Перезапуск процесса, а не сброс кэша: соединение закрывается, образы
        // забываются, база остаётся. Индексы и пул поднимутся РАЗБОРОМ.
        await store.close()
        store = make()
      },
      units: (land: LandId) => store.units(land),
      bytes: (land: LandId) => store.bytes(land),
      dispose: async (): Promise<void> => {
        await store.close()
        await idbWipe(name, env.factory)
      },
    }
  }
}

// ── Обрыв записи ─────────────────────────────────────────────────────────────

/** Общий запас на всю систему: умирает процесс, а не отдельная транзакция. */
export interface Kill {
  /** Сколько `put` ещё разрешено. Ноль — следующий обрывает транзакцию. */
  left: number
  /** Сколько `put` прошло. */
  done: number
}

/** Запрос-пустышка для `put` после обрыва: его результата всё равно никто не ждёт. */
const VOID_REQUEST: IdbRequest<unknown> = {
  result: undefined,
  error: null,
  onsuccess: null,
  onerror: null,
}

/**
 * Фабрика, у которой запись обрывается на `budget`-м `put`.
 *
 * ПОЧЕМУ ИМЕННО `put`, а не байты. У файла обрыв рвёт поток байт, у IndexedDB —
 * не бывает: транзакция применяется целиком или никак. Значит единица обрыва
 * здесь другая, и модель обязана быть его моделью, а не переносом файловой:
 * «процесс умер, успев подать k запросов из n» — это `tx.abort()` на k+1-м.
 *
 * Читающие запросы запас не тратят: восстановление после обрыва обязано читать
 * сколько угодно.
 */
export function tornFactory(real: IdbFactory, kill: Kill): IdbFactory {
  return {
    open(name: string, version?: number): IdbOpenRequest {
      const request = real.open(name, version)
      return {
        get result(): IdbDatabase {
          return tornDb(request.result, kill)
        },
        get error(): IdbRequest<unknown>['error'] {
          return request.error
        },
        get onsuccess(): (() => void) | null {
          return request.onsuccess
        },
        set onsuccess(fn: (() => void) | null) {
          request.onsuccess = fn
        },
        get onerror(): (() => void) | null {
          return request.onerror
        },
        set onerror(fn: (() => void) | null) {
          request.onerror = fn
        },
        get onupgradeneeded(): (() => void) | null {
          return request.onupgradeneeded
        },
        set onupgradeneeded(fn: (() => void) | null) {
          request.onupgradeneeded = fn
        },
      }
    },
    deleteDatabase: (name: string): IdbRequest<unknown> => real.deleteDatabase(name),
  }
}

function tornDb(real: IdbDatabase, kill: Kill): IdbDatabase {
  return {
    objectStoreNames: real.objectStoreNames,
    createObjectStore: (name: string): IdbObjectStore => real.createObjectStore(name),
    transaction: (names, mode, options): IdbTransaction => tornTx(real.transaction(names, mode, options), kill),
    close: (): void => real.close(),
  }
}

function tornTx(real: IdbTransaction, kill: Kill): IdbTransaction {
  let dead = false

  const store = (name: string): IdbObjectStore => {
    const inner = real.objectStore(name)
    return {
      put(value: unknown, key?: unknown): IdbRequest<unknown> {
        if (dead) return VOID_REQUEST
        if (kill.left <= 0) {
          dead = true
          real.abort()
          return VOID_REQUEST
        }
        kill.left -= 1
        kill.done += 1
        return inner.put(value, key)
      },
      delete: (key: unknown): IdbRequest<unknown> => inner.delete(key),
      getAll: (query?: unknown): IdbRequest<unknown[]> => inner.getAll(query),
      getAllKeys: (query?: unknown): IdbRequest<unknown[]> => inner.getAllKeys(query),
    }
  }

  return {
    get error(): IdbTransaction['error'] {
      return real.error
    },
    objectStore: store,
    abort: (): void => real.abort(),
    get oncomplete(): (() => void) | null {
      return real.oncomplete
    },
    set oncomplete(fn: (() => void) | null) {
      real.oncomplete = fn
    },
    get onerror(): (() => void) | null {
      return real.onerror
    },
    set onerror(fn: (() => void) | null) {
      real.onerror = fn
    },
    get onabort(): (() => void) | null {
      return real.onabort
    },
    set onabort(fn: (() => void) | null) {
      real.onabort = fn
    },
  }
}

// ── Наборы данных ────────────────────────────────────────────────────────────

export const LAND: LandId = Link.land(Link.peer(new Uint8Array(8).fill(0xa1)), new Uint8Array(8))

export function peerOf(byte: number): Link {
  return Link.peer(new Uint8Array(8).fill(byte))
}

export function landOf(byte = 0x11): Land {
  const land = new Land(peerOf(byte), fixedClock(1000))
  land.track()
  return land
}

/** Значения ленда, поднятого из этих байт, — отсортированные, для сравнения множеств. */
export function revived(bin: Uint8Array): string[] {
  const land = new Land(peerOf(0x99), fixedClock(2000))
  land.adopt(bin)
  return land.order(ROOT).map(view => String(view.value)).sort()
}

/**
 * Батч: `count` новых значений, у каждого третьего — выносное.
 *
 * Длины намеренно разные: короткие сидят внутри юнита, длинные уезжают в `ball`.
 * Обрыв обязан быть безопасен и посреди выносного значения.
 */
export function batchOf(land: Land, mark: string, count: number): Uint8Array {
  let lead = ROOT
  for (let i = 0; i < count; i++) {
    const value = i % 3 === 2 ? `${mark}-${i}-${'я'.repeat(80)}` : `${mark}-${i}`
    lead = land.post(ROOT, lead, value).self
  }
  return land.flush(LAND)
}
