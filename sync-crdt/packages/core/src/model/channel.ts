// ─── Каналы: `x()` читает, `x(next)` пишет, `x.set(next)` пишет явно ─────────
//
// Ровно та же конвенция, что у `ref`/`computed` в ядре (ограничение 3). Она
// тотальна потому, что `undefined` не является значением НИ ОДНОГО типа схемы:
// `Vary` его не содержит вовсе, значит «аргумента не было» и «записали пустоту»
// не могут совпасть (решение Р6).
//
// Файл — только типы. Реализация каналов живёт в `binding.ts`, где у методов
// есть `this`: ограничение 1 запрещает `this` ПРИКЛАДНИКУ, а не реализации.

import type { Link } from '../binary/link'
import type { LandId } from '../binary/pack'
import type { LocalId } from '../land/view'
import type {
  AtomField,
  DictField,
  Depth,
  Born,
  IndexField,
  LinkField,
  LinksField,
  ListField,
  PartField,
  PartsField,
  TextField,
} from './field'
import type { Derives, Model, Schema } from './model'
import type { Models, ModelName } from './registry'
import type { Issue } from './issue'
import type { Vary } from '../binary/vary'
import type { Key } from './value'

/**
 * Адрес документа внутри ленда.
 *
 * РАСХОЖДЕНИЕ С docs/05, вынужденное ADR-016: там голова — строка, потому что
 * дизайн писался поверх `Replica` на объектах. У боевого ленда на байтах голова
 * — плотный номер узла (`LocalId`), и он же законный ключ `computed.keyed`
 * (`ComputedKey` включает `number`). Строка тут была бы не только медленнее —
 * её пришлось бы МАТЕРИАЛИЗОВАТЬ на каждый lookup, а это ровно те 604 → 1336
 * мкс на 10 000 вставок, из-за которых ADR-016 и выбрал номера.
 */
export type Head = LocalId

/**
 * Автор юнита. Ссылка, а не голые байты: у неё есть канонический текст (`.str`),
 * а сравнение всё равно идёт по байтам (ADR-015).
 */
export type Peer = Link

/**
 * Ключ внутренней ручки на `(ленд, голова, поле)`.
 *
 * Символ, а не строковое поле: имя `spot` в объекте канала пришлось бы
 * зарезервировать, и модель с полем `spot` перестала бы собираться. `unique
 * symbol` даёт то же самое бесплатно и при этом остаётся видимым типам.
 */
export const SPOT: unique symbol = Symbol('sync.spot')

export interface Spot {
  readonly land: LandId
  readonly head: Head
  readonly field: string
}

export interface Handle {
  readonly [SPOT]: Spot
}

export interface AtomChannel<T> extends Handle {
  (): T
  (next: T): T
  /** Явная запись — как в ядре. */
  set(next: T): T
  /** Стереть: постится надгробие. Не то же, что запись пустой строки. */
  clear(): void
  /** Значение до разбора — для диагностики и миграций. */
  raw(): Vary | null
  /** Версия конкретного пира: «кто что писал». */
  by(peer: Peer): T
  /** Проверка ДО записи, для форм. `null` — годится. Ничего не пишет. */
  check(next: T): Issue | null
  /** Почему тут `blank`. `null` — всё в порядке. Второй проход, не горячий путь. */
  issue(): Issue | null
}

export interface ListChannel<T> extends Handle {
  (): readonly T[]
  /** Запись — РЕКОНСИЛЯЦИЯ, а не перезапись: минимальный набор юнитов. */
  (next: readonly T[]): readonly T[]
  set(next: readonly T[]): readonly T[]
  size(): number
  at(index: number): T | null
  has(value: T): boolean
  push(...values: readonly T[]): void
  unshift(...values: readonly T[]): void
  insert(at: number, ...values: readonly T[]): void
  splice(next: readonly T[], from?: number, to?: number): void
  remove(value: T): void
  removeAt(index: number): void
  move(from: number, to: number): void
  clear(): void
  issue(): Issue | null
}

export interface DictChannel<K extends Key, T> extends Handle {
  (key: K): T
  (key: K, next: T): T
  set(key: K, next: T): T
  keys(): readonly K[]
  size(): number
  has(key: K): boolean
  /** Переименование СОХРАНЯЕТ поддерево: тот же `self`, другое значение. */
  rename(from: K, to: K): void
  delete(key: K): void
  clear(): void
  issue(): Issue | null
}

export interface Caret {
  readonly token: Head
  readonly at: number
}

/** Размеченное объединение вместо кортежа-сентинела `['', off, 0]` у baza. */
export type Point =
  | { readonly found: true; readonly caret: Caret }
  | { readonly found: false; readonly rest: number }

export interface TextChannel extends Handle {
  (): string
  (next: string): string
  set(next: string): string
  /**
   * Длина текста.
   *
   * РАСХОЖДЕНИЕ С docs/05 §1.4, где метод назван `length()`. Такое имя
   * НЕВЫПОЛНИМО при решении Р4: канал — это функция, у функции есть собственное
   * свойство `length` с `writable: false`, и `Object.assign(channel,
   * cell.methods)` из `binding.ts` бросает на нём `TypeError` в строгом режиме —
   * то есть падало бы САМО ОТКРЫТИЕ документа с текстовым полем, а не вызов
   * метода. Обойти можно только `Object.defineProperty`, а он запрещён на
   * каналах прямым пунктом docs/05 §3.14 (120 нс против 4, реестр п. 17).
   *
   * Имя `size` не выдумано: так называется тот же вопрос у `list`, `dict`,
   * `links` и `parts` в этом же файле, — то есть текст перестал быть
   * единственным исключением. Заодно `name` зарезервировано по той же причине и
   * методом канала быть не может.
   */
  size(): number
  /** Первый уровень: абзацы. Правка одного не трогает юниты остальных. */
  paragraphs(): readonly string[]
  /** Второй уровень: токены «разделитель + слово». */
  tokens(): readonly string[]
  write(next: string, from: number, to: number): void
  /** Чистые ЧТЕНИЯ, а не действия: зависимость от текста видна графу. */
  pointAt(offset: number): Point
  offsetAt(caret: Caret): number | null
  clear(): void
}

export interface LinkChannel<N extends ModelName> extends Handle {
  (): Doc<N> | null
  (next: Doc<N>): Doc<N> | null
  set(next: Doc<N> | null): Doc<N> | null
  /** Создать, если ещё нет. Идемпотентно: адрес выводится из ссылки поля. */
  ensure(born?: Born): Doc<N>
  clear(): void
}

export interface LinksChannel<N extends ModelName> extends Handle {
  (): readonly Doc<N>[]
  (next: readonly Doc<N>[]): readonly Doc<N>[]
  set(next: readonly Doc<N>[]): readonly Doc<N>[]
  size(): number
  at(index: number): Doc<N> | null
  has(doc: Doc<N>): boolean
  add(doc: Doc<N>): void
  /** Создать новую сущность и сразу привязать. */
  attach(born?: Born): Doc<N>
  remove(doc: Doc<N>): void
  move(from: number, to: number): void
  clear(): void
}

/** Вложенная часть есть всегда — канал только на чтение, как `ComputedRef`. */
export interface PartChannel<N extends ModelName> extends Handle {
  (): Doc<N>
}

export interface PartsChannel<K extends Key, N extends ModelName> extends Handle {
  (key: K): Doc<N>
  keys(): readonly K[]
  size(): number
  has(key: K): boolean
  delete(key: K): void
  clear(): void
}

/** Путь типизирован таблицей, а не рекурсией: рекурсивный `Tuple<N>` дороже для чекера. */
type PathAt<D extends Depth> = {
  1: readonly [Key]
  2: readonly [Key, Key]
  3: readonly [Key, Key, Key]
  4: readonly [Key, Key, Key, Key]
}[D]

type PrefixAt<D extends Depth> = {
  1: readonly []
  2: readonly [] | readonly [Key]
  3: readonly [] | readonly [Key] | readonly [Key, Key]
  4: readonly [] | readonly [Key] | readonly [Key, Key] | readonly [Key, Key, Key]
}[D]

export interface IndexChannel<D extends Depth, N extends ModelName> extends Handle {
  /** Документ по полному пути. `null` — ветки нет, НИЧЕГО не создаётся. */
  (path: PathAt<D>): Doc<N> | null
  keys(prefix: PrefixAt<D>): readonly Key[]
  /** Создать ветку и документ. Каждый уровень рождается по своему `born`. */
  ensure(path: PathAt<D>, born?: Born): Doc<N>
  delete(path: PathAt<D>): void
}

/** Производное поле: читается, не пишется. */
export interface DerivedChannel<T> extends Handle {
  (): T
}

/**
 * Отображение поля в канал — единственный нетривиальный тип слоя.
 *
 * Ветвление идёт по ЛИТЕРАЛЬНОМУ `kind` с дефолтом `never`: `any` не появляется
 * ни в одной ветке, а незнакомое поле даёт `never`, то есть ошибку в точке
 * использования, а не тихую дыру в типах.
 */
export type Chan<F> =
  F extends AtomField<infer T> ? AtomChannel<T> :
  F extends ListField<infer T> ? ListChannel<T> :
  F extends DictField<infer K, infer T> ? DictChannel<K, T> :
  F extends TextField ? TextChannel :
  F extends LinkField<infer N> ? LinkChannel<N> :
  F extends LinksField<infer N> ? LinksChannel<N> :
  F extends PartField<infer N> ? PartChannel<N> :
  F extends PartsField<infer K, infer N> ? PartsChannel<K, N> :
  F extends IndexField<infer D, infer N> ? IndexChannel<D, N> :
  never

type SchemaOf<M> = M extends Model<string, infer S, Derives> ? S : never
type DerivesOf<M> = M extends Model<string, Schema, infer D> ? D : Record<never, never>

/**
 * Документ — замороженный объект каналов, а не экземпляр класса.
 *
 * Рекурсия `User ↔ Post` разворачивается ЛЕНИВО: поле хранит имя цели строкой,
 * поэтому `typeof Post` не содержит и следа `typeof User`, а цикл возникает
 * только при использовании — там, где TypeScript разворачивает индекс интерфейса
 * по требованию.
 *
 * @example
 * ```ts
 * post.author()!.posts()[0]!.author()!.name()   // string, без единой аннотации
 * ```
 */
export type Doc<N extends ModelName> =
  { readonly [K in keyof SchemaOf<Models[N]>]: Chan<SchemaOf<Models[N]>[K]> } &
  { readonly [K in keyof DerivesOf<Models[N]>]: DerivedChannel<DerivesOf<Models[N]>[K]> } &
  { readonly $: DocOps<N> }

/** Операции уровня документа. `$` — единственное зарезервированное имя поля. */
export interface DocOps<N extends ModelName> extends Handle {
  readonly model: N
  /** Абсолютная ссылка: ключ в сети, в devtools и в `link`-полях. */
  link(): Link
  /** Есть ли хоть один юнит. Отличает «пусто» от «не создавали». */
  exists(): boolean
  /** Ссылка на схему (meta-слот). */
  meta(): Link | null
  /** Для UI: гасить кнопку заранее, а не ловить молчаливый отказ записи. */
  canWrite(): boolean
  /** ЯВНО ленивые: полный обход поддерева. Не каналы — чтобы не выглядели дешёвыми. */
  changedAt(): Date | null
  authors(): readonly Peer[]
  /** Ключи, которых нет в схеме: то, что прислал узел новой версии. */
  extras(): readonly Key[]
  drop(): void
}
