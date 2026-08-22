# 02. Дизайн рантайма `@sync/fiber`

Файберная реактивность в классической TS-экосистеме. Пакет самодостаточен и
полезен вне CRDT — публикуется отдельно.

**Зависимости:** `alien-signals` (только подпуть `/system`). Больше ничего.
**Целевой размер:** ≤ 4 КБ min+gzip. **Платформа:** `neutral` (браузер, Node, воркер).

---

## 1. Цели и не-цели

**Цели**
1. `foo()` — синхронное чтение, даже если внутри сеть/диск/крипта.
2. Побочные эффекты выполняются ровно один раз, сколько бы раз ни перезапустился
   вычислитель.
3. Автоматическое время жизни: узел жив, пока его кто-то читает.
4. Мультиэкземплярность: несколько независимых графов в одном процессе.
5. Отладка: у каждого файбера есть человекочитаемый id, у промиса — вменяемый стек.

**Не-цели**
- Не заменяем реактивность фреймворка. Vue/React работают как работали, мост —
  тонкий ([§8](#8-мост-в-ui)).
- Не отслеживаем зависимости после `await`. `async`-функции внутри файберов
  поддерживаются, но только как листовые операции — см. [§4.1](#41-async-функции-внутри-файберов).
- Не даём «отменить всё» через AbortController глобально. Отмена — через
  разрушение файбера, который держит задачу.

---

## 2. Слои

```
┌─ 5. Каналы: signal / memo / memoKey / effect           публичный сахар
├─ 4. Границы: sync / async / probe / stale / race / act  протокол Suspense
├─ 3. Коллекции: ReactiveMap / ReactiveSet / ReactiveVar
├─ 2. Файберы: Fiber → Atom | Task, планировщик, GC       ← наш код, ~450 строк
└─ 1. Граф: createReactiveSystem из alien-signals/system  ← чужой код
```

---

## 3. Слой 1 — граф

```ts
import { createReactiveSystem, ReactiveFlags, type ReactiveNode, type Link }
  from 'alien-signals/system'

const { link, unlink, propagate, checkDirty, shallowPropagate } = createReactiveSystem({
  update: node => (node as Fiber).update(),
  notify: node => scheduler.enqueue(node as Fiber),
  unwatched: node => scheduler.reap(node as Fiber),
})
```

Соответствие понятий:

| $mol_wire | alien-signals/system |
|---|---|
| `cursor = stale` | `flags & Dirty` (16) |
| `cursor = doubt` | `flags & Pending` (32) |
| `cursor = fresh` | ни `Dirty`, ни `Pending` |
| `cursor = final` | `flags = 0` + наш признак `done` |
| `track_on()` / `track_off()` | `setActiveSub()` + `depsTail = undefined` |
| `track_next(pub)` | `link(dep, sub, cycle)` |
| `track_cut()` | `purgeDeps()` (наш, по образцу alien) |
| `emit()` | `propagate()` + `shallowPropagate()` |
| `fresh()` у `doubt` | `checkDirty()` |
| `reap()` | колбэк `unwatched` |

---

## 4. Слой 2 — файберы

### Типы

```ts
type Suspend = Promise<unknown>
type FiberCache<R> = R | Error | Suspend | undefined

// ОДИН класс на две роли, все поля в одном конструкторе и в одном порядке.
// Подклассов нет вовсе: у подкласса другой прототип, значит другой скрытый класс.
class Fiber<R = unknown> implements ReactiveNode {
  readonly kind = KIND_FIBER
  deps?: Link; depsTail?: Link; subs?: Link; subsTail?: Link
  flags: number

  readonly host: unknown              // типы хоста и аргументов ядру не нужны:
  readonly task: FiberTask            // их знают только обёртки memo/act/sync
  readonly args: readonly unknown[]
  cache: FiberCache<R>

  readonly temp: boolean              // задача (true) или долгоживущий узел (false)
  done: boolean                       // задача досчиталась — соответствует cursor = final
  pinned: boolean                     // pin(), защита от сборки
  disposed: boolean

  get id(): string                    // ленивый: сборка строки — 52 % создания узла
}
```

**Шейп фиксирован намеренно** ([правило 2, горячие пути](../PRINCIPLES.md#правила-для-горячего-пути)):
роль выражается полем-тегом `temp`, а не подклассом. `%HaveSameMap` подтверждает
единый скрытый класс у долгоживущего узла и задачи, и он сохраняется после того,
как узел побывал в ошибке и в приостановке.

Вид содержимого кэша (значение / ошибка / приостановка) хранится **битами флагов
выше 32**, которые субстрат не использует. Путь чтения не ощупывает само значение:
проверка «промис ли это» грузила бы `.then` с произвольного объекта, а это
мегаморфный доступ на самом горячем месте. Замер до и после — в
[11 §замеры S1](11-roadmap.md#замеры-s1-2026-08-15).

Кэш из трёх состояний — как в mol: **ошибка это значение**, а не исключение,
поэтому она не пересчитывается на каждом чтении и инвалидируется по общим правилам.

### `update()` — ядро

```ts
update(): boolean {
  const prevSub = setActiveSub(this)
  this.depsTail = undefined
  ++cycle

  let next: FiberCache<R>
  let suspended = false

  try {
    next = this.task.apply(this.host, this.args)
    if (isThenable(next)) { next = this.wrap(next); suspended = true }
  } catch (e) {
    if (isThenable(e)) { next = this.wrap(e); suspended = true }
    else next = e instanceof Error ? e : new Error(String(e), { cause: e })
  } finally {
    setActiveSub(prevSub)
    // ⚠ ключевая строка: хвост зависимостей режем ТОЛЬКО если досчитали.
    // При приостановке следующий прогон запросит те же зависимости в том же
    // порядке, и link() переиспользует существующие рёбра без аллокаций.
    if (!suspended) purgeDeps(this)
  }

  return this.put(next)
}
```

### `wrap()` — обёртка промиса

```ts
private wrap(p: Suspend): Suspend {
  const known = wrappers.get(p)
  if (known) return known

  const settle = (v: unknown) => {
    if (this.cache === wrapped) {
      if (thrown) this.invalidate()   // бросили промис → просто пересчитать
      else this.put(v as R)           // вернули промис → положить результат
    }
    return v
  }
  const wrapped: Suspend = p.then(settle, settle)

  // без этого отладка Suspense невозможна: стек указывает на место ожидания
  const trace = new Error(`Suspend in ${this.id}`)
  Object.defineProperty(wrapped, 'stack', { get: () => trace.stack })

  wrappers.set(p, wrapped)
  wrappers.set(wrapped, wrapped)
  return wrapped
}
```

`wrappers` — `WeakMap`, чтобы один промис не оборачивался дважды при перезапусках.

### `Atom.put()`

```ts
put(next) {
  const prev = this.cache
  this.cache = next
  if (isThenable(next)) return false          // ещё не готово — не будим
  if (equals(prev, next)) { this.complete(); return false }
  this.complete()                                 // ← коммит: убить дочерние Task
  return true                                     // → propagate из системы
}
```

`equals` — глубокое сравнение по образцу `$mol_compare_deep`, с поддержкой
`TypedArray` и наших `Link`/`Unit` (по байтам). Без него любая пересборка массива
будет будить всё дерево.

### `Task` — идемпотентность эффектов

```ts
function getTask<H, A extends readonly unknown[], R>(
  host: H, fn: (this: H, ...a: A) => R, args: A,
): Task<H, A, R> {
  const sub = activeSub as Fiber | undefined
  const existing = sub && peekNextDep(sub)      // что лежит на текущей позиции deps?

  if (existing instanceof Task
    && existing.task === fn
    && existing.host === host
    && shallowEqualArgs(existing.args, args)) return existing   // ← не выполняем повторно

  if (existing instanceof Task && DEV) warnDifferentTaskOnRestart(sub, existing, fn, args)
  return new Task(idFor(host, fn), fn, host, args)
}
```

`peekNextDep(sub)` — заглянуть в `sub.depsTail?.nextDep ?? sub.deps`, то есть в
ту зависимость, которая была на этой позиции в прошлый прогон. **Это тот же
позиционный протокол, что и в `$mol_wire_task.getter`** ([01 §5](01-mol-wire-internals.md#5-task-как-побочные-эффекты-становятся-идемпотентными)).

```ts
Task.put(next) {
  this.cache = next
  if (isThenable(next)) return true          // ждём — будим ждущих
  this.done = true                                // final
  if (!this.subs) this.dispose()
  return true
}
Task.complete() { if (!isThenable(this.cache)) this.dispose() }
```

`Fiber.complete()` у атома проходит по своим зависимостям: если ни одна не в
состоянии промиса — вызывает `complete()` у всех, то есть **уничтожает все
временные задачи разом**. Пока подграф не досчитан, задачи живут и хранят
результаты; как только досчитан — они не нужны.

### 4.2 `sync()` — не кэш

Свойство, обнаруженное экспериментом C2 и не заложенное в исходный план.

`complete()` уничтожает одноразовые задачи, как только подграф досчитан. Значит при
следующей инвалидации атома его `sync()` выполняется **заново**: позицию в списке
зависимостей к этому моменту занимает уже другой узел, переиспользовать нечего.

```ts
// ❌ загрузка повторится на каждое изменение tick
const view = atom(function view() {
  tick()
  return sync(load)
})

// ✅ источник живёт в своём атоме и переживает пересчёт потребителя
const loaded = atom(function loaded() { return sync(load) })
const view = atom(function view() {
  tick()
  return loaded.read()
})
```

Это не дефект, а граница ответственности: у одноразовой задачи не может быть
политики инвалидации — она по определению живёт один прогон. Кэширование
асинхронного источника выражается атомом, у которого такая политика есть.

Зафиксировано тестом `sync() внутри атома — не кэш` в `e1-deps-reuse.test.ts`.

### 4.1 `async`-функции внутри файберов

Промис, **возвращённый** задачей, обрабатывается так же, как промис, **брошенный**
из неё: кладётся в кэш, читатель приостанавливается, по разрешению — `put(value)`.
То есть `async function` внутри файбера работает, и это нормальный способ делать
листовой ввод-вывод.

**Но зависимости, прочитанные после первого `await`, не отслеживаются.**
`activeSub` — глобал с дисциплиной стека: `async`-функция возвращает управление
уже на первом `await`, после чего `setActiveSub(prevSub)` в `finally` немедленно
срабатывает. Продолжение выполняется в микрозадаче, когда активного подписчика
уже нет, — чтения проходят молча, без подписки.

Отсюда правило, которое в $mol соблюдается конвенцией, а у нас будет проверяться
типами:

> `async` допустим только на **листовых операциях** (`Task`, `act`, `sync`),
> никогда — на **реактивных каналах** (`mem`, `memKey`).

Так устроен весь mol и вся baza: `async`-методов под `$mol_mem`/`$mol_mem_key`/
`$mol_action` там **ноль**. Единственный `async` под декоратором — под
`$mol_memo.method`, а это нереактивный мемо по аргументам. В baza есть и прямой
обходной приём — [`land.ts:1212`](../../baza/land/land.ts#L1212):

```ts
async units_sign(units) {
  await Promise.resolve() // prevent deps   ← ждём пустой промис, чтобы деп не собрался
```

Канонический способ выразить то же самое **без** потери отслеживания —
Suspense-стиль, где вместо `await` стоит `sync()`:

```ts
// ❌ так деп на `this.config()` не соберётся
async total() { const c = this.config(); await load(); return c.x }

// ✅ так соберётся: файбер перезапустится и прочитает config() заново
total() { const c = this.config(); sync(load); return c.x }
```

**Наша страховка, которой нет в $mol.** `mem()` типизируется так, что не
принимает методы с возвращаемым типом `Promise<any>`:

```ts
type MemKeys<T> = {
  [K in keyof T]: T[K] extends (...a: any[]) => infer R
    ? (R extends PromiseLike<any> ? never : K)
    : never
}[keyof T]

export function mem<T extends object, K extends MemKeys<T>>(proto: T, ...fields: K[]): void
```

Плюс dev-проверка в рантайме: если задача **атома** вернула промис, а не бросила
его — предупреждение `async atom: deps after await are not tracked`. Для `Task`
это легально и молчит.

---

## 5. Слой 4 — публичное API

```ts
// ─── чтение/запись ───────────────────────────────────────────────────────────
export interface Channel<T> {
  (): T                    // читать (может приостановить вызывающий файбер)
  (next: T): T             // писать
  readonly atom: Atom<any, any, T>
}

// ─── вычисляемые значения (композиция функций, без классов и прототипов) ─────
export function memo<T>(get: () => T): Memo<T>
export function memo<T>(options: { get(): T; set(next: T): void }): WritableMemo<T>
export function memoKey<K extends MemoKey, T>(get: (key: K) => T): KeyedMemo<K, T>
export function peek<T>(channel: Memo<T>): T | undefined

// ─── границы Suspense ────────────────────────────────────────────────────────
/** выполнить эффект ровно один раз на прогон родителя */
export function act<A extends unknown[], R>(fn: (...a: A) => R): (...a: A) => R
/** дождаться промиса синхронно (внутри файбера) */
export function sync<A extends unknown[], R>(fn: (...a: A) => R, ...args: A): Awaited<R>
export function syncAll<T extends object>(obj: T): Synced<T>          // Proxy-форма, ADR-012
/** выйти из файбер-мира в промис */
export function async<A extends unknown[], R>(fn: (...a: A) => R, ...args: A): Promise<Awaited<R>>
export function asyncAll<T extends object>(obj: T): Asynced<T>

// ─── утилиты ─────────────────────────────────────────────────────────────────
export function probe<R>(fn: () => R): R | undefined      // без побочек и подписок
export function stale<R>(fn: () => R): R | undefined      // старое значение, пока грузится
export function race<T extends (() => unknown)[]>(...t: T): { [K in keyof T]: ReturnType<T[K]> }
export function untracked<R>(fn: () => R): R
export function pin(): void                                  // = $mol_wire_solid
export function batch<R>(fn: () => R): R
export function isSuspend(e: unknown): e is Promise<unknown>

// ─── управление ──────────────────────────────────────────────────────────────
export function effect(fn: () => void): () => void         // корневой наблюдатель
export function flush(): void                                // синхронно прогнать планировщик
export const scheduler: { pending(): number; onIdle(): Promise<void> }
```

### Пример: как это выглядит в коде ленда

Узел данных — функция-фабрика, возвращающая набор каналов. Ни `this`, ни
наследования, ни патчинга прототипов: композиция, как в composables у Vue.

```ts
export function createLand(ctx: Ctx, id: LandId) {
  const sands = new ReactiveMap<HeadStr, ReactiveMap<PeerStr, Sand>>()
  const gifts = new ReactiveMap<PeerStr, Gift>()

  /** Загрузка из хранилища. Синхронна снаружи, приостанавливает файбер внутри. */
  const loading = memo(function loading() {
    pin()
    applyUnits(sands, gifts, sync(() => ctx.store.load(id)), 'trusted')
  })

  const total = memo(function total() {
    loading()                            // ← приостановит, если ещё не загружено
    let n = gifts.size
    for (const peers of sands.values()) n += peers.size
    return n
  })

  const order = memoKey(function order(head: HeadStr) {
    loading()
    return orderOf(sands, head)
  })

  const post = act((head: Head, self: Self | null, value: Vary) => {
    // выполнится ровно один раз, даже если вызывающий файбер перезапустят
  })

  return { id, total, order, post }
}
```

Читатель делает `land.total()` и получает число. Что под этим IndexedDB, разбор
`Pack` и проверка ECDSA — его не касается.

**Почему не классы.** Прототипный вариант (`mem(Land.prototype, 'total')`) выглядел
чужеродно в остальном функциональном ядре, требовал `this`, патчил чужие объекты и
заводил отдельную машинерию `WeakMap<host, Map<field, Fiber>>`. Замер показал, что
цена перехода — 96 Б на канал (замыкание), при том что чтение остаётся тем же
(0.6 нс: V8 инлайнит вызов замыкания). Разница окупается тем, что композиция
выражается обычными функциями, а не соглашениями о прототипах.

---

## 6. Слой 3 — реактивные коллекции

### ReactiveMap {#reactivemap}

В отличие от `$mol_wire_dict` — гранулярность по ключу (ADR-011).

```ts
export class ReactiveMap<K, V> {
  #raw = new Map<K, V>()
  #keyNodes = new Map<K, SignalNode>()   // лениво: только для реально читанных ключей
  #shape = new SignalNode()              // множество ключей: size / keys / iteration

  get(k: K): V | undefined     { track(this.#keyNode(k)); return this.#raw.get(k) }
  has(k: K): boolean           { track(this.#keyNode(k)); return this.#raw.has(k) }
  set(k: K, v: V): this
  delete(k: K): boolean
  get size(): number             { track(this.#shape); return this.#raw.size }
  keys(): IterableIterator<K>    { track(this.#shape); return this.#raw.keys() }
  values(): IterableIterator<V>  { track(this.#shape); return this.#raw.values() }
  peek(k: K): V | undefined    // без подписки — для внутренних индексов
}
```

Правила:
- `set` существующего ключа тем же значением — ноль оповещений;
- `set` нового ключа трогает и `#keyNode`, и `#shape`;
- `delete` удаляет `#keyNode` — карта версий не растёт на churn'е;
- узлы версий создаются **только при чтении**, поэтому «записали и никто не
  читал» ничего не стоит.

Также нужны `ReactiveSet` и `ReactiveVar<T>` (одиночная ячейка).

---

## 7. Планировщик и GC

```ts
const planning = new Set<Fiber>()
let reaping   = new Set<Fiber>()
let scheduled = false

function enqueue(f: Fiber) { planning.add(f); schedule() }
function reap   (f: Fiber) { reaping.add(f);  schedule() }

function schedule() {
  if (scheduled) return
  scheduled = true
  queueMicrotask(() => { scheduled = false; flush() })
}

export function flush() {
  while (planning.size) {
    for (const f of planning) { planning.delete(f); f.refresh() }
  }
  while (reaping.size) {
    const batch = reaping; reaping = new Set()
    for (const f of batch) if (!f.subs && !f.pinned) f.dispose()
  }
}
```

- Одна микрозадача на тик, а не по одной на узел.
- **GC по достижимости**: атом без подписчиков умирает в конце тика. Ни `gcTime`,
  ни ручных `dispose` не нужно. Это заменяет всю логику `staleSubGcMs` +
  `gcTimer` + `entityRefCount` + `entityPins` из
  [queryGraph.ts](../../vue-sync-engine/lib/src/worker/queryGraph.ts).
- `pin()` держит узел вечно — для корней (Node, Yard, открытые ленды).
- `flush()` экспортируется: в тестах прогоняем граф синхронно, без `await tick`.

---

## 8. Мост в UI

Два независимых реактивных графа: наш и Vue. Мост односторонний — Vue читает нас.

```ts
// @sync/vue
import { watch as fiberWatch, probe } from '@sync/fiber'
import { shallowRef, triggerRef, onScopeDispose, type ShallowRef } from 'vue'

export function useChannel<T>(get: () => T): Readonly<ShallowRef<T | undefined>> {
  const r = shallowRef<T>()
  const stop = fiberWatch(() => {
    try { r.value = get(); triggerRef(r) }
    catch (e) { if (!isSuspend(e)) throw e /* ждём — просто не обновляем */ }
  })
  onScopeDispose(stop)
  return r
}
```

Тонкости, которые надо заложить сразу:

1. **Suspense не должен всплывать в Vue.** Пока файбер ждёт, `r.value` остаётся
   прежним. Состояние ожидания отдаём отдельно: `usePending(get)` через `probe`.
2. **Один мост на много читателей.** Десять компонентов, читающих одно поле,
   должны делить один `watch`. Кэшировать по ключу канала через `memKey`.
3. **Vapor.** Vue 3.6 Vapor использует свою реактивность (алгоритмически
   родственную alien-signals, но не тот же граф) — мост нужен точно так же.
4. Обратного направления нет: писать в модель из UI — обычный вызов `channel(v)`.

---

## 9. Отличия от $mol_wire

| | $mol_wire | @sync/fiber |
|---|---|---|
| Граф | свой (`pub`/`sub`, плоский массив) | `alien-signals/system` |
| Объявление | декораторы `@ $mol_mem` на методах класса | `memo(() => …)` — функция, без классов |
| Хранение атома | поле на хосте `name()` | замыкание канала |
| Коллекции | один `pub` на карту | сигнал на ключ + сигнал на форму |
| `sync` | только Proxy | явная форма + Proxy |
| Ошибки | `$mol_fail_hidden` | `throw` + `isSuspend()` в API |
| `async` в реактивном канале | запрещён конвенцией | dev-warning при возврате промиса из атома |
| Контекст | ambient `$` | явный `Ctx` в конструкторе |
| Модули | namespace | ESM |
| `enum` | да | `as const` + union |
| Devtools | `$mol_dev_format_*` | свой инспектор графа ([09](09-integration.md)) |

---

## 10. Риски и как их снимать

| # | Риск | Проверка |
|---|---|---|
| R1 | `alien-signals/system` может не пережить непокрытый `purgeDeps` при Suspense | **S1-T4**: файбер с 3 зависимостями приостанавливается после 2-й; после resolve список зависимостей идентичен и переиспользован (0 новых `Link`) |
| R2 | Позиционное переиспользование `Task` через `depsTail.nextDep` может не совпасть с моделью alien | **S1-T5**: 100 перезапусков с одинаковым порядком → `fn` вызвана 1 раз |
| R3 | Оверхед моста в Vue | **S1-B1**: 10 000 полей, точечное обновление → ≤ 1 Vue-эффект, время < 1 мс |
| R4 | Утечка `activeSub` при исключении из пользовательского кода | **S1-T6**: fuzz с бросающими задачами, `activeSub` всегда возвращается |
| R5 | Взаимная блокировка: файбер ждёт сам себя через цепочку | **S1-T7**: детект цикла + понятная ошибка `Circular suspend` |
| R6 | `equals` глубокого сравнения дорог на больших массивах | **S1-B2**: бенч; fallback на сравнение по ссылке + явный `equals` в канале |

---

## 11. План работ по пакету

| Шаг | Содержание | Строк |
|---|---|---|
| F1 | `Fiber`/`Atom`/`Task`, `update()`, `wrap()`, планировщик | ~450 |
| F2 | `mem`/`memKey`/`field`, id-генерация, dev-предупреждения | ~150 |
| F3 | `sync`/`async`/`probe`/`stale`/`race`/`act`/`pin`/`batch` | ~200 |
| F4 | `ReactiveMap`/`Set`/`Var` | ~180 |
| F5 | `@sync/vue` мост | ~80 |
| F6 | Инспектор графа (dev-only): дамп узлов, причины пересчёта | ~200 |
| | **итого** | **~1260** |

**DoD пакета:** порт тестов `../mol/wire/*.test.ts` (солo 644 строки, fiber 107,
task, sync, async, dict, set, plex) проходит на нашем рантайме с точностью до
переименований. Это ~1300 строк готовых спецификаций — самый дешёвый способ
доказать, что модель воспроизведена верно.
