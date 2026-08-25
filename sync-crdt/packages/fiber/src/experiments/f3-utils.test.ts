import { expect, test, vi } from 'vitest'
import {
  async,
  computed,
  flush,
  isSuspend,
  pin,
  probe,
  race,
  ref,
  stale,
  sync,
  untracked,
  watchEffect,
} from '../index'

function pump(read: () => unknown): Promise<unknown> | null {
  try {
    read()
    return null
  } catch (error) {
    if (isSuspend(error)) return error
    throw error
  }
}

test('probe: neither computes nor subscribes', () => {
  let runs = 0
  const source = ref(1)
  const view = computed(function view() {
    runs++
    return source() * 2
  })

  // Холодное чтение непосчитанного узла даёт undefined и ничего не запускает.
  expect(probe(() => view())).toBeUndefined()
  expect(runs).toBe(0)

  expect(view()).toBe(2)
  expect(runs).toBe(1)

  // Тёплое значение читается, но подписки не заводится.
  let watcherRuns = 0
  const stop = watchEffect(() => {
    watcherRuns++
    probe(() => view())
  })
  expect(watcherRuns).toBe(1)

  source(5)
  flush()
  expect(watcherRuns).toBe(1)

  stop()
})

test('probe: a suspended node yields undefined instead of throwing', () => {
  const gate = new Promise<string>(() => {})
  const load = (): Promise<string> => gate
  const view = computed(function view() {
    return sync(load)
  })

  expect(pump(() => view())).not.toBeNull()
  expect(probe(() => view())).toBeUndefined()
})

test('stale: the fiber yields its previous value while the new one loads', async () => {
  const page = ref(0)
  let release!: (value: string) => void
  let gate = new Promise<string>((resolve) => {
    release = resolve
  })
  const load = (): Promise<string> => gate

  // stale() внутри файбера: пока грузится новая страница, отдаём прежнюю.
  const view = computed(function view() {
    page()
    return stale(() => sync(load)) ?? 'пусто'
  })

  expect(view()).toBe('пусто')

  release('страница 0')
  await gate
  flush()
  expect(view()).toBe('страница 0')

  // Новая страница ещё не приехала — старая остаётся на экране.
  gate = new Promise<string>((resolve) => {
    release = resolve
  })
  page(1)
  flush()
  expect(view()).toBe('страница 0')

  release('страница 1')
  await gate
  flush()
  expect(view()).toBe('страница 1')
})

test('race: independent waits run in parallel', async () => {
  const releases: Array<(value: number) => void> = []
  const gates = [0, 1].map(
    (i) =>
      new Promise<number>((resolve) => {
        releases[i] = resolve
      }),
  )
  const loadFirst = (): Promise<number> => gates[0]!
  const loadSecond = (): Promise<number> => gates[1]!

  let runs = 0
  const view = computed(function view() {
    runs++
    const [a, b] = race(
      () => sync(loadFirst),
      () => sync(loadSecond),
    )
    return a + b
  })

  expect(pump(() => view())).not.toBeNull()
  // Оба ожидания стартовали на первом же прогоне — в этом весь смысл.
  expect(runs).toBe(1)

  releases[0]!(2)
  releases[1]!(3)
  await Promise.all(gates)
  flush()

  const again = pump(() => view())
  if (again !== null) await again
  flush()
  expect(view()).toBe(5)
})

test('race: without it waits are sequential', async () => {
  const releases: Array<(value: number) => void> = []
  const gates = [0, 1].map(
    (i) =>
      new Promise<number>((resolve) => {
        releases[i] = resolve
      }),
  )
  const loadFirst = (): Promise<number> => gates[0]!
  const loadSecond = (): Promise<number> => gates[1]!

  let secondStarted = false
  const view = computed(function view() {
    const a = sync(loadFirst)
    secondStarted = true
    const b = sync(loadSecond)
    return a + b
  })

  expect(pump(() => view())).not.toBeNull()
  // До второй загрузки дело не дошло: первая бросила промис.
  expect(secondStarted).toBe(false)
})

test('untracked: reads the value without creating a dependency', () => {
  const tracked = ref(1)
  const hidden = ref(10)

  let runs = 0
  const view = computed(function view() {
    runs++
    return tracked() + untracked(() => hidden())
  })

  expect(view()).toBe(11)
  expect(runs).toBe(1)

  hidden(20)
  flush()
  expect(view()).toBe(11)
  expect(runs).toBe(1)

  tracked(2)
  flush()
  expect(view()).toBe(22)
  expect(runs).toBe(2)
})

test('pin: the node survives losing its subscribers', () => {
  const on = ref(true)

  const pinned = computed(function pinned() {
    pin()
    return 1
  })
  const plain = computed(function plain() {
    return 2
  })

  const stop = watchEffect(() => {
    if (on()) {
      pinned()
      plain()
    }
  })

  on(false)
  flush()

  expect(plain.node.disposed).toBe(true)
  expect(pinned.node.disposed).toBe(false)

  stop()
})

test('async: exposes a fiber computation as a promise', async () => {
  let release!: (value: string) => void
  const gate = new Promise<string>((resolve) => {
    release = resolve
  })
  const load = (): Promise<string> => gate

  const view = computed(function view() {
    return `значение: ${sync(load)}`
  })

  const promise = async(() => view())
  release('готово')

  await expect(promise).resolves.toBe('значение: готово')
})

test('async: an inner error becomes a promise rejection', async () => {
  const boom = computed(function boom(): number {
    throw new Error('boom')
  })

  await expect(async(() => boom())).rejects.toThrow('boom')
})

test('async: leaves no watcher behind after resolution', async () => {
  const source = ref(1)
  const view = computed(function view() {
    return source() * 2
  })

  expect(await async(() => view())).toBe(2)

  const runs = vi.fn()
  const stop = watchEffect(() => {
    runs()
    view()
  })
  runs.mockClear()

  source(2)
  flush()
  // Ровно один наблюдатель — тот, что завели здесь. Если бы `async` не убрал свой,
  // пересчётов было бы больше.
  expect(runs).toHaveBeenCalledTimes(1)
  stop()
})
