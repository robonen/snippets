// Хранилище в памяти — эталонная реализация контракта.
//
// ─── Почему не `Map<LandId, Set<Unit>>`, как обещал docs/06 §2 ───────────────
//
// Карта юнитов была бы не реализацией контракта, а его ОБХОДОМ: в ней нет ни
// арены, ни свободных слотов, ни атомарности — то есть нет ровно того, что
// стадия обязана проверить. Тесты на такой карте зеленели бы, ничего не сообщая
// о боевом хранилище, и `store.kill9` был бы неисполним в принципе.
//
// Здесь тот же `PackImage` и тот же `Mirrors`, что достанутся файлу и OPFS;
// отличается ровно один класс — {@link RamVolume}, у которого «носитель» это
// `Uint8Array`, а `flush()` пуст. Благодаря этому:
//
//   • обрыв записи проверяется на настоящем протоколе — том испытывается
//     подменой, а не заглушкой (`__tests__/kill9.test.ts`);
//   • память остаётся СИНХРОННОЙ, и мультипировые тесты идут без единого
//     `await` (обещание docs/06 §2 выполнено, хоть и другим способом);
//   • fs/opfs добавят три метода тома, а не второе хранилище.

import { packEncode, packPart, type LandId } from '../binary/pack'
import { Mirrors } from './mirrors'
import { StoreError, type UnitStore, type Volume } from './store'

/** Носитель в памяти. Растёт копированием: образ живёт долго, растёт редко. */
export class RamVolume implements Volume {
  #bin: Uint8Array
  /** Сколько байт прошло через {@link RamVolume.wrote} — цена записи числом. */
  #written: number
  #flushes: number

  constructor(bin: Uint8Array = EMPTY) {
    this.#bin = bin
    this.#written = 0
    this.#flushes = 0
  }

  bin(): Uint8Array {
    return this.#bin
  }

  grow(size: number): Uint8Array {
    if (size <= this.#bin.length) return this.#bin
    const next = new Uint8Array(size)
    next.set(this.#bin)
    this.#bin = next
    return next
  }

  wrote(_at: number, size: number): void {
    this.#written += size
  }

  flush(): void {
    this.#flushes += 1
  }

  /** Сколько байт записано за всё время — для бенча и тестов, не для контракта. */
  written(): number {
    return this.#written
  }

  /** Сколько раз доводили до носителя. У файла это число `fsync`. */
  flushes(): number {
    return this.#flushes
  }
}

const EMPTY = new Uint8Array(0)

export interface MemoryStoreOptions {
  /**
   * Сколько зеркал держать. По умолчанию два — устойчивость к обрыву.
   *
   * Единица законна и означает отказ от неё: ею меряется ЦЕНА атомарности в
   * бенче и живут тесты, которым обрыв безразличен. Ноль и больше двух смысла не
   * имеют и отвергаются.
   */
  readonly mirrors?: 1 | 2
}

/**
 * Хранилище в памяти плюс ручки, которых нет в контракте, — для тестов и бенчей.
 *
 * Все методы контракта СУЖЕНЫ до синхронных, и это не украшение типа: обещание
 * «мультипировые тесты идут без единого `await`» (docs/06 §2) иначе живёт только
 * в комментарии, а вызывающий видит `Awaitable` и обязан его разворачивать.
 * Соглашение выражается типом, а не документацией (PRINCIPLES.md, «Типы»).
 */
export interface MemoryStore extends UnitStore {
  load(land: LandId): Uint8Array
  save(land: LandId, pack: Uint8Array): void
  ball(land: LandId, shot: Uint8Array): Uint8Array | undefined
  drop(land: LandId): void
  lands(): readonly LandId[]
  /** Байт на «носителе» по всем лендам и зеркалам. */
  bytes(): number
  /** Полезный объём (заголовок плюс живые слоты) одной стороны. */
  live(land: LandId): number
  /** Сколько юнитов лежит в образе ленда. */
  units(land: LandId): number
  /** Тома ленда — чтобы тест мог оборвать запись или прочитать байты сам. */
  volumes(land: LandId): readonly Volume[]
  /**
   * Забыть открытые образы, оставив тома, — модель перезапуска процесса.
   *
   * Индексы и пул при следующем обращении восстановятся РАЗБОРОМ, то есть будет
   * проверено само обещание «файл хранилища — валидная пачка».
   */
  reopen(): void
}

/**
 * Хранилище в памяти.
 *
 * @example
 * ```ts
 * const store = memoryStore()
 * store.save(id, land.flush(id))
 * const bin = store.load(id)        // синхронно: `await` не нужен
 * ```
 */
export function memoryStore(options: MemoryStoreOptions = {}): MemoryStore {
  const sides = options.mirrors ?? 2
  if (sides !== 1 && sides !== 2) {
    throw new StoreError(`зеркал ${sides}: осмысленны 1 (без устойчивости к обрыву) и 2`, 'memoryStore')
  }

  /** Ленд → его тома. Живут дольше образов: {@link MemoryStore.reopen} рвёт вторые. */
  const disks = new Map<string, RamVolume[]>()
  const open = new Map<string, Mirrors>()
  const names = new Map<string, LandId>()

  function volumesOf(land: LandId): RamVolume[] {
    let found = disks.get(land.str)
    if (found === undefined) {
      found = []
      for (let i = 0; i < sides; i++) found.push(new RamVolume())
      disks.set(land.str, found)
    }
    return found
  }

  function mirrorsOf(land: LandId): Mirrors {
    let found = open.get(land.str)
    if (found === undefined) {
      found = Mirrors.open(volumesOf(land), land)
      open.set(land.str, found)
    }
    return found
  }

  return {
    load(land: LandId): Uint8Array {
      return mirrorsOf(land).pack()
    },

    save(land: LandId, pack: Uint8Array): void {
      // Ленд становится ИЗВЕСТНЫМ от записи, а не от взгляда. Прежняя редакция
      // заводила имя в `volumesOf`, то есть и на `load`: незнакомый ленд, кем-то
      // один раз прочитанный, попадал в `lands()` и после перезагрузки требовал
      // восстановления — при том, что данных у него нет и не было. У IndexedDB
      // так и не получится: там `lands()` читается из базы, а чтение в базу не
      // пишет, — и контракт разошёлся бы между реализациями.
      names.set(land.str, land)
      mirrorsOf(land).save(pack)
    },

    ball(land: LandId, shot: Uint8Array): Uint8Array | undefined {
      return mirrorsOf(land).ball(shot)
    },

    drop(land: LandId): void {
      if (!disks.has(land.str)) return
      mirrorsOf(land).wipe()
      // «Забыть ленд целиком» — значит и перестать его перечислять. Без этой
      // строки `lands()` после `drop` продолжал называть удалённый ленд, и
      // восстановление после перезагрузки поднимало бы пустышку.
      names.delete(land.str)
    },

    lands(): readonly LandId[] {
      const out: LandId[] = []
      for (const id of names.values()) out.push(id)
      return out
    },

    bytes(): number {
      let out = 0
      for (const volumes of disks.values()) {
        for (const volume of volumes) out += volume.bin().length
      }
      return out
    },

    live(land: LandId): number {
      return mirrorsOf(land).live()
    },

    units(land: LandId): number {
      return mirrorsOf(land).units()
    },

    volumes(land: LandId): readonly Volume[] {
      return volumesOf(land)
    },

    reopen(): void {
      open.clear()
    },
  }
}

/** Пустая пачка ленда — то, что видит первый запуск. Для тестов и заглушек. */
export function emptyPack(land: LandId): Uint8Array {
  return packEncode([[land, packPart()]])
}
