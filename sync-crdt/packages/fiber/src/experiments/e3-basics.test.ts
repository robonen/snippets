import { expect, test } from 'vitest'
import { computed, flush, isSuspend, ref, sync, watchEffect } from '../index'
import { getActiveSub } from '../graph'

/** Базовые свойства рантайма, без которых эксперименты E1/E2 ничего не значат. */

function pump(read: () => unknown): Promise<unknown> | null {
  try {
    read()
    return null
  } catch (error) {
    if (isSuspend(error)) return error
    throw error
  }
}

test('ошибка кэшируется как значение и не пересчитывается на каждом чтении', () => {
  let runs = 0
  const boom = computed(function boom() {
    runs++
    throw new Error('bang')
  })

  expect(() => boom()).toThrow('bang')
  expect(() => boom()).toThrow('bang')
  expect(runs).toBe(1)
})

test('activeSub восстанавливается после обычного исключения', () => {
  const boom = computed(function boom(): number {
    throw new Error('x')
  })

  expect(getActiveSub()).toBeUndefined()
  expect(() => boom()).toThrow()
  expect(getActiveSub()).toBeUndefined()
})

test('activeSub восстанавливается после приостановки', () => {
  const gate = new Promise<string>(() => {})
  const load = (): Promise<string> => gate
  const view = computed(function view() {
    return sync(load)
  })

  expect(pump(() => view())).not.toBeNull()
  expect(getActiveSub()).toBeUndefined()
})

test('ромб: корень пересчитывается ровно один раз на изменение источника', () => {
  const source = ref(1)
  const left = computed(function left() {
    return source() * 2
  })
  const right = computed(function right() {
    return source() * 3
  })

  let rootRuns = 0
  const root = computed(function root() {
    rootRuns++
    return left() + right()
  })

  expect(root()).toBe(5)
  expect(rootRuns).toBe(1)

  source(2)
  flush()
  expect(root()).toBe(10)
  expect(rootRuns).toBe(2)
})

test('значение не изменилось — подписчик не пересчитывается', () => {
  const source = ref(1)
  const parity = computed(function parity() {
    return source() % 2
  })

  let runs = 0
  const view = computed(function view() {
    runs++
    return parity()
  })

  expect(view()).toBe(1)
  expect(runs).toBe(1)

  // 1 → 3: источник другой, но чётность та же, значит будить некого.
  source(3)
  flush()
  expect(view()).toBe(1)
  expect(runs).toBe(1)

  source(2)
  flush()
  expect(view()).toBe(0)
  expect(runs).toBe(2)
})

test('переставшая читаться зависимость отписывается и собирается', () => {
  const on = ref(true)
  const inner = computed(function inner() {
    return 42
  })

  const stop = watchEffect(() => {
    if (on()) inner()
  })

  expect(inner.node.subs).not.toBeUndefined()
  expect(inner.node.disposed).toBe(false)

  on(false)
  flush()

  expect(inner.node.subs).toBeUndefined()
  expect(inner.node.disposed).toBe(true)

  stop()
})

test('наблюдатель перезапускается после разрешения приостановки', async () => {
  let seen: string | null = null
  let release!: (value: string) => void
  const gate = new Promise<string>((resolve) => {
    release = resolve
  })
  const load = (): Promise<string> => gate

  const stop = watchEffect(() => {
    seen = sync(load)
  })

  expect(seen).toBeNull()

  release('ready')
  await gate
  await Promise.resolve()
  flush()

  expect(seen).toBe('ready')
  stop()
})

test('подписчик узнаёт о переходе «значение → ожидание»', async () => {
  const page = ref(0)
  let release!: (value: string) => void
  let gate = new Promise<string>((resolve) => {
    release = resolve
  })
  const load = (): Promise<string> => gate

  const view = computed(function view() {
    page()
    return sync(load)
  })

  // Наблюдатель фиксирует, что видел на каждом прогоне.
  const seen: Array<'value' | 'pending'> = []
  const stop = watchEffect(() => {
    try {
      view()
      seen.push('value')
    } catch (error) {
      if (!isSuspend(error)) throw error
      seen.push('pending')
      throw error
    }
  })

  expect(seen).toEqual(['pending'])

  release('первая')
  await gate
  flush()
  expect(seen).toEqual(['pending', 'value'])

  // Инвалидация запускает новую загрузку. Наблюдатель обязан снова увидеть
  // ожидание: без этого мост в UI не смог бы показать загрузку, а `checkDirty`
  // решил бы, что пересчитывать нечего.
  gate = new Promise<string>((resolve) => {
    release = resolve
  })
  page(1)
  flush()
  expect(seen).toEqual(['pending', 'value', 'pending'])

  release('вторая')
  await gate
  flush()
  expect(seen).toEqual(['pending', 'value', 'pending', 'value'])

  stop()
})
