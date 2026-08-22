# 05. Модели: схема — источник истины

Слой между сырыми юнитами ленда и прикладным кодом: объявление модели — это **данные**, документ — **замороженный объект каналов**, а поле читается и пишется той же конвенцией, что и `ref`/`computed` в ядре. Ни классов, которые пишет прикладник, ни `this`, ни патчинга прототипов.

Эта редакция **заменяет** предыдущую целиком. Прежний §3 объявлял модель через `Object.defineProperty(Model.prototype, key)` + `memKey` — см. [§9](#9-расхождения-с-планом-docs05), там разобрано, почему это отвергнуто.

> **Проверено компилятором, а не обещано.** Три варианта API проектировались независимо и оценивались тремя судьями с разными линзами; двое из трёх опубликовали код, который **не компилируется** — взаимная рекурсия моделей рассыпалась каскадом `TS7022`/`TS7024`, а предложенный там же обходной путь требовал полного дубля схемы. Победил единственный вариант, прошедший сборку.
>
> Собранная редакция проверена отдельно, на стенде с боевым `tsconfig.base.json` (`strict`, `noUncheckedIndexedAccess`, `erasableSyntaxOnly`, `verbatimModuleSyntax`), в обе стороны:
>
> - правильный код собирается **без единой аннотации**, включая `post.author()!.posts()[0]!.author()!.name(): string` — взаимную рекурсию `User ↔ Post` через реестр;
> - неправильный **не** собирается, и с внятным сообщением: опечатка поля → `Property 'titel' does not exist on type 'Doc<"post">'. Did you mean 'title'?`; чужое имя модели → `Argument of type '"psot"' is not assignable to parameter of type 'ModelName'`; `atom(t.enum([…]))` без `.or()` → `Cast<…> is not assignable to Type<…>`; забытая проверка ссылки на `null` → `Object is possibly 'null'`.
>
> Последняя строка — та самая, ради которой затеяно разделение `Cast`/`Type` (Р5): молчаливая подстановка `Options[0]` из `$mol_schema_enum` стала **невыразимой**, а не запрещённой на словах.

---

## 0. Решения, из которых следует всё остальное

| # | Решение | Почему так | Чем платим |
|---|---|---|---|
| Р1 | **Реестр моделей — интерфейс, имя цели — строка.** `link('user')`, а не `link(() => User)` | единственный способ выразить взаимную рекурсию `User ↔ Post` без ручного дублирования схемы интерфейсами. Проверено компилятором (§3.13) | пять строк `declare module` на файл модели; имена моделей глобальны (§7.2) |
| Р2 | **Кэш живёт в описании поля, а не в сущности.** Два `computed.keyed` на (модель × поле × ленд), ключ — `head` документа | непрочитанное поле не стоит ничего на сущность; поле, прочитанное у 10 000 документов, — это записи в двух Map, а не 10 000 файберов | `Map.get` по строке на каждом тёплом чтении (≈20–30 нс при бюджете 500) |
| Р3 | **Поле — два канала: `slot` и `value`.** `slot` отвечает «где лежит», `value` — «что там» | появление **соседнего** поля меняет состав детей документа; `slot` пересчитывается, возвращает **ту же строку**, и распространение гасится сравнением результата в `Fiber.put` — значение не декодируется вовсе | вдвое больше файберов на прочитанное поле (§7.4) |
| Р4 | **Операции — методы канала, но функции общие.** `post.tags.push('x')`, где `push` — одна функция на (модель, поле), диспетчеризуемая по `this` | открываемость (`post.tags.` показывает список) без замыкания на метод на каждое поле каждой сущности | отвязанный метод (`const {push} = post.tags`) ломается; tree-shaking по операциям потерян (§7.3) |
| Р5 | **`Cast<T>` и `Type<T>` разделены.** `blank` есть только у `Type`, и только `Type` годится для `atom` | `atom(t.enum([...]))` **не компилируется**: молчаливая подстановка `Options[0]` из `$mol_schema_enum` становится невыразимой, а не запрещённой на словах | лишний `.or('draft')` в объявлении там, где дефолт нужен |
| Р6 | **Один сентинел.** `null` — «нет значения/не подошло»; `undefined` — «аргумента не было, это чтение» и никогда не значение | правило горячего пути №3 из PRINCIPLES; и оно же — «невозможные состояния непредставимы» | хранимого `null` не существует: «не заполняли» и «стёрли» неразличимы (§7.7) |

### 0.1 Откуда взято и где мнения разошлись

Основа — вариант «схема — источник истины» (реестр моделей, `Cast`/`Type`). К нему привиты: ячейки на модель и расщепление `slot`/`value` из варианта «perf»; `Space`, `Issue`, `Point`, `born`, `$`-пространство, таблица глубин индекса и методы на канале — из варианта «vue».

Один судья из трёх поставил первым «vue» — за то, что там инварианты реконсиляции и текста существуют в виде кода, а не обещания. Возражение принято по существу: §3.8 и §3.10 здесь написаны кодом, а не абзацем, и порт `link.test`/`land.test` (относительные ссылки) включён в корпус, хотя в базовом дизайне его не было.

---

## 1. Публичное API

### 1.1 Значения: `Cast` и `Type`

```ts
import type {Vary} from '@sync/core'

/** Ключ словаря и ключ мультиплексированного канала — один и тот же примитив. */
export type Key = string | number

/** Линза «сырое значение ↔ прикладное». Чтение НИКОГДА не бросает. */
export interface Cast<T> {
  readonly name: string
  /** `null` — «это не наш тип»: пишется `Issue`, чтение продолжается. */
  decode(raw: Vary): T | null
  /** Бросает только на том, что не выражается типом (`t.pattern`). */
  encode(value: T): Vary
  /** Назначить «пустое» значение и тем превратить `Cast` в `Type`. */
  or(blank: T): Type<T>
}

/** `Cast` с определённым «пустым» значением. Только такой годится для `atom`. */
export interface Type<T> extends Cast<T> {
  readonly blank: T
}

export declare const t: {
  readonly string: Type<string>        // blank ''
  readonly number: Type<number>        // blank 0 — не NaN, как у baza
  readonly int: Type<number>           // blank 0, дробное отвергается
  readonly bool: Type<boolean>         // blank false
  readonly bigint: Type<bigint>        // blank 0n
  readonly bytes: Type<Uint8Array>     // blank пустой
  readonly date: Cast<Date>            // естественного blank нет
  readonly link: Cast<Link>
  /** Неизвестный член → `null` + `Issue`. Никакой подстановки первого варианта. */
  enum<const M extends readonly Key[]>(members: M): Cast<M[number]>
  maybe<T>(inner: Cast<T>): Type<T | null>      // blank null
  pattern(re: RegExp, name?: string): Cast<string>
  range(min: number, max: number): Cast<number>
  /** Массив ЦЕЛИКОМ в одном юните. Не путать с `list()`: внутри нет слияния. */
  array<T>(item: Cast<T>): Type<readonly T[]>
  record<T>(value: Cast<T>): Type<Readonly<Record<string, T>>>
}
```

Разделение `Cast`/`Type` — ограничение 7, доведённое до отказа компиляции:

```ts
atom(t.enum(['draft', 'live']))            // ← ошибка компиляции
atom(t.enum(['draft', 'live']).or('draft')) // хочу дефолт — назови его
atom(t.maybe(t.enum(['draft', 'live'])))    // хочу различать отсутствие — вот null
list(t.enum(['draft', 'live']))             // элементу blank не нужен: компилируется
```

### 1.2 Реестр моделей

```ts
/** Расширяется приложением через declaration merging. В ядре пуст. */
export interface Models {}
export type ModelName = keyof Models & string

export type Schema = {readonly [key: string]: Field}
/** Карта производных полей: имя → тип результата. */
export type Derives = {readonly [key: string]: unknown}

export interface Model<N extends string, S extends Schema, D extends Derives = {}> {
  readonly name: N
  readonly schema: S
  /**
   * Фантом-носитель типов производных полей. В рантайме тут карта функций; в типе
   * от них нужен только результат — параметр `doc` в сигнатуре сделал бы `Model`
   * инвариантной по схеме, и `Model<'post', S, D>` перестал бы быть `AnyModel`.
   */
  readonly derives?: D
}
export type AnyModel<N extends string = string> = Model<N, Schema, Derives>

/** Документ, как его видит производное поле: только каналы схемы. */
export type View<S extends Schema> = {readonly [K in keyof S]: Chan<S[K]>}

declare const RESERVED: unique symbol
export interface ReservedFieldName<Why extends string> {readonly [RESERVED]: Why}
type NoReserved<S> = {
  readonly [K in keyof S]: K extends '$'
    ? ReservedFieldName<'$ занят под операции документа'>
    : S[K]
}

/**
 * Объявить модель. Возвращает ДАННЫЕ — `{name, schema}`, а не класс.
 *
 * @example
 * ```ts
 * export const Post = model('post', {
 *   title: atom(t.string),
 *   body: text(),
 * }, {
 *   excerpt: post => post.body().slice(0, 140),
 * })
 * ```
 */
export declare function model<const N extends string, S extends Schema, D extends Derives = {}>(
  name: N,
  schema: S & NoReserved<S>,
  derives?: {readonly [K in keyof D]: (doc: View<S>) => D[K]},
): Model<N, S, D>

/** Композиция схем: обычное слияние объектов, проверяемое типами. */
export declare function extend<
  const N extends string, A extends Schema, B extends Schema, D extends Derives = {},
>(
  name: N,
  base: Model<string, A, Derives>,
  more: B & NoReserved<B>,
  derives?: {readonly [K in keyof D]: (doc: View<A & B>) => D[K]},
): Model<N, A & B, D>
```

Регистрация — рядом с объявлением:

```ts
declare module '@sync/core' {
  interface Models {
    post: typeof Post
  }
}
```

`keyof` интерфейса не требует резолва типов его свойств, поэтому `link('user')` получает автодополнение, а `Doc<'post'>['author']` разворачивается лениво и рекурсия не замыкается. Аугментация действует на всю программу, поэтому side-effect импорты моделей не нужны, а самоссылка (`links('tag')` внутри схемы `Tag`) работает в том же файле.

### 1.3 Поля

```ts
export type FieldKind =
  | 'atom' | 'list' | 'dict' | 'text'
  | 'link' | 'links' | 'part' | 'parts' | 'index'

/** Базовый супертип БЕЗ параметров — иначе `Schema` ловит ошибку вариантности. */
export interface Field {readonly kind: FieldKind}

export interface AtomField<T> extends Field {readonly kind: 'atom'; readonly type: Type<T>}
export interface ListField<T> extends Field {readonly kind: 'list'; readonly item: Cast<T>}
export interface DictField<K extends Key, T> extends Field {
  readonly kind: 'dict'
  readonly key: Cast<K>
  readonly value: Type<T>
}
export interface TextField extends Field {readonly kind: 'text'}

export interface LinkField<N extends ModelName> extends Field {
  readonly kind: 'link'
  readonly to: N
  readonly born: Born
}
export interface LinksField<N extends ModelName> extends Field {
  readonly kind: 'links'
  readonly to: N
  readonly born: Born
}
export interface PartField<N extends ModelName> extends Field {readonly kind: 'part'; readonly of: N}
export interface PartsField<K extends Key, N extends ModelName> extends Field {
  readonly kind: 'parts'
  readonly key: Cast<K>
  readonly of: N
}

export type Depth = 1 | 2 | 3 | 4
export interface IndexField<D extends Depth, N extends ModelName> extends Field {
  readonly kind: 'index'
  readonly depth: D
  readonly of: N
  readonly born: Born
}

export declare function atom<T>(type: Type<T>): AtomField<T>
export declare function list<T>(item: Cast<T>): ListField<T>
export declare function dict<K extends Key, T>(key: Cast<K>, value: Type<T>): DictField<K, T>
export declare function text(): TextField
/** Ссылка на отдельную сущность. Читается `Doc | null` — забыть про null нельзя. */
export declare function link<N extends ModelName>(to: N, born?: Born): LinkField<N>
export declare function links<N extends ModelName>(to: N, born?: Born): LinksField<N>
/** Вложенная часть: живёт в поддереве родителя, есть всегда, `null` не бывает. */
export declare function part<N extends ModelName>(of: N): PartField<N>
export declare function parts<K extends Key, N extends ModelName>(key: Cast<K>, of: N): PartsField<K, N>
/** Вложенный индекс (бывший empire): словарь словарей глубины 1…4. */
export declare function index<D extends Depth, N extends ModelName>(depth: D, of: N, born?: Born): IndexField<D, N>
```

Различие `link` / `part` — семантика, выраженная типом:

| | где живёт | чтение | создание |
|---|---|---|---|
| `link('user')` | отдельная сущность, возможно другой ленд | `Doc<'user'> \| null` | `post.author.ensure()` явно |
| `part('stats')` | поддерево этого же документа | `Doc<'stats'>` | при первой записи |

Имена. `link`, а не `ref`: `ref` занято ядром (`@sync/fiber`) в значении «записываемый источник», и второе значение на то же имя — ровно тот случай, который правило 3 называет непредставимым состоянием. `part`/`parts`, а не `doc`/`docs`: `doc` уже значит и тип (`Doc<'post'>`), и метод открытия (`space.doc`), три смысла на один корень — плохо. `group` (третий кандидат) отвергнут как невнятный: группа чего?

### 1.4 Каналы

```ts
/** Внутренняя ручка на `(ленд, голова, поле, вид)`. Символ, чтобы не резервировать имя. */
declare const SPOT: unique symbol
export interface Spot {
  readonly land: LandId
  readonly head: Head
  readonly field: string
}
export interface Handle {readonly [SPOT]: Spot}

export interface AtomChannel<T> extends Handle {
  (): T
  (next: T): T
  /** Явная запись — как в ядре. */
  set(next: T): T
  /** Стереть: постится надгробие. Не то же, что запись пустой строки. */
  clear(): void
  /** Значение до разбора — для диагностики и миграций. */
  raw(): Vary | null
  /** Версия конкретного пира: «кто что писал», бесплатно из индекса LWW. */
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

export interface Caret {readonly token: Head; readonly at: number}
/** Размеченное объединение вместо кортежа-сентинела `['', off, 0]` у baza. */
export type Point =
  | {readonly found: true; readonly caret: Caret}
  | {readonly found: false; readonly rest: number}

export interface TextChannel extends Handle {
  (): string
  (next: string): string
  set(next: string): string
  length(): number
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
export interface PartChannel<N extends ModelName> extends Handle {(): Doc<N>}

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
export interface DerivedChannel<T> extends Handle {(): T}
```

`undefined` не является значением ни одного типа схемы (`Vary` его не содержит), поэтому перегрузка «нет аргумента — чтение» тотальна. `set` есть у всех записываемых каналов — это ограничение 3, и оно выполнено буквально: `x()`, `x(next)`, `x.set(next)`; у ключевых каналов — `x(key)`, `x(key, next)`, `x.set(key, next)`, зеркало `KeyedComputedRef` из ядра.

### 1.5 Документ

```ts
/** Отображение поля в канал — единственный нетривиальный тип слоя. */
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
type DerivesOf<M> = M extends Model<string, Schema, infer D> ? D : {}

export type Doc<N extends ModelName> =
  {readonly [K in keyof SchemaOf<Models[N]>]: Chan<SchemaOf<Models[N]>[K]>} &
  {readonly [K in keyof DerivesOf<Models[N]>]: DerivedChannel<DerivesOf<Models[N]>[K]>} &
  {readonly $: DocOps<N>}

/** Операции уровня документа. `$` — единственное зарезервированное имя поля. */
export interface DocOps<N extends ModelName> extends Handle {
  readonly model: N
  /** Абсолютная ссылка: ключ в сети, в devtools и в `link`-полях. */
  link(): Link
  /** Есть ли хоть один юнит. Отличает «пусто» от «не создавали». */
  exists(): boolean
  /** Ссылка на схему (meta-слот, `self = hole`). */
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
```

### 1.6 Пространство

```ts
export interface Issue {
  readonly kind: 'decode' | 'denied' | 'shape' | 'broken-link'
  readonly land: LandId
  readonly head: Head
  readonly self: string
  readonly peer: Peer | null
  readonly field: string
  readonly expected: string
  readonly got: string
}

export interface Space {
  readonly land: LandId
  /** Корневой документ ленда. */
  root<N extends ModelName>(model: AnyModel<N> | N): Doc<N>
  /** Документ по адресу. Мемоизирован: два вызова дают ОДИН объект (`===`). */
  doc<N extends ModelName>(model: AnyModel<N> | N, at: Link | Head): Doc<N>
  /** Соседний ленд того же узла. */
  of(land: LandId): Space
  /** Транзакция: одна метка времени на все записи и один flush наружу. */
  edit<R>(fn: () => R): R
  /** Подписка на диагностику. Возвращает отписку. */
  onIssue(handle: (issue: Issue) => void): () => void
}

export declare function createSpace(options: {
  readonly land: Land
  /** По умолчанию — `console.warn` с полным контекстом. */
  readonly report?: (issue: Issue) => void
}): Space
```

Ambient-контекста нет (ADR-010): `space` передаётся явно. `Space` — единственная точка, где живут ленд, приёмник диагностики и транзакция; глобальный `onWarn` не годится, потому что лендов в процессе много.

### 1.7 `cast`

```ts
/**
 * Другой ВИД на те же юниты. Ноль миграции данных: две выборки из Map.
 *
 * @example
 * ```ts
 * cast(post.body, list(t.string))()   // токены текста как список
 * cast(post.tags, atom(t.string))()   // первый элемент списка как атом
 * cast(post.stats, Comment)           // тот же head, другая модель
 * ```
 */
export declare function cast<F extends Field>(from: Handle, as: F): Chan<F>
export declare function cast<N extends ModelName>(from: Handle, as: AnyModel<N> | N): Doc<N>
```

### 1.8 Мост в Vue

```ts
// @sync/vue
export function provideSpace(space: Space): void
export function useSpace(): Space

/** Адрес документа. Не реактивные данные — реактивны только чтения через `useValue`. */
export function useDoc<N extends ModelName>(
  model: AnyModel<N> | N, at: Link | Head, space?: Space,
): Doc<N>

/** Производное чтение из графа файберов — один файбер на выражение. */
export function useValue<T>(read: () => T): Readonly<ShallowRef<T | undefined>>
/** Ожидание и ошибка отдельно — это существующий `createSync`. */
export function useSync<T>(read: () => T): SyncState<T>
/** Канал как `WritableComputedRef` — для `v-model` и `defineModel`. */
export function useModel<T>(channel: {(): T; (next: T): T}): WritableComputedRef<T>
```

**Здесь я сознательно разошёлся с вариантом «vue».** Там `useDoc` возвращал документ, чьи каналы «прокинуты в реактивность Vue», а `space.doc()` — такой же по типу документ без реактивности. Один тип, разное поведение: прокинул документ пропом в дочерний компонент — и чтение молча перестало обновлять UI. Это класс ошибок, который компилируется и не ловится тестами, и сам дизайн предлагал лечить его dev-предупреждением. У нас **вид документа один**: `useDoc` — это `space.doc` плюс `inject` пространства, а реактивным чтение делает `useValue`/`useSync` вокруг него. Цена — многословность (`useValue(() => post.title())` вместо `post.title()` прямо в разметке), и она признана в §7.13. Dev-предупреждение остаётся, но уже как страховка, а не как единственная защита: чтение канала модели внутри активного эффекта Vue **без** активного файбера один раз на канал печатает warning.

---

## 2. Сквозной пример: блог

### 2.1 Объявление

```ts
// models/user.ts
import {atom, dict, links, model, t} from '@sync/core'

export const User = model('user', {
  name: atom(t.string),
  email: atom(t.pattern(/.+@.+/, 'email').or('')),
  avatar: atom(t.maybe(t.bytes)),
  /** Био по языкам — словарь скаляров, а не отдельная модель. */
  bio: dict(t.string, t.string),
  posts: links('post'),
})

declare module '@sync/core' {
  interface Models {user: typeof User}
}
```

```ts
// models/post.ts
import {atom, index, link, links, list, model, part, parts, t, text} from '@sync/core'

export const Stats = model('stats', {
  views: atom(t.int),
  likes: atom(t.int),
})

export const Comment = model('comment', {
  body: text(),
  author: link('user'),
})

export const Post = model('post', {
  title: atom(t.string),
  status: atom(t.enum(['draft', 'live', 'archived']).or('draft')),
  body: text(),
  tags: list(t.string),
  /** Автор живёт своей жизнью: собственный ленд, собственные права. */
  author: link('user', {land: readers}),
  /** Счётчики живут внутри поста и умирают вместе с ним. */
  stats: part('stats'),
  comments: parts(t.string, 'comment'),
  reactions: dict(t.string, t.int),
}, {
  excerpt: post => post.body().slice(0, 140),
  hot: post => post.stats().likes() > 100,
})

export const Blog = model('blog', {
  posts: links('post'),
  /** Трёхуровневый индекс год → месяц → тег. Бывший empire. */
  archive: index(3, 'post', 'area'),
})

declare module '@sync/core' {
  interface Models {
    post: typeof Post
    stats: typeof Stats
    comment: typeof Comment
    blog: typeof Blog
  }
}
```

Взаимная рекурсия `User.posts: links('post')` ↔ `Post.author: link('user')` работает **без единой аннотации типа и без второго описания схемы**. Это проверено компилятором целиком, включая `post.author()!.posts()[0]!.author()!.name(): string`.

### 2.2 Чтение и запись

```ts
const space = createSpace({land})
const blog = space.root(Blog)
const post = space.doc(Post, postId)

post.title()                 // string — не `string | null`, не `AtomText | null`
post.status()                // 'draft' | 'live' | 'archived'
post.tags()                  // readonly string[]
post.body()                  // string
post.stats().views()         // number — вложенная часть есть всегда
post.author()                // Doc<'user'> | null — про null не забыть нельзя
post.reactions('👍')         // number, 0 пока не писали
post.excerpt()               // string — производное, кэшируется как обычное поле

post.title('Файберы и CRDT')
post.title.set('явно то же самое')
post.status('live')
post.reactions('👍', post.reactions('👍') + 1)

// Стереть — отдельная операция: `null` в ленде это надгробие, а не значение,
// поэтому «записать пустоту» через `x(next)` невозможно в принципе.
post.status.clear()

// Транзакция: одна метка времени на все три записи, один flush наружу.
space.edit(() => {
  post.title('Черновик')
  post.status('draft')
  post.tags.push('wip')
})

// Ошибки компиляции:
post.title(42)               // число вместо строки
post.status('published')     // нет такого члена
post.title.push('x')         // у атома нет списковых операций
post.author().name()         // ссылка nullable, точку ставить нельзя
```

### 2.3 Списки и реконсиляция

```ts
post.tags(['vue', 'crdt', 'draft'])

// Прочитали, поменяли один элемент, записали обратно.
post.tags(post.tags().map(tag => tag === 'draft' ? 'ready' : tag))
// → ОДИН юнит: замена по тому же `self`. Не три и не шесть.

post.tags(post.tags())       // → 0 юнитов: идемпотентная запись
post.tags.push('ssr')        // в конец
post.tags.unshift('pinned')  // в начало
post.tags.remove('crdt')
post.tags.move(0, 2)
post.tags.at(0)              // string | null
post.tags.size()             // number
```

Порядок — часть контракта, а не побочный эффект якоря: `push` кладёт в конец, `unshift` — в начало, и то же правило действует на ключи словаря. В baza `add` постил с `lead = hole` (то есть в начало), а `splice` в том же классе дописывал в конец — две противоположные семантики без единого слова в документации, и обратный порядок ключей словаря нигде не был заявлен.

### 2.4 Текст

```ts
post.body('Первый абзац.\nВторой абзац.')

// Вставка одной буквы: перетокенизируется ОДИН абзац, а не документ.
post.body.write('!', 14, 14)
post.body.write('', 0, 6)              // удаление диапазона

post.body.tokens()                     // ['Первый', ' абзац.', …]
post.body.paragraphs()                 // ['Первый абзац.\n', 'Второй абзац.']

// Каретка привязана к токену, а не к смещению, поэтому переживает чужие правки.
const point = post.body.pointAt(caretOffset)
if (point.found) {
  remember(point.caret)
  post.body.offsetAt(point.caret)      // number | null
} else {
  scrollPastEnd(point.rest)            // остаток смещения, а не «промах»
}
```

### 2.5 Ссылки, части и создание

```ts
post.author()?.name()                            // string | undefined

// Создание — явная операция, а не третий аргумент чтения.
const author = post.author() ?? post.author.ensure()
author.name('Аня')
author.email('anya@example.org')

// Идентичность мемоизирована: сравнение в прикладном коде работает.
post.author() === space.doc(User, author.$.link())   // true

// Множественная ссылка
post.likes ?? null
author.posts.add(post)
author.posts.size()

// Вложенные части: `null` не бывает, `?.` не нужен
post.stats().views(post.stats().views() + 1)
post.comments('c1').body('Первый!')
post.comments.keys()                             // readonly string[]

// Индекс: ветки рождаются по пути, каждая в своей area
blog.archive.ensure(['2026', '08', 'vue'])
blog.archive(['2026', '08', 'vue'])?.title()     // чтение НИЧЕГО не создаёт
blog.archive.keys(['2026'])                       // ['08', '07', …]
blog.archive(['2026'])                            // ← ошибка компиляции: путь короче глубины
```

### 2.6 `cast`

```ts
// Текст — это список токенов на тех же юнитах
cast(post.body, list(t.string))()

// Список — это атом на первом живом ребёнке
cast(post.tags, atom(t.maybe(t.string)))()

// Документ — это словарь ключ → значение
cast(post, dict(t.string, t.maybe(t.string))).keys()

// Тот же head, прочитанный как другая модель
cast(post.stats, Comment).body()
```

Перевод вида не мигрирует данные и не пишет ни одного юнита.

### 2.7 В компоненте (`vue-jsx-vapor`, Vapor mode)

```tsx
import {useDoc, useModel, useSync, useValue} from '@sync/vue'
import {Post} from '../models/post'

export function PostCard(props: {id: string}) {
  const post = useDoc(Post, props.id)

  const title = useModel(post.title)                       // WritableComputedRef<string>
  const author = useValue(() => post.author()?.name() ?? 'аноним')
  const tags = useValue(() => post.tags())
  const {data: body, pending} = useSync(() => post.body())

  return (
    <article>
      <input v-model={title.value} />
      <p>{`автор: ${author.value}`}</p>
      {pending.value ? <Skeleton /> : <pre>{body.value}</pre>}
      <ul>
        {tags.value?.map(tag => (
          <li key={tag} onClick={() => post.tags.remove(tag)}>{tag}</li>
        ))}
      </ul>
      <button onClick={() => post.tags.push('vue')}>{'+ тег'}</button>
    </article>
  )
}
```

Мост односторонний: Vue читает нас, писать в модель следует обычным вызовом канала прямо в обработчике.

---

## 3. Как устроено внутри

### 3.1 Карта слоёв

```
Land (S3)          order(head) · post({head,lead,self,value,tag}) · права · Suspense гидрации
   │                ReactiveMap head → peer → self, гранулярность по ключу
Space              order(head) · orderOf(peer)(head) · keyIndex(head)      ← computed.keyed, ключи-примитивы
   │
Binding            (модель × ленд) → плотный массив ячеек                  ← 2 канала на ПОЛЕ, не на сущность
   │
Cell               slot(docHead) → self ключевого юнита
   │               value(docHead) → готовое значение                       ← здесь кэш поля
   │               methods: одна таблица функций на (модель, поле)
Doc                хендл: объект стабильной формы + стрелки-каналы
```

### 3.2 Space: три канала и ни одного объектного ключа

```ts
export function createSpace(options: SpaceOptions): Space {
  const {land} = options
  const report = options.report ?? warnIssue

  // Дети головы в порядке чтения. Ключ — СТРОКА.
  // У baza `sand_ordered` мемоизирован по литералу `{head, peer}`: на каждый вызов
  // аллокация объекта плюс сериализация в строковый ключ — на самом горячем пути,
  // под которым лежит вообще всё чтение модели.
  const order = computed.keyed((head: string) => land.order(head))

  // Версия конкретного пира — ВТОРЫМ уровнем, чтобы оба ключа остались примитивами
  // и нигде не склеивалась строка: `orderOf(peer)(head)`, а не `order(head + '|' + peer)`.
  const orderOf = computed.keyed(
    (peer: string) => computed.keyed((head: string) => land.orderOf(head, peer)),
  )

  // Ключ поля → self ключевого юнита. Инвалидируется ТОЛЬКО составом детей головы:
  // запись значения поля сюда не попадает, она живёт в поддереве ключевого юнита.
  const keyIndex = computed.keyed((head: string): ReadonlyMap<string, string> => {
    const kids = order(head)
    const out = new Map<string, string>()
    for (let i = 0; i < kids.length; i++) {
      const kid = kids[i] as Sand
      // `self = hole` зарезервирован под meta: иначе ссылка на схему протекла бы
      // в keys() каждой типизированной модели лишним фантомным элементом.
      if (kid.self === ROOT) continue
      const key = keyOf(kid.value)
      if (key === null) continue
      // order() уже разложил сиблингов детерминированно по LWW — первый и есть победитель.
      if (!out.has(key)) out.set(key, kid.self)
    }
    return out
  })
  /* … */
}
```

`keyIndex` возвращает новую `Map` на каждый пересчёт, но `Fiber.put` сравнивает результат структурно, а `equals` умеет `Map` (`equals.ts:59`), поэтому пересчёт, давший тот же состав ключей, подписчиков не будит.

### 3.3 Binding: где живёт кэш поля

```ts
// v8:hot
interface Cell {
  readonly key: string
  readonly field: Field
  /** docHead → self ключевого юнита; '' — поля ещё нет. */
  readonly slot: KeyedComputedRef<string, string>
  /** docHead → готовое значение поля. */
  readonly value: KeyedComputedRef<string, unknown>
  /** Таблица методов канала: ОДНА на (модель, поле). Копируется в канал одним Object.assign. */
  readonly methods: Readonly<Record<string, unknown>>
  /** head → канал: identity для `cast` и повторного открытия. */
  readonly channels: Map<string, Handle>
}

interface Binding {
  readonly space: Space
  readonly model: AnyModel
  /** Плотный массив, порядок = порядок ключей схемы. Форма хендла отсюда. */
  readonly cells: readonly Cell[]
  readonly docs: Map<string, WeakRef<object>>
}

const bindings = new WeakMap<Space, Map<AnyModel, Binding>>()

function makeCell(space: Space, key: string, field: Field): Cell {
  const kind = kindOf(field)        // одна из девяти мономорфных пар read/write,
  const read = READERS[kind]        // выбранных ОДНОКРАТНО при создании ячейки,
  const write = WRITERS[kind]       // а не диспетчеризуемых на каждом чтении

  // Строка. Пересчитывается при появлении/уходе любого ключа документа,
  // но возвращает ТО ЖЕ значение — и распространение гасится в `Fiber.put`.
  const slot = computed.keyed((head: string) => space.keyIndex(head).get(key) ?? '')

  const value = computed.keyed({
    get: (head: string) => read(space, slot(head), field, key),
    set: (head: string, next: unknown) => {
      write(space, mountSlot(space, head, key, field), next, field, key)
    },
  })

  return {key, field, slot, value, methods: methodsFor(kind), channels: new Map()}
}
```

**Почему два канала, а не один.** Если слить `slot` и `value`, то первая запись в **соседнее** поле (новый ребёнок у `docHead` → новый `order(docHead)`) заставит пересчитать значение: скан плюс декод. С разделением пересчитывается только `slot`, он отдаёт ту же строку, и `value` не трогается вовсе. Это то, чего нет ни у одного из трёх исходных дизайнов в чистом виде: у одного зависимость шла через объект-индекс целиком, у другого — через `spot.self()`, который читает тот же индекс.

**Почему ячейка на модель, а не на сущность.** `Post` с восемью полями на одном ленде — 16 `computed.keyed`, ≈16 × 14.7 нс ≈ 235 нс единожды за жизнь процесса. Всё, что растёт с числом сущностей, — записи в `Map` внутри keyed-каналов, и только для **реально прочитанных** полей. Непрочитанное поле не стоит ничего.

Плата — `Map.get` по строке на тёплом чтении. Тёплый путь: стрелка → `cell.value(head)` → `nodes.get(head)` → `node.read()` (проверка битфилда, возврат кэша). Ожидаемое ≈20–30 нс при бюджете 500.

### 3.4 Хендл документа

```ts
function makeDoc(bind: Binding, head: string): object {
  const spot: Spot = {land: bind.space.land, head, field: ''}
  // Порядок ключей фиксирован при `model()`, значит все документы одной модели
  // сходятся к ОДНОЙ карте скрытых классов, и `post.title` мономорфен.
  const out = {} as Record<string, unknown>
  const cells = bind.cells
  for (let i = 0; i < cells.length; i++) {
    out[(cells[i] as Cell).key] = channelFor(cells[i] as Cell, head)
  }
  out.$ = docOps(bind, head, spot)
  return out
}

/** Одна функция-фабрика: контекст замыкания держит ровно {cell, head}, два слота. */
function channelFor(cell: Cell, head: string): Handle {
  const found = cell.channels.get(head)
  if (found !== undefined) return found

  const channel = ((a?: unknown, b?: unknown): unknown => {
    if (cell.keyed) return b === undefined ? cell.value(head, a) : cell.value(head, [a, b])
    return a === undefined ? cell.value(head) : cell.value(head, a)
  }) as Handle & Record<string, unknown>

  // Присваивание, а не `Object.defineProperty`: 4 нс против 120 (реестр, п. 17).
  channel[SPOT] = {land: cell.land, head, field: cell.key}
  // Одна операция копирует всю таблицу методов. Значения — общие функции,
  // созданные один раз на (модель, поле): ни одного нового замыкания на канал.
  Object.assign(channel, cell.methods)

  cell.channels.set(head, channel)
  return channel
}
```

`Object.freeze` — только в dev-сборке: заморозка добавляет переход шейпа на каждый документ, а инвариант «никто не пишет в документ» держится типом `readonly`.

### 3.5 Методы канала: общие функции, диспетчеризация по `this`

Это тот компромисс, из-за которого базовый дизайн критиковали сильнее всего: свободная функция `push(post.tags, 'x')` не находится автодополнением, и первым об это спотыкается новый человек. Но и обратный ход — методы-замыкания на каждом поле каждой сущности — дорог. Решение — общая функция, чей приёмник определяется вызовом:

```ts
// Создаётся ОДИН раз на (модель, поле) в `methodsFor(kind)`.
const LIST_METHODS = Object.freeze({
  push(this: ListChannel<unknown>, ...values: readonly unknown[]): void {
    const cell = cellOf(this)
    const prev = untracked(() => cell.value(this[SPOT].head) as readonly unknown[])
    // Один путь записи в ядро: минимальность диффа обеспечивает реконсиляция,
    // а не пять отдельных операций поверх юнитов.
    cell.value(this[SPOT].head, [...prev, ...values])
  },
  unshift(this: ListChannel<unknown>, ...values: readonly unknown[]): void { /* … */ },
  /* … */
})
```

Прикладной код пишет `post.tags.push('x')` и не видит ни `this`, ни классов — ограничение 1 соблюдено: `this` живёт в реализации, где классы и разрешены. Цена — отвязанный метод: `const {push} = post.tags; push('x')` сломается. В dev-сборке первая строка каждого метода проверяет приёмник и бросает с говорящим текстом; в прод-сборке проверки нет.

### 3.6 Адреса: `self` ключевого юнита

```ts
/**
 * `self` ключевого юнита: H(соль ленда ‖ head ‖ ключ).
 *
 * РАСХОЖДЕНИЕ С baza дважды.
 *
 * 1. Там `self = H(значение, H(head ‖ lead))`, то есть зависит от точки вставки:
 *    два пира, добавившие ОДИН ключ в разные позиции, получали ДВА поддерева на
 *    один ключ. Наша формула от позиции не зависит, поэтому такие вставки
 *    схлопываются по LWW. Для ЭЛЕМЕНТОВ СПИСКА формула baza сохраняется: там
 *    зависимость от точки вставки — ровно то, что нужно (одинаковые значения в
 *    разных местах обязаны остаться разными элементами), и на ней держится
 *    схлопывание общего префикса в `text.test` «Merge same insertions».
 *
 * 2. На ЗАШИФРОВАННОМ ленде baza берёт `self` случайным (`encrypted ? undefined :
 *    hash`) — и бесплатная дедупликация конкурентных вставок там просто исчезает.
 *    У нас адрес всегда контентный, но подсолен секретом ленда: внутри ленда
 *    детерминизм сохранён, снаружи хэш ничего не выдаёт.
 */
function predictKey(salt: Uint8Array, head: string, key: Key): string
/** Элемент списка: формула baza, зависимая от точки вставки. */
function predictItem(salt: Uint8Array, head: string, lead: string, value: Vary): string
```

**Хеш синхронный и не криптографический** — порт `$mol_hash_numbers`, а не WebCrypto. Соблазн взять `crypto.subtle` понятен, но он асинхронен, а значит вычисление адреса стало бы точкой приостановки — и приостанавливаемой стала бы **запись**: `post.tags.push('x')` из обработчика клика мог бы бросить `Suspend`, а каждый merge-тест корпуса — стать асинхронным. От адреса требуется детерминизм и равномерность, а не стойкость: тот, кто может угадать `self`, уже имеет право писать в этот ленд.

```ts
/** Материализовать ключевой юнит. Идемпотентно: если всё есть — ничего не пишет. */
function mountSlot(space: Space, head: string, key: string, field: Field): string {
  const found = untracked(() => space.keyIndex(head).get(key))
  if (found !== undefined) return found

  const kids = untracked(() => space.order(head))
  // Ключ ложится в КОНЕЦ. У baza `dive` шёл через `add` с `lead = hole`, и порядок
  // ключей выходил обратным вставке — побочный эффект якоря, не заявленный в
  // контракте. Здесь порядок — часть контракта и предмет теста.
  const lead = kids.length === 0 ? ROOT : (kids[kids.length - 1] as Sand).self
  const self = predictKey(space.salt, head, key)
  space.post({head, lead, self, value: key, tag: tagOf(field)})
  return self
}
```

Реестр выданных идентификаторов пополняется **при гидрации из индекса**, а не только собственным генератором: иначе после перезапуска контентный адрес мог бы выдать занятый `self` и молча заменить по LWW чужой элемент — невоспроизводимый баг, который в холодной и тёплой сессии ведёт себя по-разному.

### 3.7 Запись атома

```ts
function writeAtom(space: Space, self: string, next: unknown, type: Type<unknown>): void {
  const prev = untracked(() => space.order(self))[0]
  const raw = next === null ? null : type.encode(next)

  // Идемпотентность. Без этой ветки любой ре-рендер, любое эхо от пира и любое
  // `x(x())` рождают юнит: растёт лог, тикают часы, диффы летят по кругу между
  // двумя узлами бесконечно.
  if (prev !== undefined && varyEqual(prev.value as Vary, raw)) return

  space.post({
    head: self,
    // Запись всегда якорится в начало: новая версия обязана стать первым живым
    // ребёнком, иначе атом перестанет видеть элементы, добавленные через list-вид,
    // и `cast` станет ложью.
    lead: ROOT,
    // `self` прежний: дети висят на нём, и смена значения не должна ронять поддерево.
    self: prev?.self ?? predictItem(space.salt, self, ROOT, raw),
    value: raw,
    tag: 'term',
  })
  // Реентерации нет: значение пересчитается само, когда до канала дойдёт
  // распространение. У baza сеттер заканчивался на `return this.vary_of(peer)` —
  // канал перевычислялся изнутри самого себя.
}
```

Что возвращает `x(next)`: результат последующего чтения, то есть **победителя LWW**, а не то, что записали. Вернуть `next` напрямую было бы дешевле, но неверно — победителем может оказаться чужой юнит, и возвращённое значение врало бы про состояние.

### 3.8 Реконсиляция списка

Порядок ветвей и протяжка якоря — не косметика: на них висят 14 сценариев конкурентного слияния из `list.test.ts`.

```ts
/**
 * Порядок ветвей ФИКСИРОВАН: совпало → вставка → удаление → замена.
 * Смена приоритета превращает «поменял один элемент» в N юнитов и убивает
 * вложенные поддеревья (кейс «Insert before removed before changed»).
 */
function reconcile(
  space: Space,
  head: string,
  prev: readonly Sand[],
  next: readonly Vary[],
  from: number,
  to: number,
): void {
  // Якорь — предыдущий живой юнит РЕЗУЛЬТАТА, а не индекс в старом массиве.
  let lead: string = prev[from - 1]?.self ?? ROOT
  let i = from
  let j = 0

  while (j < next.length || i < to) {
    const before = prev[i]
    const after = next[j]

    if (before !== undefined && after !== undefined && varyEqual(before.value as Vary, after)) {
      lead = before.self                       // совпало — не трогаем вовсе
      i++; j++; continue
    }
    if (after !== undefined && next.length - j > to - i) {
      const self = predictItem(space.salt, head, lead, after)
      space.post({head, lead, self, value: after, tag: 'term'})
      lead = self                              // вставка
      j++; continue
    }
    if (before !== undefined && to - i > next.length - j) {
      // Надгробие оставляем ЯКОРЕМ: `order()` спускается в детей мёртвых узлов,
      // поэтому позиция вставки переживает удаление (кейсы «Insert after wiped» /
      // «Wiped before inserted»). Сам `lead` надгробия сохраняется прежним —
      // переезд утащил бы за собой всё поддерево.
      space.post({head, lead: before.lead, self: before.self, value: null, tag: 'term'})
      lead = before.self
      i++; continue
    }
    // Замена — ТОТ ЖЕ `self`, новое значение. Именно поэтому смена значения ключа
    // словаря переносит на него всё вложенное поддерево.
    space.post({head, lead, self: (before as Sand).self, value: after as Vary, tag: 'term'})
    lead = (before as Sand).self
    i++; j++
  }
}
```

Правило 2 требует референсной реализации для алгоритмов, которые не проверяются глазами. Рядом живёт `reconcileNaive` — честно тупой O(n²) минимальный скрипт правок — и property-тест эквивалентности на 10 000 случайных пар массивов. Референс остаётся в `__tests__/reference.ts` навсегда.

`move(from, to)` **не переписывает соседа**. В baza `sand_move` ветвится по сравнению `sand.head() === head` — то есть по идентичности JS-объектов `Link`: у локально созданного юнита это тот самый объект, у пришедшего по проводу — свежесконструированный. Один и тот же логический `move` давал разный граф в зависимости от того, был ли элемент создан в этой сессии, и два теста baza зафиксировали результат с авторским комментарием `// extra change (3) => unexpected result`. У нас перестановка меняет только `lead` перемещаемого узла плюс перепривязку следующего (это необходимо, иначе цепочка замыкается в кольцо — см. `Replica.move` и регрессию `move-cycle-drops-items`), а ветвления по ссылке нет вовсе: сравниваются строки.

### 3.9 Словарь и части

Документ — это узел, чьи дети суть **ключевые юниты**: значение такого юнита есть имя поля (или ключ словаря), а его `self` служит головой для содержимого. Модель и есть словарь с известным набором ключей.

```
head документа
  ├── ключевой юнит value='title'  self=T ──┬── 'Файберы и CRDT'   ← атом = первый живой ребёнок
  │                                          └── 'Черновик'         ← прошлая версия
  ├── ключевой юнит value='tags'   self=G ──┬── 'vue'
  │                                          └── 'crdt'
  └── ребёнок с self='' ─────────────────────── meta: ссылка на схему
```

Отсюда всё остальное: `dict` — это `list`, где значение элемента читается как ключ; `parts` — тот же `dict`, где поддерево ключа открывается как документ; переименование ключа сохраняет поддерево, потому что `self` не меняется; `cast` между всеми четырьмя видами бесплатен, потому что вид не участвует в хранении.

`tag` (`term`/`solo`/`vals`/`keys`) остаётся **подсказкой**, а не дискриминатором: ни один читатель по нему не диспетчеризуется. Атом берёт первого живого ребёнка, список — всех детей, словарь — всех детей. Сделай тег дискриминатором — и `write` по тексту, который строит правку через `cast` в список, перестанет работать.

### 3.10 Текст

Два уровня — абзацы, внутри токены, — и по той же причине, что у baza: правка одного абзаца не создаёт ни одного юнита в остальных.

```ts
function writeAll(chan: TextChannel, next: string): void {
  // Режем по /.*\n|.+$/g и реконсилируем АБЗАЦЫ. Сравнение идёт по `str()`
  // существующего абзаца, поэтому совпавший абзац не трогается вовсе.
  reconcileParagraphs(untracked(() => paragraphs(chan)), splitParagraphs(next))
}

function write(chan: TextChannel, next: string, from: number, to: number): void {
  const words = chan.tokens()
  let at = indexOfOffset(words, from)
  let patch = next
  // Приклеиваем ЛЕВОГО соседа перед перетокенизацией: без этого 'foo' + '!' дало бы
  // ['foo', '!'] вместо ['foo!'], текст выродился бы в посимвольное хранение, и
  // обещание «на порядок меньше юнитов» рухнуло бы.
  if (at > 0 && at === words.length) {at--; patch = (words[at] as string) + patch}
  cast(chan, list(t.string)).splice(tokenize(patch), at, indexOfOffset(words, to))
}
```

Три инварианта токенизации, каждый из которых ломается незаметно:

- **Токен = «разделитель + слово»**: ведущий пробел принадлежит СЛЕДУЮЩЕМУ токену, поэтому `'foo bar'` → `['foo', ' bar']`, а не `['foo', ' ', 'bar']`. Пробел отдельным юнитом был бы лишней точкой конфликта: два пира, вставляющие соседние слова, правили бы общий разделитель.
- **`str()` рекурсивен**: `term` — декодировать, иначе спуститься. Без рекурсии ломается offset↔point через два уровня.
- **Граница каретки включительна**: позиция ровно на конце токена принадлежит ЭТОМУ токену (`off <= len`). Сдвиг на единицу не ловится ни одним merge-тестом и проявляется как прыжок курсора через слово при слиянии.

`pointAt` / `offsetAt` — обычные чтения над `tokens()`, а не действия. У baza они помечены `@$mol_action`, из-за чего подписка на текст не возникала, и авторы дописывали `this.vary() // track text to recalc selection`. Строки «ручная подписка, чтобы отследить зависимость» в этом дизайне быть не может: если она понадобилась, значит граф не видит настоящую зависимость.

### 3.11 `cast`

```ts
export function cast(from: Handle, as: Field | AnyModel | ModelName): unknown {
  const spot = from[SPOT]
  if (typeof as === 'string' || 'schema' in as) return openDoc(spot.land, as, headOf(from))
  // Ad-hoc спека получает свою ячейку в реестре ленда — мемо по объекту спеки.
  // Спека создаётся один раз (в объявлении модели или в модульной константе),
  // поэтому это Map-lookup, а не аллокация.
  return channelFor(cellForSpec(spot.land, as), headOf(from))
}
```

Ни одного обращения к данным: `cast` — новая ручка на ту же координату. Два `Map.get` на тёплом пути, ноль юнитов. Канал кэшируется в `cell.channels`, поэтому `cast(x, v) === cast(x, v)`, и подписки не размножаются. `WeakMap` для этого не берётся сознательно: `WeakMap.set` стоит 623 нс против 4 нс у присваивания (реестр, п. 17), а карта каналов подметается тем же приёмом «раз в сотню промахов», что и `computed.keyed`.

### 3.12 Идентичность и GC

`space.doc(Post, head)` дважды даёт **один и тот же объект**: на этом держатся сравнения в прикладном коде (`post.author() === user`) и отсутствие размножения подписок. Реестр — `Map<string, WeakRef<Doc>>` внутри `Binding` (то есть двухуровневый: модель → head, без конкатенации ключа), плюс `FinalizationRegistry` на удаление записи.

### 3.13 Как устроен вывод типов

Три приёма, и все — на отложенном резолве:

1. **Реестр — интерфейс.** `keyof Models` не требует резолва типов свойств, поэтому `link('user')` автодополняется, не втягивая `typeof User`.
2. **Поле хранит имя, а не тип цели.** `typeof Post` = `Model<'post', {author: LinkField<'user'>, …}>` — здесь нет ни следа `typeof User`. Цикл возникает только при *использовании* (`Doc<'post'>['author']` → `Doc<'user'>`), а рекурсивные типы через индекс интерфейса TypeScript разворачивает лениво.
3. **Базовый `Field` не параметризован**, а `Model.derives` — необязательный фантом. Иначе `AtomField<string>` не был бы присваиваем `Field` из-за контравариантного `encode`, а `Model<'post', S, D>` не был бы `AnyModel` из-за параметра `doc` в сигнатуре производного поля.

Отвергнутые альтернативы — с кодами ошибок, а не по вкусу. Каждая проверена компилятором (TS 6.0, боевой `tsconfig.base.json`):

| вариант | почему отвергнут |
|---|---|
| `link(() => User)` — тонк | `typeof Post` требует тип стрелки → `typeof User` → `typeof Post`. **TS7022** на константах схемы, **TS7024** на тонках, дальше каскад **TS18046** «`post.title` is of type `unknown`». Явный тип-параметр (`link<User>(() => User)`) не спасает: TS всё равно выводит тип стрелки |
| `interface UserFields {…}` рядом со схемой | `interface` не имеет неявной индексной сигнатуры и не удовлетворяет `Schema` — **TS2344**. После замены на `type` остаётся **TS7022**; рабочим вариант становится только с аннотацией возврата на каждом тонке, то есть ценой полного дубля схемы плюс трёх аннотаций на модель |
| один литерал `models({user: …, post: …})` | ломает файл-на-модель; проверка имён требует рекурсивного ограничения, которое ведёт себя нестабильно при выводе |
| производное поле внутри схемы (`derived(post => …)` в том же литерале) | круговая ссылка на собственный инициализатор — **TS7022**, и одно такое поле обращает в `any` **всю** схему. Поэтому производные поля вынесены в третий аргумент `model()`: `S` выводится из второго аргумента, а колбэки третьего контекстно типизируются уже готовым `View<S>` |

`any` не появляется нигде: `Chan<F>` ветвится по литеральному `kind` с дефолтом `never`, `t.*` возвращает `T | null`, `Vary` — закрытое объединение. Внутри реализации `any` есть ровно в двух местах — сборка хендла по динамическим ключам и стирание `Field` в `cellForSpec`, — оба под комментарием `// unsafe:`.

### 3.14 Правила горячего пути в этом слое

Файлы `model/cell.ts`, `model/doc.ts`, `model/kinds/*.ts` помечаются `// v8:hot` и попадают в таблицу PRINCIPLES.

1. **Один шейп на документ модели.** Ключи в фиксированном порядке из `bind.cells`, ни одного `obj.newProp = x` после создания, ни одного `delete`.
2. **Ноль аллокаций на тёплое чтение.** Канал — функция с двумя необязательными параметрами: ни массива аргументов, ни промежуточного объекта.
3. **Ключи мемоизации — примитивы, и ни одной конкатенации.** Ни `{head, peer}`, ни `` `${head}|${peer}` ``: срез по пиру выражен карри (`orderOf(peer)(head)`), реестр документов — двухуровневой картой.
4. **`Object.defineProperty` под запретом** на каналах и документах: 120 нс против 4 нс.
5. **Диспетчеризация по виду — однократно** при создании ячейки, дальше девять мономорфных пар функций.
6. **Один сентинел.** Отсутствие значения — `blank` типа; отсутствие ссылки — `null`; `undefined` не является значением ни одного типа схемы.

### 3.15 Что для этого нужно от S3

Слой упирается в пять вещей, которых у сегодняшней `Replica` нет:

1. `Land.order(head)` поверх индекса `head → peer → self`, а не фильтрацией всего набора юнитов: при 100 000 юнитов холодное чтение одного поля было бы обходом всего ленда.
2. `Land.orderOf(head, peer)` — для `atom.by(peer)`.
3. `post({head, lead, self, value, tag})` с **явным** `self` — он нужен и для сохранения поддерева при перезаписи, и для контентных адресов.
4. Гидрация и расшифровка как точка приостановки **на том же канале, что и чтение**. У baza `sands_open` — плавающий промис: `units_of` вызывает его и игнорирует результат, `sand_decode` ловит TypeError и возвращает `null`, и «ещё не расшифровано» становится неотличимо от «пусто».
5. Соль ленда, доступная синхронно после гидрации (для контентных адресов, §3.6).

---

## 4. Валидация и мусор от чужой версии

Один контракт на весь слой:

| момент | что делает | чего НЕ делает |
|---|---|---|
| `decode(raw)` | вернёт `T` или `null` | **никогда** не бросает |
| промах разбора | `report(Issue)` + `type.blank` | не подставляет «первый вариант enum» |
| `encode(value)` | вернёт `Vary` | бросает только на том, что типом не выражается (`t.pattern`) |
| `check(next)` | `Issue \| null` для форм | ничего не пишет |
| `issue()` | «почему тут blank» вторым проходом | не участвует в горячем чтении |
| отказ по правам | `Issue{kind:'denied'}` + `$.canWrite()` для UI | не возвращает молча `null` |

`Issue` несёт **данные** для диагностики, а не текст: ленд, голова, `self`, пир, имя поля, ожидаемая схема, что пришло. Это ровно требование PRINCIPLES «сообщение содержит `cause` с id ленда, пира, юнита».

В baza валидация не единообразна: `$mol_schema_instance.cast` переопределён на `guard` и **бросает прямо из чтения**; `enum.cast` молча подставляет `Options[0]`; `float.default` — `NaN`; `atom.of()` оборачивает схему в `maybe`, а `list.of()` — нет, поэтому чтение списка с мусором от чужого пира бросает исключение из геттера. У нас бросать имеет право только запись, и то лучше не давать туда попасть типом.

Отдельно: неизвестный член перечисления от узла новой версии **обязан** читаться как `null`, а не как валидное значение. Тут дизайн делает шаг дальше рантайм-соглашения — у `Cast` нет `blank`, поэтому «а что подставить» невыразимо как вопрос (§0, Р5).

---

## 5. Гранулярность синхронизации

```ts
export type Born =
  | 'here'                                  // текущий ленд: живёт и умирает с родителем
  | 'area'                                  // новая area внутри ленда: синкается отдельно
  | {readonly land: Preset}                 // новый ленд со своими правами
```

Три ветки — прямой порт `ensure_here` / `ensure_area` / `ensure_lord`. Место рождения объявляется **в схеме** (`author: link('user', {land: readers})`) и переопределяется в вызове (`post.author.ensure({land: guests})`). Объявление в схеме важнее, чем кажется: если выбор живёт только в вызове, два места кода родят одну и ту же сущность в разных лендах.

`ensure` детерминирован: `idea = H(соль ‖ ссылка на само поле)`, поэтому два пира, одновременно вызвавшие `ensure` на одном поле, получат один и тот же head и сойдутся. Возьми адрес рандомом — получишь две сущности и потерянные данные.

Это единственное место, где прикладной разработчик обязан подумать про гранулярность синхронизации. Это правильно: автоматически угадать нельзя, а спрятать выбор значит спрятать самое дорогое решение в приложении.

---

## 6. Что даёт S3 и чего он не даёт

Порядок детей **не хранится** — он выводится из цепочки `lead` при каждом чтении, и это источник interleaving-free. Индекс LWW включает `lord`, поэтому «кто что писал» сохраняется между пирами (`atom.by(peer)`), но не внутри одного пира: своя предыдущая версия затирается. `null` — надгробие, а не значение; хранимого `null` не существует, и попытка ввести его воскресила бы удалённые элементы старыми надгробиями.

---

## 7. Честные компромиссы

**7.1 `Map.get` на каждом тёплом чтении.** Ячейки на модель дают ноль стоимости за непрочитанное поле, но тёплый путь идёт через `nodes.get(head)` — ≈20–30 нс против ≈1–3 нс у варианта «канал = собственный файбер». Бюджет 500 нс берётся с запасом ×16, размен сознательный; если профиль реальной нагрузки покажет обратное, менять надо §3.3, а не бюджет.

**7.2 Реестр требует ручного `declare module` и делает имена глобальными.** Пять строк на файл модели, которые ничем не проверяются: забыл — ошибка прилетит в первом же `link('user')` (зато **в ту же строку**, а не каскадом через модуль). Две библиотеки не могут обе завести `'user'`; смягчается префиксом (`'blog/user'`), но по существу неизбежно: имя лежит в данных и обязано быть стабильным вечно. Переименование модели — миграция формата, а не рефакторинг.

**7.3 Методы вместо свободных функций стоят tree-shaking.** Таблица методов создаётся на (модель, поле) сразу для всего вида, поэтому приложение, которое не двигает элементы, всё равно тащит `move`. Плюс отвязанный метод (`const {push} = post.tags`) ломается — в dev с говорящим текстом, в прод с `TypeError`. Куплена открываемость: `post.tags.` показывает список операций, и это первое, обо что спотыкается новый человек в проекте.

**7.4 Два файбера на прочитанное поле.** Разделение `slot`/`value` экономит пересчёты, но удваивает память кэша: при «прочитали одно поле у 10 000 сущностей» это ≈2 × 136 Б × 10 000 ≈ 2.7 МБ плюс записи в две карты. Слияние в один файбер дало бы вдвое меньше памяти ценой декода при каждом добавлении соседнего поля. Решается замером, обе ветки бенчатся.

**7.5 `slot` сканирует ключи через `keyIndex`, а `keyIndex` — O(k).** Для восьми полей это ничто; для сущности с двумя сотнями полей появление ключа стоит 200 сравнений плюс `equals` на карте того же размера. Порог, за которым нужен индекс с гранулярностью по ключу поля, — примерно 30 полей; до него он не окупает своей сложности.

**7.6 Материализация документа платит за все поля.** Хендл на 8 полей — объект на 9 слотов, 8 `JSFunction`, 8 контекстов по два слота и 8 таблиц свойств: оценочно ≈1.5–2 КБ и ≈600 нс. Список из 10 000 постов, открытых целиком, — ≈15–20 МБ, даже если читается одно поле. Ленивые геттеры отвергнуты (`defineProperty` — 120 нс и словарный режим, own-свойство поверх прототипного геттера — N смен шейпа на сущность), `Proxy` отвергнут (плохо типизируется, ломает tree-shaking, делает каждое обращение мегаморфным). Смягчение — виртуализация на стороне UI и `space.doc()` как Map-lookup при повторном открытии; устранения нет.

**7.7 `blank` стирает разницу между «пусто» и «мусор», а `null` — между «не заполняли» и «стёрли».** `t.string` вернёт `''` и когда поля нет, и когда пир прислал число; различить можно только через `issue()` вторым проходом. Хранимого `null` не существует, потому что `null` в ленде — надгробие. Приложению, которому эта разница нужна, придётся моделировать её явным полем.

**7.8 Массив пересчитывается целиком на любую правку.** `post.tags()` зависит от каждого элемента; правка одного инвалидирует весь канал: пересборка списка на 1000 — это `order()` (109 мкс, замер S3) плюс 1000 декодов ≈ 150–250 мкс. Обещания «`at(i)` подписан на свой элемент» здесь **нет**, и это сознательно: базовый дизайн такое обещал, а по механизму оно не выполняется — `at(i)` читает тот же кэшированный массив. Для текста ситуация мягче за счёт уровня абзацев; для больших списков — нет. Настоящее решение — инкрементальный `order()`, и это работа не S4.

**7.9 Чтение поля может приостановиться.** `post.title()` бросит `Suspend`, если ленд ещё гидрируется или расшифровывается. В компоненте это `pending`, вне компонента — сюрприз для всякого, кто ждал чистый геттер. Выбор сознательный: иначе «не загружено» и «пусто» неразличимы.

**7.10 `cast` бесплатен по данным, но не по кэшу.** Читая одно поле и как текст, и как список токенов, получаем два независимых файбера на один `head`. Данные не дублируются, кэш — да. И `cast` ничего не проверяет: `cast(post.body, dict(t.string, t.int))` даст словарь с бессмысленными ключами и не пожалуется. «Бесплатно» и «безопасно» — разные обещания, выполнено первое.

**7.11 Схема — линза, а не ограничение на диске.** Другой пир (или другая версия нашего же приложения) может положить в `title` число. Мы прочитаем `''` и пожалуемся. «Типизировано» здесь значит «типизировано на чтении», а не «валидно в ленде»; иначе быть не может в системе, где авторитета нет ни у кого.

**7.12 Миграций нет.** Смена `atom(t.number)` на `atom(t.string)` превращает все старые юниты в `blank` плюс поток `Issue`. Коэрсеры и версия схемы в `meta` — отдельная работа (§10).

**7.13 Мост во Vue — по каналу на чтение.** `useValue(() => post.title())` на каждое реактивное выражение многословнее, чем `reactive(post)`. `toRefs(doc)` напрашивается и отложен сознательно: он материализовал бы все поля разом и убил бы ленивость там, где она нужнее всего. Взамен получено главное — **один** вид документа, а не два внешне одинаковых с разной реактивностью.

**7.14 Глубина индекса — литерал 1…4.** Путь типизирован таблицей, а не рекурсией: рекурсивный разбор кортежа разворачивается на каждом использовании и заметно грузит чекер. Глубже 4 — `readonly Key[]` без проверки длины.

**7.15 Порядок ключей изменён относительно baza.** У неё `dive` → `add` → `lead = hole`, ключи ложатся в обратном порядке вставки. У нас ключ всегда в конец. Следствие: два ассерта `dict.test.ts` и один `empire.test.ts` при портировании **не сойдутся** и переписываются с комментарием. Мы меняем наблюдаемое поведение, а не только внутренности.

**7.16 `self` ключа больше не зависит от точки вставки, а на шифрованном ленде подсолен.** Дедупликация конкурентных ключей стала надёжнее, но документ, записанный самой baza, не сольётся с нашим ключ в ключ. Совместимость не цель (правило 1), но факт зафиксирован.

---

## 8. Приёмка

### 8.1 Гейт корректности: порт корпуса baza — через бинарный round-trip

Это не деталь оформления. `units_steal` кладёт **те же JS-объекты** юнитов в чужой индекс, а глобальный `trusted` WeakSet помечает всё локально созданное доверенным навсегда, поэтому весь корпус из 27 сценариев слияния проверяет алгоритм на разделяемых объектах и не проверяет ни кодек, ни идентичность после десериализации, ни ветвление, сравнивающее `Link` по ссылке. У нас каждый merge-кейс обязан пройти `packEncode` → `packDecode` и **заново сконструированные** юниты.

| источник | кейсов | что даёт |
|---|---:|---|
| `atom.test.ts` | 5 | пустое значение; две разные схемы на одном head («схема — линза»); `vary('drive')` мимо enum → `blank` + один `Issue`, не throw |
| `list.test.ts` | 22 | якоря `push`/`unshift`/`splice`; приоритет ветвей реконсиляции; серии `move`; 14 кейсов конкурентного слияния в обоих порядках |
| `dict.test.ts` | 3 | порядок ключей как контракт; слияние ключа и списка; три взаимно ссылающиеся модели с `ensure` в отдельные ленды |
| `text.test.ts` | 5 | семь правок с проверкой токенов через `cast`; offset↔point на двух уровнях; слияние одинаковых вставок с последующим расхождением |
| `tokens.test.ts` | 10 | чистая функция, переносится дословно: ZWJ-эмодзи одним токеном, CamelCase как граница |
| `cast.test.ts` | 2 → 6 | atom↔list, atom↔dict с сохранением поддерева; **новое**: text↔list, dict↔list |
| `link.test.ts` | 11 | алгебра идентификаторов под `link()`; 9 из 11 — `relate`/`resolve` |
| `land.test.ts` | 2 из 6 | «Inner Links are relative to forked Land»: форк ссылается на СВОИ внутренности |
| `empire.test.ts` | 1 → 3 | трёхуровневый каскад лендов; **новое**: чтение отсутствующей ветки не создаёт юнитов |

Порт `link.test`/`land.test` добавлен против базового дизайна: без него инвариант «внутриленд-ссылка хранится относительной и переразрешается на читающий ленд» не проверяется ничем, а на нём стоит весь `link()`.

Два кейса `list.test.ts` (строки 219 и 261) несут в ожидаемом значении авторский комментарий `// extra change (3) => unexpected result` — baza зафиксировала как эталон собственный дефект `sand_move`. Переносятся **с исправленным ожиданием** и отдельной строкой в реестре расхождений.

### 8.2 Новые тесты

| тест | что доказывает |
|---|---|
| `model.tamper.prop` | `fast-check` кладёт произвольный `Vary` в произвольное поле произвольной схемы. Чтение **никогда** не бросает; возвращается `blank`/`null`; на каждый испорченный юнит ровно один `Issue` с непустыми `head`, `self`, `peer`, `expected`, `got`. **Все** виды схем, а не только atom |
| `model.reconcile.prop` | число новых юнитов = число реально изменившихся позиций, ни одним больше; плюс эквивалентность `reconcile` и `reconcileNaive` на 10 000 случайных пар |
| `model.idempotent.prop` | `x(x())` → 0 юнитов; `x(v); x(v)` → ровно 1 |
| `model.granularity` | запись в `post.title` не пересчитывает `value`-файбер `post.tags`; **первая** запись в новое поле пересчитывает `slot` соседей, но не их `value` (счётчик через `@sync/fiber/inspect`) |
| `model.identity` | `space.doc(Post, id) === space.doc(Post, id)`; `post.author() === space.doc(User, uid)`; `cast(x, v) === cast(x, v)` |
| `model.cast` | 6 направлений между atom/list/dict/text на одной голове; `cast` не порождает юнитов; `headOf` совпадает у всех видов |
| `model.rename` | переименование ключа через cast-в-атом сохраняет вложенное поддерево |
| `model.keys-order` | порядок ключей — вставочный; регрессия против LIFO baza |
| `model.suspense` | чтение поля негидрированного ленда приостанавливается, а не отдаёт `blank`; расшифровка — на том же канале |
| `model.denied` | запись без прав даёт `Issue{kind:'denied'}`, а не молчит; `$.canWrite()` предсказывает результат |
| `model.meta` | ребёнок с `self = ''` не появляется ни в `keys()`, ни в `items()`, ни в `tokens()`; `$.meta()` его находит |
| `model.bigint-roundtrip` | записать `0n`, прочитать `0n`. У `$mol_vary` малый bigint терял тег и возвращался числом (`list.test.ts:66` против `:83`), а `vary.test.tsx` этого не проверяет |
| `model.converge.prop` | две реплики, случайные операции **модели** (`post.title(x)`, `push`, `write`), случайное расписание доставки → одинаковое чтение |

Property-набор из [04 §6](04-crdt-core.md) (convergence, idempotence, commutativity, interleaving-free, tombstone, causality) поднимается на уровень **операций модели**, а не только сырых юнитов. Это буквальное исполнение наблюдения из PRINCIPLES про второго потребителя ядра: набор, написанный из тех же предположений, что и код, целый класс ошибок не видит.

### 8.3 Тесты типов — часть набора

```ts
expectTypeOf(post.title()).toEqualTypeOf<string>()
expectTypeOf(post.status()).toEqualTypeOf<'draft' | 'live' | 'archived'>()
expectTypeOf(post.tags()).toEqualTypeOf<readonly string[]>()
expectTypeOf(post.body()).toEqualTypeOf<string>()
expectTypeOf(post.author()).toEqualTypeOf<Doc<'user'> | null>()
expectTypeOf(post.stats()).toEqualTypeOf<Doc<'stats'>>()
expectTypeOf(post.comments('c1')).toEqualTypeOf<Doc<'comment'>>()
expectTypeOf(post.reactions('👍')).toEqualTypeOf<number>()
expectTypeOf(post.excerpt()).toEqualTypeOf<string>()
expectTypeOf(post.tags.at(0)).toEqualTypeOf<string | null>()
expectTypeOf(post.author.ensure()).toEqualTypeOf<Doc<'user'>>()
expectTypeOf(post.body.pointAt(0)).toEqualTypeOf<Point>()
expectTypeOf(blog.archive(['2026', '08', 'vue'])).toEqualTypeOf<Doc<'post'> | null>()
expectTypeOf(cast(post.body, list(t.string))()).toEqualTypeOf<readonly string[]>()

// рекурсия разворачивается в обе стороны и не упирается в лимит
expectTypeOf(post.author()!.posts()[0]!.author()!.name()).toEqualTypeOf<string>()

// ни одного any — по каждому виду поля
expectTypeOf(post.title).not.toBeAny()
expectTypeOf(post.comments).not.toBeAny()
expectTypeOf(blog.archive).not.toBeAny()
expectTypeOf(post.$.authors()).toEqualTypeOf<readonly Peer[]>()

// @ts-expect-error число вместо строки
post.title(42)
// @ts-expect-error члена нет в перечислении
post.status('published')
// @ts-expect-error у атома нет списковых операций
post.title.push('x')
// @ts-expect-error ссылка nullable, точку ставить нельзя
post.author().name()
// @ts-expect-error у перечисления нет blank — нужен .or() или t.maybe()
atom(t.enum(['a', 'b']))
// @ts-expect-error `$` зарезервирован под операции документа
model('bad', {$: atom(t.string)})
// @ts-expect-error путь короче объявленной глубины
blog.archive(['2026'])
// @ts-expect-error путь длиннее
blog.archive(['2026', '08', 'vue', 'лишнее'])
// @ts-expect-error модель не зарегистрирована в Models
link('нет-такой')
```

Плюс сторожевой прогон `tsc --noEmit` с `erasableSyntaxOnly`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` на файле-образце со всеми девятью видами полей. Всё перечисленное выше **уже проверено компилятором на прототипе типов** — включая срабатывание каждой директивы `@ts-expect-error` (неиспользованная дала бы TS2578) и качество сообщений: `Property 'titel' does not exist on type 'Doc<"post">'. Did you mean 'title'?`.

### 8.4 Форма объектов и деоптимизация

```js
// bench/assert-opt.mjs
const a = space.doc(Post, 'p1')
const b = space.doc(Post, 'p2')
assert(%HaveSameMap(a, b), 'хендлы одной модели обязаны иметь один шейп')
assert(%HaveSameMap(a.title, b.title), 'каналы одного поля обязаны иметь один шейп')

warmup(() => a.title())
%OptimizeFunctionOnNextCall(readTitle)
readTitle(a)              // после реального сценария: 10 моделей, 1000 документов
assert(isOptimized(readTitle), 'чтение поля разоптимизировалось')
```

```js
// bench/memory.mjs — правило горячего пути №5
const before = heapUsed()
for (let i = 0; i < 1e6; i++) sink = post.title()
assert(heapUsed() - before < 1024, 'тёплое чтение аллоцирует')
```

Плюс `--trace-ic` на `post.title`: мономорфно при одной модели, не хуже полиморфного при пяти. Прогон в Node и Chromium; расхождение больше 2× — повод разобраться, а не выбрать удобную цифру.

### 8.5 Бюджеты (фиксируются ДО первого запуска)

Рядом с бюджетом — **пол платформы**: бюджет ниже пола не «не выполнен», он неверен и правится с приложенной цифрой пола.

| бенч | бюджет S4 | цель | пол платформы |
|---|---:|---:|---|
| `field/warm` — `post.title()` на тёплом кэше | **≤ 500 нс** | ≤ 50 нс | `Map.get(string)` + вызов + `Fiber.read` (0.6 нс, S1) — мерить до |
| `field/warm` heap-delta | **0 Б** | 0 Б | 0.009 Б/оп на тёплом `computed` (S1) |
| `field/neighbour` — чтение `title` после первой записи в `tags` | **0 пересчётов `value`** | 0 | счётчик, не время |
| `field/cold` — первое чтение поля | ≤ 3 мкс | ≤ 1 мкс | 2 × создание файбера (14.7 нс) + `order(head)` + декод |
| `doc/open` — хендл на 8 полей | ≤ 1 мкс | ≤ 400 нс | 8 × (JSFunction + контекст + `Object.assign` шести свойств) |
| `doc/mem` — байт на хендл (8 полей) | ≤ 2 КБ | — | голый объект на 9 слотов + 8 функций, `--expose-gc` |
| `doc/reopen` | ≤ 100 нс | — | 2 × `Map.get` |
| `list/read-1000` тёплый | ≤ 50 нс | — | 0.6 нс: массив кэширован, не пересобирается |
| `list/rebuild-1000` | ≤ 300 мкс | — | `order()` на 1000 детей = **109 мкс** (замер S3) + 1000 декодов |
| `list/reconcile-1000` — одна правка | **ровно 1 юнит**, ≤ 2 мс | — | требование DoD S4 |
| `write/idempotent` — `x(x())` 10 000 раз | **0 юнитов**, ≤ 5 мс | — | без этого эхо между пирами бесконечно |
| `text/insert-100k` — вставка символа | **≤ 1 мс**, ≤ 3 юнита | — | токенизация одного абзаца |
| `cast/warm` | ≤ 50 нс | — | 2 × `Map.get` |
| `index/keys` — 3 уровня, 1000 листьев | ≤ 500 мкс | — | 3 × `order()` |
| `model/size` — минифицированный + gzip | ≤ 8 КБ поверх `@sync/core` | — | мерится тем, что доезжает до пользователя |

**Сравнение с оригиналом обязательно** (правило 2). У baza чтение пятого поля из пяти = пять декодов + пять `$mol_compare_deep` (каждое заводит WeakMap) + пять выборок из мемо-карт, причём `dive` не мемоизирован вовсе — авторы знали и оставили закомментированный `// $mol_wire_field(Entity.prototype, Field)` в самом файле. Ожидаемый разрыв на тёплом кэше — два порядка. Если замер даст меньше, значит модель кэширования выбрана неверно, и пересматривать надо §3.3, а не бюджет.

---

## 9. Расхождения с планом docs/05

| было в прототипной редакции | стало | почему |
|---|---|---|
| `Object.defineProperty(Model.prototype, key)` + `memKey(Model.prototype, …)` | `model()` возвращает данные, `space.doc()` — объект каналов | ограничение 1: без `this`, без классов у прикладника, без мутации чужих объектов. Это ровно п. 15 реестра, применённый к модели |
| `ref()` / `refs()` | `link()` / `links()` | `ref` занято ядром в значении «записываемый источник» |
| поле возвращает `Pawn \| null`, прикладной код обвешан `?.` и `!` | поле возвращает **значение**: `post.title()` — `string` | `AtomText \| null` с обязательным `?.val()` — главная эргономическая беда оригинала |
| `dive(key, P, auto)` — один слот под значение, флаг создания и права | `post.author()` читает, `post.author(x)` пишет, `post.author.ensure(born)` создаёт | ловушка перегруженного аргумента; `user.Title(null)!.val('Jin')` — её предел |
| `t.enum([...])` с `cast → Options[0]` | `Cast` без `blank`; `atom(t.enum(…))` не компилируется | член от узла новой версии не может стать валидным значением |
| `cast(raw)` на чтении и `guard(next)` на записи как две несогласованные роли | один контракт `decode → T \| null`, никогда не бросает; `check(next)` для форм; `issue()` для диагностики | у baza чтение бросало в двух местах из пяти |
| `empire(Post).path([...])` как отдельное понятие | `index(3, 'post', 'area')` — обычное поле схемы с типизированным путём | путь проверяется по длине и по типам ключей; `empire.test.ts` в старом §6 не значился вовсе |
| `Text.pointByOffset → Point`-кортеж | `Point` как размеченное объединение с `rest` | `['', off, 0]` значил и координату, и остаток |
| «`cast.test.ts` ~90 строк» | 51 строка, 2 кейса → расширяем до 6 | цифра в старом §6 завышена вдвое; заодно добавлены text↔list и dict↔list |
| корпус переносится как есть | каждый merge-кейс идёт через `packEncode`/`packDecode` | `units_steal` + глобальный `trusted` делают 27 сценариев слепыми к кодеку и к идентичности после десериализации |
| про `Pawn.units()` и meta не сказано | `self = hole` — meta-слот, отфильтрован во всех видах, доступен через `$.meta()` | иначе ссылка на схему протекает в `keys()` каждой модели |

### Новые строки в реестр расхождений

| # | где | недочёт оригинала | наше решение |
|---|---|---|---|
| 23 | наша же docs/05 прошлой редакции | модель объявлялась патчингом прототипа: требует `this`, мутирует чужие объекты, отдаёт `Pawn \| null` вместо значения | схема — данные; документ — объект каналов; тот же ход, что в п. 15 для `computed()` |
| 24 | `baza` `dict.dive` | мемоизации нет вовсе (закомментированный `$mol_wire_field` в коде), чтение поля — линейный скан с `$mol_compare_deep`, который заводит WeakMap на каждое сравнение | поле — пара `computed.keyed` на (модель, поле); под ними `keyIndex` даёт O(1) lookup |
| 25 | `baza` `sand_ordered` | мемо по объектному ключу `{head, peer}`: аллокация литерала и сериализация в строку на каждый вызов самого горячего пути | `order(head)` и `orderOf(peer)(head)` — примитивные ключи, ни одной конкатенации |
| 26 | `$mol_schema_enum` | `cast` молча подставляет `Options[0]` | у перечисления нет `blank`; `atom(t.enum(…))` не компилируется без `.or()` или `t.maybe()` |
| 27 | `$mol_schema_instance`, `baza` `list.of` | `cast` переопределён на `guard` и бросает прямо из чтения; `list.of()` не оборачивает схему в `maybe` | `decode(raw): T \| null`, никогда не бросает, `Issue` с полным контекстом |
| 28 | `baza` `dive(key, P, auto)` | один слот значит и «значение», и «создать», и «права» | три раздельные операции: чтение, запись, `ensure(born)` |
| 29 | `baza` `list.add` / `splice` | `add` постит с `lead = hole` (в начало), `splice` — в конец; порядок ключей словаря обратный и нигде не заявлен | явные `push` / `unshift`, порядок — часть контракта, тест падает при его смене |
| 30 | `baza` `self` ключа | выводится из `head + lead`, то есть от точки вставки → два поддерева на один ключ | `H(соль ‖ head ‖ ключ)`; для элементов списка формула baza сохранена |
| 31 | `baza` шифрованный ленд | `self` берётся случайным — теряется схлопывание одинаковых конкурентных вставок | контентный адрес всегда, подсоленный секретом ленда; хеш синхронный, чтобы запись не стала приостанавливаемой |
| 32 | `baza` `land.self_make` | `_self_all` пополняется только собственным генератором; после перезапуска контентный адрес может выдать занятый `self` и молча заменить чужой элемент | реестр восстанавливается из индекса при гидрации |
| 33 | `baza` `text.point_by_offset` | `@$mol_action` на чистом чтении (подписки нет, дорисована вручную строкой `this.vary()`) + кортеж-сентинел `['', off, 0]` | обычные чтения над `tokens()` + `Point` как размеченное объединение с `rest` |
| 34 | `baza` `sands_open` | плавающий промис: «ещё не расшифровано» неотличимо от «пусто» | чтение приостанавливается на том же канале |
| 35 | `baza` `dive` при отказе прав | молча возвращает `null` | `Issue{kind:'denied'}` + отдельный канал `$.canWrite()` для UI |
| 36 | `baza` `dict.with` | `static get schema` закомментирован, `Object.assign` делает снимок — наследование работает наполовину | схема — данные; композиция — `extend()` и spread |
| 37 | `baza` `list.items_vary` / `atom.vary_of` | сеттер заканчивается на `return this.items_vary()` — канал перевычисляется изнутри себя | запись не реентерантна; значение приходит обычным распространением |
| 38 | `baza` `sand_move` | ветвление по идентичности JS-объектов `Link`: один и тот же логический `move` даёт разный граф в зависимости от того, создан ли элемент в этой сессии; два теста зафиксировали дефект как эталон | сравнение по значению; `move` меняет `lead` перемещаемого узла, соседа не переписывает; оба теста портированы с исправленным ожиданием |
| 39 | `baza` тесты слияния | 27 кейсов гоняют одни и те же JS-объекты через `units_steal`, `trusted` отключает проверку подписи | каждый merge-кейс идёт через `packEncode`/`packDecode` и заново сконструированные юниты |
| 40 | `$mol_vary` | малый bigint теряет тег: записанный `0n` читается как `0`, и в корпусе это не проверено | bigint кодируется отдельным расширением независимо от величины; `model.bigint-roundtrip` держит контрпример |

---

## 10. Что в S4 не входит

- **Миграции схем.** Смена типа поля сегодня равна потере его данных. Нужны коэрсеры (`t.number.from(t.string)`) и версия схемы в `meta`.
- **Инкрементальный `order()` и гранулярность по элементу списка.** Без него правка одного элемента из 1000 пересобирает весь массив (§7.8).
- **Инкрементальные агрегаты.** `$.changedAt()` и `$.authors()` остаются полным обходом поддерева и потому объявлены явно ленивыми, а не дешёвыми каналами.
- **`toRefs(doc)` для Vue.** Материализует все поля разом.
- **Tine и Area в `order()`** — S3.5; вместе с ними уточнится `born: 'area'`.
- **Права на уровне поля.** `$.canWrite()` спрашивает у ленда, а не у поля; поле-гранулярные права — вопрос S6.