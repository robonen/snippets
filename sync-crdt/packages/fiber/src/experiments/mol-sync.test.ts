import { expect, expectTypeOf, test } from 'vitest'
import { act, async, computed, flush, isSuspend, sync } from '../index'

/**
 * Порт корпуса `mol/wire/sync/sync.test.ts` — превращение промиса в значение.
 *
 * У `$mol` это прокси над объектом: `$mol_wire_sync(obj).method(a)` перехватывает
 * вызов и подставляет задачу. У нас прокси нет, есть `sync(fn, ...args)` — та же
 * семантика, но идентичность задачи собирается из позиции, ссылки на функцию и
 * аргументов, поэтому **функция обязана быть стабильной ссылкой**. Прокси у `$mol`
 * эту дисциплину прячет: `obj.method` всегда одно и то же свойство одного и того же
 * хоста. Мы платим за отсутствие прокси явностью — и диагностикой расхождений
 * (`setTaskMismatchHandler`, см. `mol-keyed.test.ts`).
 *
 * Сценарий `test method from host` и `test function` слиты в один: у нас метод и
 * свободная функция — это буквально один и тот же путь, отдельного «хоста» в
 * публичном API нет.
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

test('test types: sync разворачивает Promise<T> в T', () => {
  const load = (): Promise<string> => Promise.resolve('')
  const read = () => sync(load)

  // Тип проверяется компилятором (`pnpm typecheck`), вызов здесь не выполняется:
  // `sync` вне файбера приостановился бы.
  expectTypeOf<ReturnType<typeof read>>().toEqualTypeOf<string>()
  expect(typeof read).toBe('function')
})

test('sync внутри async: значение доезжает, источник дёрнут ровно один раз', async () => {
  let count = 0
  const load = (): Promise<number> => Promise.resolve(++count)

  expect(await async(() => sync(load))).toBe(1)
  // Перезапуск после разрешения промиса переиспользует задачу, а не зовёт заново.
  expect(count).toBe(1)
})

test('sync с аргументами: разные аргументы — разные задачи', async () => {
  const calls: number[] = []
  const load = (value: number): Promise<number> => {
    calls.push(value)
    return Promise.resolve(value * 10)
  }

  const both = computed(function both() {
    return [sync(load, 1), sync(load, 2)]
  })

  let waiting = pump(() => both())
  while (waiting !== null) {
    await waiting
    flush()
    waiting = pump(() => both())
  }

  expect(both()).toEqual([10, 20])
  expect(calls).toEqual([1, 2])
})

test('test construct itself: созданный объект переживает перезапуск файбера', async () => {
  class Widget {}

  const instances: Widget[] = []
  const build = act(() => new Widget())

  const gate = Promise.resolve()
  const wait = (): Promise<void> => gate

  await async(() => {
    // `push` не идемпотентен и выполняется на каждом прогоне, а `build()` — задача,
    // и её результат берётся готовым. Ровно это и проверял оригинал.
    instances.push(build())
    sync(wait)
  })

  expect(instances.length).toBe(2)
  expect(instances[0] instanceof Widget).toBe(true)
  expect(instances[0]).toBe(instances[1])
})
