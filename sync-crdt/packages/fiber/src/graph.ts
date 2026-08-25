// v8:hot — путь чтения и распространения; правила из PRINCIPLES.md §«горячий путь»
import { createReactiveSystem, type Link, type ReactiveNode } from 'alien-signals/system'

export type { Link, ReactiveNode }

/**
 * Флаги узла графа.
 *
 * Объявлены у нас, а не импортированы из `alien-signals/system`, по двум причинам.
 * Первая — в поставке зависимости `ReactiveFlags` описан как `declare const enum`,
 * а собирается как обычный объект; при `verbatimModuleSyntax` такой импорт не
 * компилируется вовсе (расхождение №11 в реестре PRINCIPLES.md). Вторая — enum
 * запрещён правилом ADR-004.
 *
 * Значения обязаны совпадать с рантаймом зависимости — это проверяет
 * `flags-conformance.test.ts`, иначе обновление версии тихо сломает граф.
 */
export const Flags = {
  None: 0,
  Mutable: 1,
  Watching: 2,
  RecursedCheck: 4,
  Recursed: 8,
  Dirty: 16,
  Pending: 32,
} as const

/**
 * Вид содержимого кэша, хранимый битами выше 32 — их субстрат не использует и не
 * затирает (`propagate`, `checkDirty` и `shallowPropagate` работают только с 1…32
 * и всегда через `|` либо `& ~`).
 *
 * Нужен, чтобы путь чтения не выяснял вид значения его ощупыванием. Проверка
 * «это промис?» вида `typeof value.then === 'function'` грузит свойство с
 * произвольного объекта, а в кэшах лежат объекты разных форм — то есть на самом
 * горячем пути получался мегаморфный доступ. Замер: чтение объектного значения
 * стоило 8.2 нс против 3.2 нс у числового, и ещё в 1.36 раза дороже при дюжине
 * форм. С тегом вид известен без обращения к значению.
 */
export const State = {
  Value: 0,
  Error: 64,
  Suspend: 128,
  Mask: 192,
} as const

/**
 * Общий интерфейс узлов графа.
 *
 * `kind` — дискриминант, а не `instanceof`: диспетчер `update` вызывается на каждом
 * пересчёте, и сравнение числа держит место вызова мономорфным независимо от того,
 * сколько классов узлов появится дальше.
 */
export interface Node extends ReactiveNode {
  readonly kind: 0 | 1
  update(): boolean
  refresh(): void
  dispose(): void
  disposed: boolean
  pinned: boolean
}

export const KIND_SIGNAL = 0
export const KIND_FIBER = 1

// ── Активный подписчик ───────────────────────────────────────────────────────
// Модульный глобал, а не поле контекста: это дисциплина стека вызовов, поэтому
// нескольким независимым графам в одном процессе он не мешает (ADR-010).
let activeSub: Node | undefined

export function getActiveSub(): Node | undefined {
  return activeSub
}

export function setActiveSub(next: Node | undefined): Node | undefined {
  const prev = activeSub
  activeSub = next
  return prev
}

/**
 * Тёплый ли режим. В холодном (`probe`) файберы ничего не считают и ни на что не
 * подписываются — отдают только то, что уже лежит в кэше. Нужен devtools, `stale`
 * и любому коду, которому надо заглянуть в граф, не изменив его.
 */
// Хранится числом, а не булевым: путь чтения подмешивает это значение к флагам узла
// и проверяет всё разом одним сравнением. Бит выбран заведомо не встречающийся среди
// настоящих флагов, чтобы сравнение гарантированно не совпало.
const COLD = 256
let cold = 0

export function coldBits(): number {
  return cold
}

export function isWarm(): boolean {
  return cold === 0
}

export function setWarm(next: boolean): boolean {
  const prev = cold === 0
  cold = next ? 0 : COLD
  return prev
}

// Версия прогона. `link()` использует её, чтобы отличить повторное чтение одной и
// той же зависимости внутри прогона от чтения на новой позиции.
let cycle = 0

export function nextCycle(): number {
  return ++cycle
}

export function currentCycle(): number {
  return cycle
}

// ── Планировщик ──────────────────────────────────────────────────────────────
const planning = new Set<Node>()
let reaping = new Set<Node>()
let scheduled = false
let batchDepth = 0

function schedule(): void {
  if (scheduled || batchDepth > 0) return
  scheduled = true
  queueMicrotask(() => {
    scheduled = false
    flush()
  })
}

export const { link, unlink, propagate, checkDirty, shallowPropagate } = createReactiveSystem({
  update(node) {
    return (node as Node).update()
  },
  notify(node) {
    planning.add(node as Node)
    schedule()
  },
  unwatched(node) {
    // Узел потерял последнего подписчика. Не убиваем сразу: в этом же тике его
    // могут прочитать снова (типичный случай — пересборка списка зависимостей).
    reaping.add(node as Node)
    schedule()
  },
})

/**
 * Прогнать граф синхронно: сначала пересчитать всё запланированное, затем собрать мусор.
 *
 * Экспортируется наружу намеренно — тесты и бенчмарки не должны зависеть от таймингов
 * микрозадач ([docs/10 §1](../../../docs/10-testing.md)).
 */
export function flush(): void {
  scheduled = false

  let guard = 0
  while (planning.size > 0 || reaping.size > 0) {
    // Пересчёт может добавить в очередь новые узлы, а сборка — освободить ещё узлы,
    // поэтому крутимся до неподвижной точки. Ограничитель ловит расходящиеся графы
    // в тестах, вместо того чтобы вешать процесс.
    if (++guard > 1000) throw new Error('flush: the graph does not converge within 1000 passes')

    for (const node of planning) {
      planning.delete(node)
      if (!node.disposed) node.refresh()
    }

    if (reaping.size > 0) {
      const batch = reaping
      reaping = new Set()
      for (const node of batch) {
        if (node.disposed || node.pinned) continue
        if (node.subs === undefined) node.dispose()
      }
    }
  }
}

/** Дождаться, пока граф досчитается — то же, что `nextTick` во Vue. */
export function nextTick(): Promise<void> {
  return Promise.resolve().then(() => {
    flush()
  })
}

/** Отложить прогон графа до конца `fn`. Вложенные вызовы схлопываются. */
export function batch<R>(fn: () => R): R {
  ++batchDepth
  try {
    return fn()
  } finally {
    if (--batchDepth === 0) flush()
  }
}

/** Разбудить подписчиков узла: пометить прямых грязными, транзитивных — сомневающимися. */
export function wake(node: Node): void {
  const subs = node.subs
  if (subs === undefined) return
  propagate(subs, false)
  shallowPropagate(subs)
  schedule()
}
