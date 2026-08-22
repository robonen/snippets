import { expect, test } from 'vitest'
import { act, computed, flush, isSuspend, probe, ref, sync, watchEffect } from '../index'

/**
 * Порт корпуса `mol/wire/solo/solo.test.ts` — гейт корректности S1.
 *
 * Это не копия: у `$mol` каналы объявляются декораторами на классах, у нас —
 * функциями. Переносится **семантика**, а не форма. Ценность в том, что корпус
 * написан не нами и не из наших предположений: мост в Vue уже показал, что своя
 * оптика целый класс ошибок не видит.
 *
 * Ссылки на исходные сценарии — в именах тестов.
 */

function pump(read: () => unknown): Promise<unknown> | null {
  try {
    read()
    return null
  } catch (error) {
    if (isSuspend(error)) return error
    throw error
  }
}

test('Cached channel: запись меняет значение, чтение его отдаёт', () => {
  const stored = ref(1)
  const value = computed({
    get: () => stored() + 1,
    set: (next: number) => stored(next),
  })

  expect(value()).toBe(2)
  value(2)
  flush()
  expect(value()).toBe(3)
})

test('Skip recalculation: зависимость пересчиталась, значение то же — потребитель молчит', () => {
  const log: string[] = []

  const xxx = ref(1)
  const yyy = computed(function yyy() {
    log.push('yyy')
    return [Math.sign(xxx())]
  })
  const zzz = computed(function zzz() {
    log.push('zzz')
    return yyy()[0]! + 1
  })

  zzz()
  expect(log).toEqual(['zzz', 'yyy'])

  // 1 → 5: знак не изменился, но массив пересобран. Потребитель `zzz` пересчитываться
  // не должен — иначе любое переупорядочивание списка будило бы весь экран.
  xxx(5)
  flush()
  zzz()
  expect(log).toEqual(['zzz', 'yyy', 'yyy'])
})

test('Dupes: Equality — запись структурно равного значения никого не будит', () => {
  let counter = 0

  const foo = ref<{ numbs: number[] }>({ numbs: [1] })
  const bar = computed(function bar() {
    return { ...foo(), count: ++counter }
  })

  expect(bar()).toEqual({ numbs: [1], count: 1 })

  foo({ numbs: [1] })
  flush()
  expect(bar()).toEqual({ numbs: [1], count: 1 })

  foo({ numbs: [2] })
  flush()
  expect(bar()).toEqual({ numbs: [2], count: 2 })
})

test('Flow: Auto — набор зависимостей меняется вместе с условием', () => {
  const source = ref(1)
  const condition = ref(true)
  let counter = 0

  const result = computed(function result() {
    const res = condition() ? source() : 0
    return res + counter++
  })

  expect(result()).toBe(1)
  expect(counter).toBe(1)

  source(10)
  flush()
  expect(result()).toBe(11)
  expect(counter).toBe(2)

  condition(false)
  flush()
  expect(result()).toBe(2)
  expect(counter).toBe(3)

  // Ветка отключена — источник больше не зависимость, его изменение ничего не будит.
  source(20)
  flush()
  expect(result()).toBe(2)
  expect(counter).toBe(3)

  condition(true)
  flush()
  expect(result()).toBe(23)
  expect(counter).toBe(4)
})

test('Cycle: Fail — круговая подписка распознаётся, а не вешает процесс', () => {
  const foo: { (): number } = computed(function foo(): number {
    return bar() + 1
  })
  const bar: { (): number } = computed(function bar(): number {
    return foo() + 1
  })

  expect(() => foo()).toThrow(/Circular|цикл/i)
})

test('Actions inside invariant: запись в зависимость из тела вычисления', () => {
  const count = ref(0)
  const count2 = computed(function count2() {
    return count()
  })
  const res = computed(function res() {
    const value = count2()
    if (value === 0) count(value + 1)
    return value + 1
  })

  expect(res()).toBe(1)

  count(5)
  flush()
  expect(res()).toBe(6)
})

test('Restore after error: после снятия причины значение возвращается', () => {
  const condition = ref(false)
  const broken = computed(function broken() {
    if (condition()) throw new Error('test error')
    return 1
  })
  const result = computed(function result() {
    return broken()
  })

  expect(result()).toBe(1)

  condition(true)
  flush()
  expect(() => result()).toThrow('test error')

  condition(false)
  flush()
  expect(result()).toBe(1)
})

test('Wait for data: цепочка через асинхронный источник', async () => {
  const source = async (): Promise<string> => 'Jin'
  const middle = computed(function middle() {
    return sync(source)
  })
  const target = computed(function target() {
    return middle()
  })

  const waiting = pump(() => target())
  if (waiting !== null) await waiting
  flush()
  expect(target()).toBe('Jin')
})

test('Auto destroy on long alone: узел без читателей собирается, с читателями — нет', () => {
  const showing = ref(true)
  const details = computed(function details() {
    return { id: 'детали' }
  })
  const render = computed(function render() {
    return showing() ? details() : null
  })

  const stop = watchEffect(() => {
    render()
  })

  const first = render()
  expect(first).not.toBeNull()

  showing(false)
  flush()
  expect(render()).toBeNull()
  // Никто больше не читает `details` — сборщик графа его забрал.
  expect(details.node.disposed).toBe(true)

  showing(true)
  flush()
  // Пересоздан: это уже другое вычисление, а не воскрешённое старое.
  expect(render()).not.toBeNull()
  expect(render()).not.toBe(first)

  stop()
})

test('Hold pubs while wait async task: зависимости переживают ожидание', async () => {
  const resets = ref(0)
  let counter = 0
  const wait = async (): Promise<void> => {}

  const value = computed(function value() {
    return ++counter
  })
  const result = computed(function result() {
    if (resets() > 0) sync(wait)
    return value()
  })

  expect(result()).toBe(1)

  resets(1)
  flush()
  const waiting = pump(() => result())
  if (waiting !== null) await waiting
  flush()

  // `value` не пересчитывался: ожидание не должно ронять уже собранные зависимости.
  expect(result()).toBe(1)
})

test('Unsubscribe from temp pubs on complete: одноразовая задача не переживает коммит', () => {
  let seeds = 0
  const seed = act(() => ++seeds)

  const resets = ref(0)
  const value = computed(function value() {
    resets()
    return seed()
  })

  const first = value()
  expect(first).toBe(1)

  // Новое логическое вычисление — задача выполняется заново.
  resets(1)
  flush()
  expect(value()).toBe(2)
})

test('probe: холодное чтение не меняет граф (аналог $mol_wire_probe)', () => {
  let runs = 0
  const source = ref(1)
  const value = computed(function value() {
    runs++
    return source()
  })

  expect(probe(() => value())).toBeUndefined()
  expect(runs).toBe(0)

  expect(value()).toBe(1)
  expect(probe(() => value())).toBe(1)
  expect(runs).toBe(1)
})
