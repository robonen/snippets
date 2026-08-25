import { expect, expectTypeOf, test } from 'vitest'
import { act, async, computed, flush, ref, sync } from '../index'

/**
 * Порт корпуса `mol/wire/async/async.test.ts` — выход из мира файберов в промисы.
 *
 * **Главное расхождение.** У `$mol` `$mol_wire_async(obj).method` — это канал:
 * задача опознаётся по паре «хост + имя метода», поэтому повторный вызов вытесняет
 * незавершённый предыдущий («latest wins») даром. У нас `async(fn)` каналом не
 * является: каждый вызов заводит собственного наблюдателя, и вытеснять ему нечего —
 * идентичности, по которой можно было бы узнать «тот же самый вызов», просто нет.
 *
 * Поэтому оригинальный сценарий переносится не буквально: вытеснение у нас выражается
 * через реактивный источник — новая запись делает файбер грязным, и незавершённый
 * прогон бросается. Это ровно то же наблюдаемое свойство (`first` копит все попытки,
 * `last` — только победившую), но выраженное состоянием, а не именем метода.
 * Отсутствие вытеснения у самого `async()` зафиксировано отдельным тестом ниже.
 */

test('test types: async wraps the result in a Promise', () => {
  const compute = (): string => 'x'
  const read = () => async(compute)

  expectTypeOf<ReturnType<typeof read>>().toEqualTypeOf<Promise<string>>()
  expect(typeof read).toBe('function')
})

test('Latest calls wins: a new write cancels an unfinished run', async () => {
  const first: string[] = []
  const last: string[] = []

  // Идемпотентная часть: у оригинала это `$mol_wire_sync(this.first).push(next)`.
  const record = act((next: string) => {
    first.push(next)
  })

  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const wait = (): Promise<void> => gate

  const target = ref('john')
  const send = computed(function send() {
    const next = target()
    record(next)
    sync(wait)
    // Досюда доходит только тот прогон, который не был вытеснен.
    last.push(next)
    return next
  })

  const waiting = async(() => send())

  target('jin')
  flush()

  release()
  await waiting
  flush()

  expect(first).toEqual(['john', 'jin'])
  expect(last).toEqual(['jin'])
})

test('Divergence: async() is not a channel — calls do not preempt each other', async () => {
  const log: number[] = []
  let count = 0
  const step = (): Promise<number> => Promise.resolve(++count)

  const first = async(() => {
    const value = sync(step)
    log.push(value)
    return value
  })
  const second = async(() => {
    const value = sync(step)
    log.push(value)
    return value
  })

  // В `$mol` второй вызов того же канала убил бы первый, и `log` содержал бы одну
  // запись. У нас это два независимых вычисления, и оба доводятся до конца.
  expect(await first).toBe(1)
  expect(await second).toBe(2)
  expect(log).toEqual([1, 2])
})
