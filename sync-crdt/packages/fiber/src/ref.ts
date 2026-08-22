// v8:hot
import { equals } from './equals'
import {
  Flags,
  KIND_SIGNAL,
  currentCycle,
  getActiveSub,
  link,
  unlink,
  wake,
  type Link,
  type Node,
} from './graph'

/**
 * Узел записываемого источника.
 *
 * Никогда не помечается `Dirty`: запись сразу распространяется по подписчикам,
 * поэтому `update()` для него не нужен и всегда возвращает `false`. Это упрощает
 * `checkDirty` — дойдя до источника, он просто идёт дальше.
 */
export class RefNode<T> implements Node {
  readonly kind = KIND_SIGNAL

  deps: Link | undefined
  depsTail: Link | undefined
  subs: Link | undefined
  subsTail: Link | undefined
  flags: number

  value: T
  disposed: boolean
  pinned: boolean

  constructor(initial: T) {
    this.deps = undefined
    this.depsTail = undefined
    this.subs = undefined
    this.subsTail = undefined
    this.flags = Flags.Mutable
    this.value = initial
    this.disposed = false
    this.pinned = true // источники живут, пока их держит пользовательский код
  }

  get(): T {
    const sub = getActiveSub()
    if (sub !== undefined) link(this, sub, currentCycle())
    return this.value
  }

  set(next: T): void {
    // Структурно равная запись — не изменение: см. `equals`. Примитивы отсеиваются
    // до вызова — они и составляют большинство записей.
    const prev = this.value
    if (Object.is(prev, next)) return
    if (typeof next === 'object' && next !== null && equals(prev, next)) return
    this.value = next
    wake(this)
  }

  /** Готовое значение. Единообразно с `Fiber.result()`, чтобы `peek` не различал узлы. */
  result(): T {
    return this.value
  }

  update(): boolean {
    return false
  }

  refresh(): void {}

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    let sub = this.subs
    while (sub !== undefined) {
      const next = sub.nextSub
      unlink(sub)
      sub = next
    }
    this.flags = Flags.None
  }
}

/**
 * Записываемый источник — то же, что `ref` во Vue, но в канальной форме:
 * `count()` читает, `count(next)` пишет.
 */
export interface Ref<T> {
  (): T
  (next: T): T
  /** Записать явно. Нужен, когда записываемое значение — само `undefined`. */
  set(next: T): T
  /** Узел графа — для devtools, тестов и `peek`. */
  readonly node: RefNode<T>
}

/**
 * Создать записываемый источник.
 *
 * @example
 * ```ts
 * const count = ref(0)
 * count()      // 0
 * count(1)     // 1
 * ```
 *
 * **Отличие от `ref` во Vue — вызов вместо `.value`.** Значение читается и пишется
 * одной функцией: так чтение может приостановиться на асинхронном источнике, а
 * прикладной код не обрастает `.value` на каждом обращении. Ценой этого `undefined`
 * при записи трактуется как чтение — для явной записи есть {@link Ref.set}.
 */
export function ref<T>(initial: T): Ref<T> {
  const node = new RefNode(initial)
  // Присваивание, а не `Object.defineProperty`: см. комментарий в `computed.ts` —
  // определение свойства на функции стоит порядка 120 нс на создание.
  const channel = ((next?: T): T => {
    if (next === undefined) return node.get()
    node.set(next)
    return node.value
  }) as Ref<T> & { node: RefNode<T>; set: (next: T) => T }

  channel.node = node
  channel.set = (next: T) => {
    node.set(next)
    return node.value
  }
  return channel
}
