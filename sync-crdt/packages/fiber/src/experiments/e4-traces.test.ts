import { afterEach, expect, test } from 'vitest'
import { computed, isSuspend, setSuspendTraces, sync } from '../index'

/**
 * Подмена стека у промиса приостановки: без неё настоящий стек обрывается на границе
 * промиса и отладить ожидание невозможно. Но захват кадров в `new Error()` стоил
 * 12.7 мкс из 14.7 мкс полного круга приостановки, поэтому по умолчанию выключено.
 */

afterEach(() => {
  setSuspendTraces(false)
})

function suspendOf(read: () => unknown): Promise<unknown> {
  try {
    read()
  } catch (error) {
    if (isSuspend(error)) return error
    throw error
  }
  throw new Error('expected a suspension')
}

test('Stack is not replaced by default', () => {
  const gate = new Promise<string>(() => {})
  const load = (): Promise<string> => gate
  const view = computed(function viewPlain() {
    return sync(load)
  })

  const suspend = suspendOf(() => view())
  expect((suspend as { stack?: string }).stack).toBeUndefined()
})

test('Enabled traces replace the stack and name the fiber', () => {
  setSuspendTraces(true)

  const gate = new Promise<string>(() => {})
  const load = (): Promise<string> => gate
  const view = computed(function viewTraced() {
    return sync(load)
  })

  const suspend = suspendOf(() => view())
  const stack = (suspend as { stack?: string }).stack

  expect(stack).toBeTypeOf('string')
  // Имя файбера в первой строке — по нему и опознаётся место ожидания.
  expect(stack).toContain('Suspend in')
  expect(stack).toContain('viewTraced')
})

test('Toggling does not break already created wrappers', async () => {
  setSuspendTraces(true)

  let release!: (value: string) => void
  const gate = new Promise<string>((resolve) => {
    release = resolve
  })
  const load = (): Promise<string> => gate
  const view = computed(function viewToggle() {
    return sync(load)
  })

  const suspend = suspendOf(() => view())
  setSuspendTraces(false)

  release('готово')
  await suspend

  expect(view()).toBe('готово')
})
