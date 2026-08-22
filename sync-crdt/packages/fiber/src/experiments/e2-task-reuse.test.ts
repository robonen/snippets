import { expect, test } from 'vitest'
import { act, computed, flush, isSuspend, setTaskMismatchHandler, ref, sync } from '../index'

/**
 * E2 — вторая гипотеза ADR-003.
 *
 * Побочный эффект, обёрнутый в `act()`, выполняется РОВНО ОДИН РАЗ, сколько бы раз
 * файбер ни перезапускался из-за приостановок.
 *
 * Эталон — тест `Idempotence control` из `$mol_wire` (mol/wire/fiber/fiber.test.ts):
 * там счётчик под `@ $mol_wire_method` равен 1, а без обёртки — 3.
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

test('E2: act() выполняется один раз, обычный вызов — на каждом прогоне', async () => {
  let idempotent = 0
  let plain = 0
  let runs = 0

  // Обёртка сохраняется в переменную: позиционное опознание сверяет саму функцию,
  // а `act(() => …)` внутри тела создавал бы новую стрелку на каждом прогоне.
  const bump = act(() => {
    idempotent++
  })

  let releaseFirst!: (value: number) => void
  let releaseSecond!: (value: number) => void
  const first = new Promise<number>((resolve) => {
    releaseFirst = resolve
  })
  const second = new Promise<number>((resolve) => {
    releaseSecond = resolve
  })
  const loadFirst = (): Promise<number> => first
  const loadSecond = (): Promise<number> => second

  const sum = computed(function sum() {
    runs++
    bump()
    plain++
    const left = sync(loadFirst)
    const right = sync(loadSecond)
    return left + right
  })

  const wait1 = pump(() => sum())
  expect(wait1).not.toBeNull()
  expect(runs).toBe(1)
  expect(idempotent).toBe(1)

  releaseFirst(2)
  await wait1
  flush()

  const wait2 = pump(() => sum())
  expect(wait2).not.toBeNull()
  expect(runs).toBe(2)

  releaseSecond(3)
  await wait2
  flush()

  expect(sum()).toBe(5)

  expect(runs).toBe(3)
  expect(plain).toBe(3)
  // Ради этой строки всё и делалось.
  expect(idempotent).toBe(1)
})

test('E2: sync() не перезапускает уже выполненную асинхронную операцию', async () => {
  let calls = 0

  let release!: (value: string) => void
  const gate = new Promise<string>((resolve) => {
    release = resolve
  })
  const load = (): Promise<string> => {
    calls++
    return gate
  }

  const tick = ref(0)
  const view = computed(function view() {
    const value = sync(load)
    return `${value}:${tick()}`
  })

  const waiting = pump(() => view())
  expect(waiting).not.toBeNull()
  expect(calls).toBe(1)

  release('v')
  await waiting
  flush()

  expect(view()).toBe('v:0')
  // Перезапуск после разрешения промиса не должен повторно дёргать загрузку.
  expect(calls).toBe(1)
})

test('E2: расхождение при перезапуске диагностируется, а не проглатывается', async () => {
  const mismatches: Array<{ sub: string; found: string; wanted: string }> = []
  setTaskMismatchHandler((info) => mismatches.push(info))

  try {
    let release!: (value: string) => void
    const gate = new Promise<string>((resolve) => {
      release = resolve
    })
    const load = (): Promise<string> => gate

    const alpha = (): string => 'alpha'
    const beta = (): string => 'beta'
    let flip = false

    const view = computed(function view() {
      // Намеренно нестабильный порядок: на втором прогоне на позиции 0 окажется
      // другая функция. Такой код неверен, и рантайм обязан об этом сказать.
      const label = flip ? sync(beta) : sync(alpha)
      const value = sync(load)
      return `${label}:${value}`
    })

    const waiting = pump(() => view())
    expect(waiting).not.toBeNull()

    flip = true
    release('v')
    await waiting
    flush()
    // Перезапуск с другой функцией на той же позиции: задача переиспользована не
    // будет, а значит файбер может приостановиться снова — это ожидаемое следствие
    // неверного кода, и тест проверяет не значение, а факт диагностики.
    pump(() => view())

    expect(mismatches.length).toBeGreaterThan(0)
    expect(mismatches[0]?.found).toContain('alpha')
    expect(mismatches[0]?.wanted).toContain('beta')
  } finally {
    setTaskMismatchHandler(null)
  }
})
