import { expect, test } from 'vitest'
import { act, async, computed, flush, isSuspend, sync } from '../index'

/**
 * Порт корпуса `mol/wire/fiber/fiber.test.ts` — взаимная вложенность синхронного и
 * асинхронного мира.
 *
 * Сценарий `Idempotence control` уже перенесён в `e2-task-reuse.test.ts` — здесь он
 * не дублируется.
 *
 * `@ $mol_wire_method` у нас — `act(fn)`; отличие в том, что обёртку надо сохранить в
 * переменную. У `$mol` идентичность даёт декоратор на прототипе, у нас — сама ссылка
 * на функцию (см. `getTask`).
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

/**
 * ПАДАЕТ — и это находка, а не расхождение по семантике записи.
 *
 * `act()`, вызванный вне файбера, отдаёт `undefined` вместо результата. Причина в
 * `Fiber.put()`: у одноразовой задачи после `done = true` идёт
 * `if (this.subs === undefined) this.dispose()`, а `dispose()` обнуляет `cache` и
 * `flags`. Внутри файбера подписчик есть — его создаёт `link()` в `readSlow()` ДО
 * пересчёта, — и всё работает; снаружи подписчика нет, задача убивает себя прямо в
 * `update()`, и `readSlow()` возвращает уже стёртый кэш.
 *
 * Задеть это должно ровно тот случай, ради которого `act` и существует: действие,
 * вызванное из обработчика события, то есть из императивного кода без активного
 * подписчика. В `$mol` `@ $mol_wire_method calc(1, 2)` снаружи возвращает 3.
 *
 * Тест оставлен падающим намеренно: чинить надо реализацию, а не ожидание.
 */
test('Sync execution: act outside a fiber just runs the body and returns the result', () => {
  const calc = act((a: number, b: number) => a + b)

  expect(calc(1, 2)).toBe(3)
})

test('async <=> sync: synchronous addition of two waits inside a promise', async () => {
  const val = (a: number): Promise<number> => Promise.resolve(a)

  const sum = (a: number, b: number): number => sync(val, a) + sync(val, b)

  expect(5 + (await async(() => sum(1, 2)))).toBe(8)
})

test('Error handling: a promise rejection arrives as an error, not a suspension', async () => {
  const failing = (a: number, b: number): Promise<number> =>
    Promise.reject(new Error(`test error ${a + b}`))

  const messages: string[] = []

  const check = computed(function check() {
    try {
      return sync(failing, 1, 2)
    } catch (error) {
      // Приостановку пропускаем наверх — её ловит рантайм, а не прикладной код.
      if (isSuspend(error)) throw error
      messages.push((error as Error).message)
      return -1
    }
  })

  let waiting = pump(() => check())
  while (waiting !== null) {
    await waiting
    flush()
    waiting = pump(() => check())
  }

  expect(check()).toBe(-1)
  expect(messages).toEqual(['test error 3'])
})

test('Error handling: an uncaught rejection reaches the async() promise', async () => {
  const failing = (): Promise<number> => Promise.reject(new Error('test error 3'))

  await expect(async(() => sync(failing))).rejects.toThrow('test error 3')
})
