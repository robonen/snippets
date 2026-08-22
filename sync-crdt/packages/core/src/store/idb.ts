// Хранилище на IndexedDB: тот же образ-арена, но носитель — страницы в базе.
//
// ─── Что здесь НЕ пишется заново ─────────────────────────────────────────────
//
// Ни арена, ни индекс ключей, ни протокол атомарности. `PackImage` и `Mirrors`
// достались от памяти как есть, и это не экономия строк, а проверка обещания из
// `store.ts`: «fs/opfs добавят три метода тома, а не второе хранилище». IndexedDB
// добавляет ровно {@link IdbVolume} плюс очередь транзакций.
//
// ─── Раскладка: СТРАНИЦЫ, а не запись на юнит ────────────────────────────────
//
// docs/06 §3 предлагал ключ `[land, unit.path()]` и запись на юнит. Так делать
// нельзя, и причина не в скорости, а в формате: ключ юнита это `(head, peer,
// self)`, и по нему НЕ восстанавливаются ни офсеты, ни свободные слоты, ни
// состояние аллокатора — то есть ровно то, что ADR-005 и docs/06 §4 требуют
// восстанавливать разбором файла. Запись на юнит превращает базу в третье
// представление данных, которое придётся сводить с двумя другими.
//
// Здесь запись — СТРАНИЦА образа: `[land, side, page] → Uint8Array(page)`.
// Склейка страниц по возрастанию номера и есть тот самый файл-пачка, и его
// разбирает тот же `PackCursor`. Цена сохранения при этом пропорциональна
// ИЗМЕНЁННЫМ байтам, а не размеру ленда: батч из 1000 юнитов пачкает 16 страниц
// по 4 КиБ, а не переписывает 5.6 МБ.
//
// ─── Атомарность даёт ТРАНЗАКЦИЯ, а не второе зеркало ────────────────────────
//
// Yin-Yan из docs/06 §4 придуман для файла, где запись рвётся посреди байт. У
// IndexedDB такого состояния не бывает: транзакция применяется целиком или не
// применяется вовсе — это гарантия платформы, а не наша надстройка. Поэтому
// по умолчанию здесь ОДНО зеркало, и вот что при этом остаётся верным:
//
//   • обрыв внутри транзакции   → база на состоянии ДО батча;
//   • обрыв между транзакциями  → база на состоянии ПОСЛЕ предыдущего батча;
//   • потеря хвоста транзакций (`durability: 'relaxed'`, выдернутый шнур) →
//     состояние после какого-то из прежних батчей.
//
// Ни одно из трёх не является «половиной батча» — то есть п. 3 контракта
// выполняется без второго зеркала. Двойка оставлена ручкой (`mirrors: 2`): она
// защищает от потери ХВОСТА транзакций при relaxed-durability, потому что
// сторона 0 коммитится раньше стороны 1 и переживает потерю последней. Цена
// ЗАМЕРЕНА: сохранение батча 1.1 → 3.6 мс (×3.3) и байт на носителе 1716 →
// 3432 КиБ (×2) — по умолчанию её не платят.
//
// ─── Где здесь `flush()` ─────────────────────────────────────────────────────
//
// `Volume.flush()` синхронен, а коммит IndexedDB — нет. Развязка: `flush()`
// отмечает ТОЧКУ КОММИТА, а транзакцию выпускает диск, когда синхронная часть
// `Mirrors.save` уже отработала. Подряд идущие точки одной стороны сливаются в
// ОДНУ транзакцию, и это не ослабление протокола, а его усиление: состояние
// «метка стёрта, юниты не дописаны», которое протокол умеет пережить, здесь
// просто недостижимо.
//
// Опасность у слияния ровно одна, и она снята порядком: страницы читаются в
// момент выпуска транзакции, а не в момент `flush()`, поэтому между ними НИКТО
// не имеет права править образ. Отсюда {@link IdbDisk} с очередью: операции
// одного хранилища исполняются строго по одной.

import { Link } from '../binary/link'
import type { LandId } from '../binary/pack'
import { emptyPack } from './memory'
import { Mirrors } from './mirrors'
import { StoreError, type UnitStore, type Volume } from './store'
import {
  ambientIdb,
  ask,
  ended,
  type IdbDatabase,
  type IdbFactory,
  type IdbRanges,
  type IdbTransaction,
} from './idb-api'

const DB_VERSION = 1
const PAGES = 'pages'
const LANDS = 'lands'

/**
 * Страница — единица записи и чтения.
 *
 * ВЫБРАНА ЗАМЕРОМ (`bench/idb.mjs`, раздел «страница», Chromium 151), а не по
 * аналогии с файловой системой: у IndexedDB своя арифметика, и цену задаёт ЧИСЛО
 * ЗАПИСЕЙ, а не число байт. Развёртка на 20 000 юнитов:
 *
 *   страница   load 100k   батч подряд   Б на правку вразброс   минимум на ленд
 *      512 Б     26.5 мс        4.1 мс                  594 Б            512 Б
 *     4096 Б     13.2 мс        1.1 мс                 2454 Б              4 КиБ
 *    16384 Б     11.0 мс        0.8 мс                 3899 Б             16 КиБ
 *    65536 Б      8.2 мс        0.8 мс                 3932 Б             64 КиБ
 *
 * Крупная страница выигрывает на чтении и на дописывании (меньше строк), мелкая
 * — на ПРАВКЕ ВРАЗБРОС (меньше усиление записи). 4 КиБ взяты потому, что уступают
 * лучшему чтению в 1.6 раза, лучшей записи — в пределах шума, а выигрывают там,
 * где решает арифметика, а не замер: страница это МИНИМУМ НА ЛЕНД, и приложение
 * с тысячей документов платит 4 МБ против 64 МБ у 64-килобайтной страницы.
 */
const PAGE = 4096

/** Пустой массив ключей: `[land, side, []]` — верхняя граница диапазона страниц. */
const ABOVE: readonly unknown[] = []

/**
 * Носитель поверх страниц базы.
 *
 * Образ целиком живёт в памяти — так же, как у файла и у OPFS, и по той же
 * причине (`store.ts`, разбор у {@link Volume}): юниты лежат по офсетам, разбор
 * идёт по всему образу, и ленд из 100 000 юнитов всё равно окажется в памяти.
 * База хранит его страницами, чтобы сохранение платило за изменённое.
 */
class IdbVolume implements Volume {
  #bin: Uint8Array
  readonly #page: number
  /** Номера страниц, изменённых с прошлого коммита. */
  readonly #dirty: Set<number>

  constructor(bin: Uint8Array, page: number) {
    this.#bin = bin
    this.#page = page
    this.#dirty = new Set()
  }

  bin(): Uint8Array {
    return this.#bin
  }

  grow(size: number): Uint8Array {
    if (size <= this.#bin.length) return this.#bin
    // Округление вверх до страницы держит инвариант «длина образа кратна 8»,
    // без которого `PackCursor` считает пачку обрезанной.
    const next = new Uint8Array(Math.ceil(size / this.#page) * this.#page)
    next.set(this.#bin)
    this.#bin = next
    return next
  }

  wrote(at: number, size: number): void {
    if (size <= 0) return
    const last = ((at + size - 1) / this.#page) | 0
    for (let page = (at / this.#page) | 0; page <= last; page++) this.#dirty.add(page)
  }

  flush(): void {
    // Точка коммита. Саму транзакцию выпускает диск — разбор в шапке файла.
  }

  dirty(): ReadonlySet<number> {
    return this.#dirty
  }

  wiped(): void {
    this.#dirty.clear()
  }
}

/** Открытый ленд: тома, их зеркала и признак «база про него уже знает». */
interface LandState {
  readonly id: LandId
  readonly key: string
  readonly volumes: IdbVolume[]
  readonly mirrors: Mirrors
  known: boolean
}

export interface IdbStoreOptions {
  /** Имя базы. Разные имена — разные хранилища в одном происхождении. */
  readonly name?: string
  /**
   * Откуда брать IndexedDB. Явный DI (ADR-010): тест подаёт подделку или
   * обёртку, обрывающую транзакцию, а браузер — свой ambient.
   */
  readonly factory?: IdbFactory
  /** Построитель диапазонов; по умолчанию глобальный `IDBKeyRange`. */
  readonly ranges?: IdbRanges
  /** Размер страницы в байтах, кратный 8. По умолчанию {@link PAGE}. */
  readonly page?: number
  /** Зеркал. По умолчанию одно — разбор в шапке файла. */
  readonly mirrors?: 1 | 2
  /**
   * Насколько настойчиво доводить транзакцию до устройства.
   *
   * `'relaxed'` (умолчание платформы) теряет ХВОСТ транзакций при потере
   * питания, но не рвёт их пополам, — а хвост протокол переживает.
   *
   * Замер (`bench/idb.mjs`, Chromium 151, headless) РАЗНИЦЫ НЕ НАШЁЛ: 1.1 мс на
   * батч в обоих режимах. Это не значит, что её нет вовсе, — значит, что на этой
   * машине и в этом браузере `strict` не стоит ничего сверх, и выбирать между
   * ними надо по гарантии, а не по времени.
   */
  readonly durability?: 'default' | 'relaxed' | 'strict'
}

/** Хранилище на IndexedDB плюс ручки для тестов и бенчей, которых нет в контракте. */
export interface IdbStore extends UnitStore {
  load(land: LandId): Promise<Uint8Array>
  save(land: LandId, pack: Uint8Array): Promise<void>
  ball(land: LandId, shot: Uint8Array): Promise<Uint8Array | undefined>
  drop(land: LandId): Promise<void>
  lands(): Promise<readonly LandId[]>
  /** Сколько юнитов в образе ленда. */
  units(land: LandId): Promise<number>
  /** Полезный объём (заголовок плюс живые слоты) — знаменатель бюджета «≤ 1.3×». */
  live(land: LandId): Promise<number>
  /** Сколько байт лежит В БАЗЕ по этому ленду: страницы всех сторон. */
  bytes(land: LandId): Promise<number>
  /** Сколько транзакций записи выпущено за всё время — цена батчинга числом. */
  writes(): number
  /** Сколько байт уехало в базу за всё время — усиление записи числом. */
  written(): number
  /** Закрыть базу и забыть открытые образы. Данные остаются. */
  close(): Promise<void>
}

/**
 * Хранилище на IndexedDB.
 *
 * @example
 * ```ts
 * const store = idbStore({ name: 'sync' })
 * const vault = openVault({ store, id, land })   // гидрация приостановит файбер
 * await store.save(id, land.flush(id))
 * ```
 */
export function idbStore(options: IdbStoreOptions = {}): IdbStore {
  return new IdbDisk(options).facade()
}

class IdbDisk {
  readonly #name: string
  readonly #factory: IdbFactory
  readonly #ranges: IdbRanges
  readonly #page: number
  readonly #sides: number
  readonly #durability: string
  readonly #lands: Map<string, LandState>
  #db: IdbDatabase | null
  #opening: Promise<IdbDatabase> | null
  /** Очередь операций: коммит читает образ, значит править его между ними нельзя. */
  #gate: Promise<unknown>
  #writes: number
  #written: number

  constructor(options: IdbStoreOptions) {
    const ambient = ambientIdb()
    const factory = options.factory ?? ambient.factory
    const ranges = options.ranges ?? ambient.ranges
    const page = options.page ?? PAGE
    const sides = options.mirrors ?? 1

    if (factory === undefined || ranges === undefined) {
      throw new StoreError(
        'IndexedDB не найден: в Node его нет вовсе, и подавать его надо явно — idbStore({ factory, ranges })',
        'idbStore',
      )
    }
    if (!Number.isInteger(page) || page < 8 || page % 8 !== 0) {
      throw new StoreError(`страница ${page} Б: нужно целое, кратное 8 (все секции формата кратны 8)`, 'idbStore')
    }
    if (sides !== 1 && sides !== 2) {
      throw new StoreError(`зеркал ${sides}: осмысленны 1 (транзакция уже атомарна) и 2`, 'idbStore')
    }

    this.#name = options.name ?? 'sync-crdt'
    this.#factory = factory
    this.#ranges = ranges
    this.#page = page
    this.#sides = sides
    this.#durability = options.durability ?? 'relaxed'
    this.#lands = new Map()
    this.#db = null
    this.#opening = null
    this.#gate = Promise.resolve()
    this.#writes = 0
    this.#written = 0
  }

  facade(): IdbStore {
    return {
      load: (land): Promise<Uint8Array> => this.#serial(() => this.#load(land)),
      save: (land, pack): Promise<void> => this.#serial(() => this.#save(land, pack)),
      ball: (land, shot): Promise<Uint8Array | undefined> => this.#serial(() => this.#ball(land, shot)),
      drop: (land): Promise<void> => this.#serial(() => this.#drop(land)),
      lands: (): Promise<readonly LandId[]> => this.#serial(() => this.#known()),
      units: (land): Promise<number> => this.#serial(async () => (await this.#state(land, false))?.mirrors.units() ?? 0),
      live: (land): Promise<number> => this.#serial(async () => (await this.#state(land, false))?.mirrors.live() ?? 0),
      bytes: (land): Promise<number> => this.#serial(() => this.#bytes(land)),
      writes: (): number => this.#writes,
      written: (): number => this.#written,
      close: (): Promise<void> => this.#serial(() => this.#close()),
    }
  }

  // ── Операции контракта ─────────────────────────────────────────────────────

  async #load(land: LandId): Promise<Uint8Array> {
    const state = await this.#state(land, false)
    // Незнакомый ленд НЕ заводится чтением: `lands()` обещает «какие ленды есть»,
    // и попадать туда от одного взгляда ленд не должен.
    if (state === null) return emptyPack(land)
    // Открытие могло починить разошедшееся зеркало — починка обязана доехать до
    // базы, иначе она будет повторяться на каждой загрузке.
    await this.#commit(state)
    return state.mirrors.pack()
  }

  async #save(land: LandId, pack: Uint8Array): Promise<void> {
    const state = await this.#state(land, true) as LandState
    try {
      state.mirrors.save(pack)
    } catch (cause) {
      // Образ в памяти ушёл вперёд неизвестно насколько — доверять ему нельзя.
      this.#lands.delete(state.key)
      throw new StoreError('пачка не влилась в образ', `ленд ${land.str}`, cause)
    }
    await this.#commit(state)
  }

  async #ball(land: LandId, shot: Uint8Array): Promise<Uint8Array | undefined> {
    const state = await this.#state(land, false)
    return state === null ? undefined : state.mirrors.ball(shot)
  }

  async #drop(land: LandId): Promise<void> {
    const db = await this.#database()
    this.#lands.delete(land.str)

    const tx = db.transaction([PAGES, LANDS], 'readwrite', { durability: this.#durability })
    const pages = tx.objectStore(PAGES)
    for (let side = 0; side < this.#sides; side++) pages.delete(this.#span(land.str, side))
    tx.objectStore(LANDS).delete(land.str)
    this.#writes += 1
    await ended(tx)
  }

  async #known(): Promise<readonly LandId[]> {
    const db = await this.#database()
    const tx = db.transaction(LANDS, 'readonly')
    const rows = await ask(tx.objectStore(LANDS).getAll())
    const out: LandId[] = []
    for (const row of rows) out.push(Link.from(row as Uint8Array))
    return out
  }

  async #bytes(land: LandId): Promise<number> {
    const db = await this.#database()
    const tx = db.transaction(PAGES, 'readonly')
    const store = tx.objectStore(PAGES)
    // Все запросы выпускаются ДО первого `await`: транзакция IndexedDB активна
    // только пока не отдан управление циклу событий, и запрос, поданный после
    // паузы, получает `TransactionInactiveError`.
    const asked: Promise<unknown[]>[] = []
    for (let side = 0; side < this.#sides; side++) asked.push(ask(store.getAllKeys(this.#span(land.str, side))))

    let out = 0
    for (const keys of await Promise.all(asked)) out += keys.length * this.#page
    return out
  }

  async #close(): Promise<void> {
    this.#lands.clear()
    if (this.#db !== null) this.#db.close()
    this.#db = null
    this.#opening = null
  }

  // ── База ───────────────────────────────────────────────────────────────────

  #database(): Promise<IdbDatabase> {
    if (this.#db !== null) return Promise.resolve(this.#db)
    if (this.#opening !== null) return this.#opening

    const request = this.#factory.open(this.#name, DB_VERSION)
    request.onupgradeneeded = (): void => {
      const db = request.result
      if (!db.objectStoreNames.contains(PAGES)) db.createObjectStore(PAGES)
      if (!db.objectStoreNames.contains(LANDS)) db.createObjectStore(LANDS)
    }

    this.#opening = ask(request).then(db => {
      this.#db = db
      this.#opening = null
      return db
    })
    return this.#opening
  }

  /** Диапазон ключей одной стороны: `[land, side] < ключ < [land, side, []]`. */
  #span(key: string, side: number): unknown {
    // Массив сортируется ПОСЛЕ любого другого типа ключа, поэтому `[land, side, []]`
    // — это «всё, что начинается с [land, side]», без знания числа страниц.
    return this.#ranges.bound([key, side], [key, side, ABOVE])
  }

  /**
   * Открытый ленд или `null`, если его в базе нет и заводить не просили.
   *
   * Образ собирается из страниц: непрочитанных дыр не бывает, потому что
   * страница попадает в базу ровно тогда, когда в неё писали, а ненаписанная
   * страница нулевая — то есть прогон свободных слотов, который парсер пропустит.
   */
  async #state(land: LandId, create: boolean): Promise<LandState | null> {
    const key = land.str
    const found = this.#lands.get(key)
    if (found !== undefined) return found

    const db = await this.#database()
    const tx = db.transaction(PAGES, 'readonly')
    const store = tx.objectStore(PAGES)

    // Все запросы выпускаются ДО первого `await`, и это не стиль, а требование
    // платформы: транзакция активна лишь до возврата управления циклу событий.
    // Заодно это правильно по существу — база отвечает на них параллельно.
    //
    // Ключи и значения берутся двумя `getAll*`, а не курсором: курсор — событие
    // НА СТРОКУ, то есть 1400 круговых обходов на образ в 5.6 МБ.
    const asked: Promise<unknown[]>[] = []
    for (let side = 0; side < this.#sides; side++) {
      const span = this.#span(key, side)
      asked.push(ask(store.getAllKeys(span)), ask(store.getAll(span)))
    }
    const rows = await Promise.all(asked)

    const volumes: IdbVolume[] = []
    let stored = 0

    for (let side = 0; side < this.#sides; side++) {
      const keys = rows[side * 2] as unknown[]
      const values = rows[side * 2 + 1] as unknown[]
      stored += keys.length
      volumes.push(new IdbVolume(this.#image(keys, values), this.#page))
    }

    if (stored === 0 && !create) return null

    const state: LandState = {
      id: land,
      key,
      volumes,
      mirrors: Mirrors.open(volumes, land),
      known: stored > 0,
    }
    this.#lands.set(key, state)
    return state
  }

  /** Склейка страниц в образ. Пропуски остаются нулями — это свободные слоты. */
  #image(keys: readonly unknown[], values: readonly unknown[]): Uint8Array {
    if (keys.length === 0) return new Uint8Array(0)

    let top = 0
    for (const key of keys) {
      const page = (key as [string, number, number])[2]
      if (page > top) top = page
    }

    const bin = new Uint8Array((top + 1) * this.#page)
    for (let i = 0; i < keys.length; i++) {
      const page = (keys[i] as [string, number, number])[2]
      bin.set(values[i] as Uint8Array, page * this.#page)
    }
    return bin
  }

  /**
   * Довести изменённые страницы до базы: одна транзакция на сторону.
   *
   * Сторона за стороной, с ожиданием: порядок коммитов — это и есть весь смысл
   * второго зеркала (сторона 0 переживает потерю хвоста транзакций). При одном
   * зеркале цикл делает ровно один оборот.
   *
   * Отказ транзакции означает, что образ в памяти ушёл вперёд носителя, и это
   * САМЫЙ опасный исход из возможных: следующее сохранение записало бы только
   * свежие страницы поверх состояния, которого на диске нет. Поэтому образ
   * забывается целиком — следующее обращение поднимет его разбором из базы.
   */
  async #commit(state: LandState): Promise<void> {
    const db = await this.#database()
    let side = 0

    // `try` на границе всего цикла, а не вокруг одного `await`: обрыв застаёт
    // запись и СИНХРОННО — после `abort()` платформа отвергает следующий `put`
    // немедленно, — и такой отказ обязан приводить к тому же забыванию образа.
    // Первая редакция ловила только отказ транзакции и на синхронном оставляла
    // образ в памяти впереди базы: следующее сохранение дописало бы свежие
    // страницы поверх состояния, которого на носителе нет.
    try {
      for (; side < state.volumes.length; side++) {
        const volume = state.volumes[side] as IdbVolume
        const dirty = volume.dirty()
        const first = side === 0 && !state.known
        if (dirty.size === 0 && !first) continue

        const tx = db.transaction([PAGES, LANDS], 'readwrite', { durability: this.#durability })
        const pages = tx.objectStore(PAGES)
        const bin = volume.bin()

        for (const page of dirty) {
          const at = page * this.#page
          // `slice`, а не `subarray`, и это не осторожность: structured clone
          // копирует ВЕСЬ ArrayBuffer, на который смотрит вид. Окно в образ на
          // 5.6 МБ уехало бы в базу целиком на каждую страницу.
          pages.put(bin.slice(at, at + this.#page), [state.key, side, page])
          this.#written += this.#page
        }

        // Регистрация ленда идёт ТОЙ ЖЕ транзакцией, что и первые страницы:
        // иначе обрыв между ними оставил бы страницы без имени или имя без страниц.
        if (first) tx.objectStore(LANDS).put(state.id.bin.slice(), state.key)

        this.#writes += 1
        await ended(tx)
        volume.wiped()
      }
    } catch (cause) {
      this.#lands.delete(state.key)
      throw new StoreError(
        'транзакция не прошла — образ забыт и будет поднят из базы заново',
        `ленд ${state.key}, зеркало ${side}`,
        cause,
      )
    }

    state.known = true
  }

  // ── Очередь ────────────────────────────────────────────────────────────────

  /**
   * Операции идут строго по одной.
   *
   * Не «для порядка вызовов» (его обещает п. 4 контракта и без очереди), а
   * потому что коммит читает образ в момент выпуска транзакции: правка образа
   * между `Mirrors.save` и коммитом уехала бы в базу вне протокола.
   */
  #serial<T>(task: () => Promise<T>): Promise<T> {
    const next = this.#gate.then(task, task)
    this.#gate = next.then(nothing, nothing)
    return next
  }
}

function nothing(): void {
  // Очередь не должна отравляться отказом одной операции: следующая начинается
  // с чистого листа, а отказ уходит своему вызывающему.
}

/** Удалить базу целиком — для тестов и для «начать с нуля». */
export async function idbWipe(name: string, factory?: IdbFactory): Promise<void> {
  const found = factory ?? ambientIdb().factory
  if (found === undefined) throw new StoreError('IndexedDB не найден', 'idbWipe')
  await ask(found.deleteDatabase(name))
}

/** Тип транзакции наружу — обёртке из тестов обрыва (`kill9`). */
export type { IdbTransaction }
