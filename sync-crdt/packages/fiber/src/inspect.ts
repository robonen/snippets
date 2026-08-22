import { Fiber, isSuspend } from './fiber'
import { Flags, KIND_FIBER, State, type Link, type Node } from './graph'
import { RefNode } from './ref'

/**
 * Инспектор графа: что чего ждёт и почему пересчиталось.
 *
 * Файберная модель платит за синхронное чтение тем, что настоящий стек обрывается
 * на границе промиса. «Загрузка висит» — самая частая жалоба, и без инструмента на
 * неё нечего ответить: неизвестно даже, какой именно узел ждёт и чего.
 *
 * Весь модуль читает граф и ничего в нём не меняет: обход идёт по уже собранным
 * рёбрам, чтения каналов не происходит, подписки не заводятся. Поэтому инспектор
 * безопасно звать из отладчика посреди приостановки.
 */

/** Состояние узла одним словом. */
export type NodeState = 'value' | 'error' | 'pending' | 'cold'

export interface NodeSnapshot {
  id: string
  kind: 'computed' | 'task' | 'source'
  state: NodeState
  /** Расшифрованные флаги — читать биты глазами невозможно. */
  flags: readonly string[]
  value?: unknown
  error?: string
  /** Сколько подписчиков. Ноль у живого узла означает, что он вот-вот будет собран. */
  subs: number
  pinned: boolean
  disposed: boolean
  deps: readonly NodeSnapshot[]
  /** Обход остановлен из-за предела глубины или из-за цикла. */
  truncated?: 'depth' | 'cycle'
}

const FLAG_NAMES: readonly (readonly [number, string])[] = [
  [Flags.Mutable, 'mutable'],
  [Flags.Watching, 'watching'],
  [Flags.RecursedCheck, 'recursing'],
  [Flags.Recursed, 'recursed'],
  [Flags.Dirty, 'dirty'],
  [Flags.Pending, 'pending'],
]

function decodeFlags(flags: number): readonly string[] {
  const out: string[] = []
  for (const [bit, name] of FLAG_NAMES) {
    if ((flags & bit) !== 0) out.push(name)
  }
  const state = flags & State.Mask
  if (state === State.Error) out.push('cache:error')
  else if (state === State.Suspend) out.push('cache:suspend')
  return out
}

function stateOf(node: Node): NodeState {
  if (node.kind !== KIND_FIBER) return 'value'
  const fiber = node as Fiber
  if ((fiber.flags & Flags.Mutable) === 0) return 'cold'
  const state = fiber.flags & State.Mask
  if (state === State.Suspend) return 'pending'
  if (state === State.Error) return 'error'
  return 'value'
}

function idOf(node: Node): string {
  if (node.kind === KIND_FIBER) return (node as Fiber).id
  return 'ref'
}

function countSubs(node: Node): number {
  let count = 0
  for (let link: Link | undefined = node.subs; link !== undefined; link = link.nextSub) count++
  return count
}

/** Узел за каналом. Принимает и сам узел, и канал `ref`/`computed`. */
function nodeOf(target: Node | { readonly node: Node }): Node {
  return 'node' in target ? target.node : target
}

export interface InspectOptions {
  /** Насколько глубоко разворачивать зависимости. По умолчанию 8. */
  depth?: number
  /** Включать ли значения в снимок. Выключено по умолчанию: значения бывают тяжёлыми. */
  values?: boolean
}

/**
 * Снимок узла и его зависимостей.
 *
 * @example
 * ```ts
 * console.dir(inspect(view), { depth: null })
 * ```
 */
export function inspect(
  target: Node | { readonly node: Node },
  options: InspectOptions = {},
): NodeSnapshot {
  const depth = options.depth ?? 8
  const values = options.values ?? false
  return snapshot(nodeOf(target), depth, values, new Set())
}

function snapshot(node: Node, depth: number, values: boolean, seen: Set<Node>): NodeSnapshot {
  const isFiber = node.kind === KIND_FIBER
  const fiber = isFiber ? (node as Fiber) : undefined

  const out: NodeSnapshot = {
    id: idOf(node),
    kind: fiber === undefined ? 'source' : fiber.temp ? 'task' : 'computed',
    state: stateOf(node),
    flags: decodeFlags(node.flags),
    subs: countSubs(node),
    pinned: node.pinned,
    disposed: node.disposed,
    deps: [],
  }

  if (values) {
    if (fiber === undefined) out.value = (node as RefNode<unknown>).value
    else if (out.state === 'value') out.value = fiber.cache
  }
  if (fiber !== undefined && out.state === 'error') {
    out.error = fiber.cache instanceof Error ? fiber.cache.message : String(fiber.cache)
  }

  // Цикл в графе зависимостей рантайм не допускает, но снимок могут снимать в
  // середине пересчёта, когда рёбра ещё не приведены в порядок.
  if (seen.has(node)) {
    out.truncated = 'cycle'
    return out
  }
  if (depth <= 0) {
    out.truncated = 'depth'
    return out
  }

  seen.add(node)
  const deps: NodeSnapshot[] = []
  for (let link: Link | undefined = node.deps; link !== undefined; link = link.nextDep) {
    deps.push(snapshot(link.dep as Node, depth - 1, values, seen))
  }
  seen.delete(node)

  out.deps = deps
  return out
}

/**
 * Цепочка от узла до того, чьё ожидание его держит.
 *
 * Отвечает на вопрос «почему висит»: последний элемент — та самая одноразовая
 * задача, которая ждёт промиса, а перед ней путь, по которому ожидание поднялось
 * наверх. Пустой массив означает, что узел не приостановлен.
 */
export function waitingOn(target: Node | { readonly node: Node }): readonly NodeSnapshot[] {
  const chain: NodeSnapshot[] = []
  const seen = new Set<Node>()
  let node = nodeOf(target)

  while (node.kind === KIND_FIBER && !seen.has(node)) {
    const fiber = node as Fiber
    if ((fiber.flags & State.Suspend) === 0) break

    seen.add(node)
    chain.push(snapshot(node, 0, false, new Set()))

    // Спускаемся к первой приостановленной зависимости: именно она держит этот узел.
    let next: Node | undefined
    for (let link: Link | undefined = node.deps; link !== undefined; link = link.nextDep) {
      const dep = link.dep as Node
      if (dep.kind === KIND_FIBER && ((dep as Fiber).flags & State.Suspend) !== 0) {
        next = dep
        break
      }
    }
    if (next === undefined) break
    node = next
  }

  return chain
}

/** Промис, которого ждёт узел, если ждёт. Для отладчика: у него подменён стек. */
export function pendingPromise(
  target: Node | { readonly node: Node },
): Promise<unknown> | undefined {
  const node = nodeOf(target)
  if (node.kind !== KIND_FIBER) return undefined
  const cache = (node as Fiber).cache
  return isSuspend(cache) ? cache : undefined
}

const MARKS: Readonly<Record<NodeState, string>> = {
  value: '●',
  pending: '◌',
  error: '✕',
  cold: '○',
}

/**
 * Дерево графа текстом — для консоли и для вставки в отчёт об ошибке.
 *
 * @example
 * ```
 * ● view()
 *   ├ ● ref
 *   └ ◌ load<#>   ждёт
 * ```
 */
export function formatGraph(
  target: Node | { readonly node: Node },
  options: InspectOptions = {},
): string {
  const lines: string[] = []
  const render = (snap: NodeSnapshot, prefix: string, last: boolean, root: boolean): void => {
    const branch = root ? '' : last ? '└ ' : '├ '
    const note =
      snap.state === 'pending'
        ? '  ждёт'
        : snap.state === 'error'
          ? `  ошибка: ${snap.error ?? ''}`
          : snap.truncated === 'depth'
            ? '  …'
            : snap.truncated === 'cycle'
              ? '  ⟲'
              : ''
    lines.push(`${prefix}${branch}${MARKS[snap.state]} ${snap.id}${note}`)

    const inner = root ? '' : prefix + (last ? '  ' : '│ ')
    snap.deps.forEach((dep, index) => {
      render(dep, inner, index === snap.deps.length - 1, false)
    })
  }
  render(inspect(target, options), '', true, true)
  return lines.join('\n')
}
