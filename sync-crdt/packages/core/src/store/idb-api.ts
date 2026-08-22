// Минимум IndexedDB, которым пользуется хранилище, — и переход от событий к промисам.
//
// ─── Почему свои типы, а не `lib.dom` ────────────────────────────────────────
//
// В `tsconfig.base.json` стоит `lib: ["es2023"]`, и это не упущение: ядро обязано
// собираться и работать в чистом Node (гейт S0), где DOM нет вовсе. Включить
// `lib.dom` ради четырёх интерфейсов значило бы открыть всему пакету `document`,
// `window` и `fetch` — то есть разрешить компилятору пропускать код, который в
// Node упадёт в рантайме.
//
// Здесь объявлено ровно то, что зовётся: пять интерфейсов и два адаптера. Это же
// делает {@link IdbFactory} естественной точкой ЯВНОГО DI (ADR-010) — тест
// подсовывает подделку или обёртку, обрывающую транзакцию, не трогая ambient.
//
// ─── Почему `ask` на запрос, но не на КАЖДЫЙ запрос ──────────────────────────
//
// Промис на каждый `put` — это замыкание, микрозадача и запись в список
// обработчиков на юнит. IndexedDB так работать не обязывает: отказ отдельного
// запроса, который никто не перехватил, ОТМЕНЯЕТ ВСЮ транзакцию, и об этом
// сообщает `onabort`/`onerror` самой транзакции. Поэтому пачка `put` уходит без
// единого промиса, а ждём мы только {@link ended} — один промис на транзакцию.

/** Отказ платформы: `DOMException` структурно, без зависимости от `lib.dom`. */
export interface IdbFault {
  readonly name: string
  readonly message: string
}

/** Запрос IndexedDB: результат приходит событием. */
export interface IdbRequest<T> {
  readonly result: T
  readonly error: IdbFault | null
  onsuccess: (() => void) | null
  onerror: (() => void) | null
}

/** Запрос на открытие базы: у него ещё и миграция схемы. */
export interface IdbOpenRequest extends IdbRequest<IdbDatabase> {
  onupgradeneeded: (() => void) | null
}

export interface IdbFactory {
  open(name: string, version?: number): IdbOpenRequest
  deleteDatabase(name: string): IdbRequest<unknown>
}

/** Построитель диапазонов ключей. Глобальный `IDBKeyRange` структурно. */
export interface IdbRanges {
  bound(lower: unknown, upper: unknown, lowerOpen?: boolean, upperOpen?: boolean): unknown
}

export interface IdbDatabase {
  readonly objectStoreNames: { contains(name: string): boolean }
  createObjectStore(name: string): IdbObjectStore
  transaction(
    names: string | readonly string[],
    mode: 'readonly' | 'readwrite',
    options?: { durability?: string },
  ): IdbTransaction
  close(): void
}

export interface IdbTransaction {
  readonly error: IdbFault | null
  objectStore(name: string): IdbObjectStore
  abort(): void
  oncomplete: (() => void) | null
  onerror: (() => void) | null
  onabort: (() => void) | null
}

export interface IdbObjectStore {
  put(value: unknown, key?: unknown): IdbRequest<unknown>
  delete(key: unknown): IdbRequest<unknown>
  getAll(query?: unknown): IdbRequest<unknown[]>
  getAllKeys(query?: unknown): IdbRequest<unknown[]>
}

/** Ошибка платформы как `Error` — с именем `DOMException` в тексте, а не вместо него. */
function fault(error: IdbFault | null, what: string): Error {
  return new Error(error === null ? what : `${what}: ${error.name} — ${error.message}`)
}

/** Промис на один запрос. Зовётся там, где результат ДЕЙСТВИТЕЛЬНО нужен. */
export function ask<T>(request: IdbRequest<T>): Promise<T> {
  return new Promise((done, fail) => {
    request.onsuccess = (): void => done(request.result)
    request.onerror = (): void => fail(fault(request.error, 'запрос IndexedDB отклонён'))
  })
}

/**
 * Промис на завершение транзакции — точка, в которой запись стала durable.
 *
 * Отмена (`abort`) и отказ (`error`) различаются намеренно: первое — наше
 * решение или обрыв, второе — отказ платформы (квота, повреждение базы).
 * Слить их в один текст значило бы потерять диагностику ровно там, где она
 * нужнее всего.
 */
export function ended(tx: IdbTransaction): Promise<void> {
  return new Promise((done, fail) => {
    tx.oncomplete = (): void => done()
    tx.onerror = (): void => fail(fault(tx.error, 'транзакция IndexedDB отклонена'))
    tx.onabort = (): void => fail(fault(tx.error, 'транзакция IndexedDB отменена'))
  })
}

/** Платформенные ручки, если они есть. Явный DI важнее, но в браузере умолчание разумно. */
export function ambientIdb(): { factory: IdbFactory | undefined; ranges: IdbRanges | undefined } {
  const host = globalThis as { indexedDB?: IdbFactory; IDBKeyRange?: IdbRanges }
  return { factory: host.indexedDB, ranges: host.IDBKeyRange }
}
