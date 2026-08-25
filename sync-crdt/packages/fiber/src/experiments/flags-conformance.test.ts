import { expect, test } from 'vitest'
import { Flags } from '../graph'

/**
 * Наши флаги обязаны совпадать со значениями в рантайме `alien-signals/system`.
 *
 * Импортировать их напрямую нельзя: в поставке они описаны как `declare const enum`,
 * что несовместимо с `verbatimModuleSyntax`, хотя собираются как обычный объект.
 * Поэтому значения продублированы у нас, а этот тест сторожит расхождение при
 * обновлении версии — молча разъехавшиеся флаги сломали бы граф самым неотлаживаемым
 * образом.
 */
test('Flags match the alien-signals/system runtime', async () => {
  const module = (await import('alien-signals/system')) as unknown as {
    ReactiveFlags: Record<string, number>
  }
  const runtime = module.ReactiveFlags

  expect(runtime).toBeTypeOf('object')
  for (const [name, value] of Object.entries(Flags)) {
    expect(runtime[name], `флаг ${name}`).toBe(value)
  }
  expect(Object.keys(runtime).sort()).toEqual(Object.keys(Flags).sort())
})
