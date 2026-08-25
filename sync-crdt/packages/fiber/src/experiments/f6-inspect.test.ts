import { expect, test } from 'vitest'
import { computed, flush, isSuspend, ref, sync, watchEffect } from '../index'
// Инспектор — отдельная точка входа (`@sync/fiber/inspect`): отладочный инструмент
// не должен ехать в прод-сборку. Он добавлял 1.1 КБ к бандлу при бюджете 4 КБ.
import { formatGraph, inspect, pendingPromise, waitingOn } from '../inspect'

function pump(read: () => unknown): Promise<unknown> | null {
  try {
    read()
    return null
  } catch (error) {
    if (isSuspend(error)) return error
    throw error
  }
}

test('Snapshot shows state and dependencies', () => {
  const count = ref(2)
  const double = computed(function double() {
    return count() * 2
  })
  double()

  const snap = inspect(double)
  expect(snap.kind).toBe('computed')
  expect(snap.state).toBe('value')
  expect(snap.flags).toContain('mutable')
  expect(snap.deps).toHaveLength(1)
  expect(snap.deps[0]?.kind).toBe('source')
})

test('Uncomputed node shows as cold, not as empty', () => {
  const lazy = computed(function lazy() {
    return 1
  })

  // Отличать «ещё не считался» от «посчитался в undefined» важно: иначе отладка
  // ленивого графа превращается в гадание.
  expect(inspect(lazy).state).toBe('cold')
  lazy()
  expect(inspect(lazy).state).toBe('value')
})

test('Error is visible along with its message', () => {
  const boom = computed(function boom(): number {
    throw new Error('boom')
  })
  expect(() => boom()).toThrow()

  const snap = inspect(boom)
  expect(snap.state).toBe('error')
  expect(snap.error).toBe('boom')
  expect(snap.flags).toContain('cache:error')
})

test('waitingOn shows exactly who holds the wait', () => {
  const gate = new Promise<string>(() => {})
  const load = (): Promise<string> => gate

  const inner = computed(function inner() {
    return sync(load)
  })
  const outer = computed(function outer() {
    return inner()
  })

  expect(pump(() => outer())).not.toBeNull()

  const chain = waitingOn(outer)
  // Цепочка ведёт от корня к той самой одноразовой задаче, которая ждёт промиса.
  expect(chain.length).toBeGreaterThanOrEqual(2)
  expect(chain[0]?.id).toContain('outer')
  expect(chain.at(-1)?.kind).toBe('task')
  expect(chain.every((node) => node.state === 'pending')).toBe(true)
})

test('waitingOn is empty when nothing is waiting', () => {
  const value = computed(function value() {
    return 1
  })
  value()
  expect(waitingOn(value)).toEqual([])
})

test('Pending promise is retrievable for the debugger', async () => {
  let release!: (value: string) => void
  const gate = new Promise<string>((resolve) => {
    release = resolve
  })
  const load = (): Promise<string> => gate

  const view = computed(function view() {
    return sync(load)
  })
  expect(pump(() => view())).not.toBeNull()

  const waiting = pendingPromise(view)
  expect(waiting).toBeInstanceOf(Promise)

  release('готово')
  await waiting
  flush()
  expect(view()).toBe('готово')
  expect(pendingPromise(view)).toBeUndefined()
})

test('Text tree is readable by eye', () => {
  const gate = new Promise<string>(() => {})
  const load = (): Promise<string> => gate
  const flag = ref(true)

  const view = computed(function view() {
    flag()
    return sync(load)
  })
  pump(() => view())

  const text = formatGraph(view)
  expect(text).toContain('view()')
  expect(text).toContain('ждёт')
  // Источник и задача — разные строки дерева.
  expect(text.split('\n').length).toBeGreaterThanOrEqual(3)
})

test('Traversal does not loop and respects the depth limit', () => {
  const source = ref(0)
  let node = computed(function level() {
    return source()
  })
  for (let i = 0; i < 20; i++) {
    const prev = node
    node = computed(function level() {
      return prev() + 1
    })
  }
  node()

  const snap = inspect(node, { depth: 3 })
  let cursor = snap
  let levels = 0
  while (cursor.deps.length > 0) {
    cursor = cursor.deps[0] as typeof snap
    levels++
  }
  expect(levels).toBe(3)
  expect(cursor.truncated).toBe('depth')
})

test('Inspection changes nothing in the graph', () => {
  const source = ref(1)
  let runs = 0
  const view = computed(function view() {
    runs++
    return source()
  })

  let watcherRuns = 0
  const stop = watchEffect(() => {
    watcherRuns++
    view()
  })
  expect(runs).toBe(1)
  expect(watcherRuns).toBe(1)

  // Снимок и текстовое дерево не читают каналы, не подписываются и не считают.
  inspect(view, { values: true })
  formatGraph(view)
  waitingOn(view)
  flush()

  expect(runs).toBe(1)
  expect(watcherRuns).toBe(1)

  stop()
})

test('Values do not enter the snapshot without an explicit request', () => {
  const heavy = computed(function heavy() {
    return { payload: 'много данных' }
  })
  heavy()

  expect(inspect(heavy).value).toBeUndefined()
  expect(inspect(heavy, { values: true }).value).toEqual({ payload: 'много данных' })
})
