import { expect, test } from 'vitest'
import { batch, computed, flush, isSuspend, nextTick, ref, sync, watchEffect } from './index'

/**
 * Кросс-движковый гейт файберного ядра: `pnpm --filter @sync/fiber test:browser`.
 *
 * У бинарного слоя предметом такой проверки были БАЙТЫ — там достаточно сверить
 * golden-векторы. Здесь сверять нечего: ядро не производит байт. Зато оно стоит
 * на том, что движок обязан соблюдать порядок — микрозадачи, возобновление после
 * `throw Promise`, схлопывание пересчётов. Поэтому предмет гейта — **порядок
 * событий**, записанный как след и замороженный так же, как замораживают байты.
 *
 * Ожидания в тестах не выведены из головы: они получены прогоном в Node и
 * зафиксированы. Если Chromium даст другой порядок — тест покраснеет, и это
 * именно то, ради чего он написан.
 *
 * Планировщик здесь сознательно детерминирован: ни `WeakRef`, ни
 * `FinalizationRegistry` ядро не использует, сборка идёт по достижимости в
 * `flush`. Значит, единственная зависимость от движка — очередь микрозадач, и
 * след обязан совпасть побуквенно.
 */

/** Прочитать канал, превратив приостановку в запись следа, а не в исключение. */
function pump(trace: string[], label: string, read: () => unknown): void {
  try {
    trace.push(`${label}=${String(read())}`)
  } catch (error) {
    if (isSuspend(error)) trace.push(`${label}:ждёт`)
    else throw error
  }
}

test('круг приостановки идёт одним и тем же порядком', async () => {
  const trace: string[] = []
  let release!: (value: string) => void
  const gate = new Promise<string>((resolve) => {
    release = resolve
  })
  const load = (): Promise<string> => {
    trace.push('загрузка:старт')
    return gate
  }

  const view = computed(function view() {
    trace.push('вид:прогон')
    return sync(load)
  })

  pump(trace, 'первое', () => view())
  pump(trace, 'второе', () => view())

  release('готово')
  await gate
  flush()

  pump(trace, 'третье', () => view())

  expect(trace).toEqual([
    'вид:прогон',
    'загрузка:старт',
    'первое:ждёт',
    // Второе чтение НЕ перезапускает ни вид, ни загрузку: приостановка лежит в
    // кэше файбера, и повторный читатель получает тот же промис.
    'второе:ждёт',
    'вид:прогон',
    'третье=готово',
  ])
})

test('одноразовая задача переиспользуется по позиции, а не считается заново', async () => {
  const trace: string[] = []
  let releaseFirst!: (value: string) => void
  let releaseSecond!: (value: string) => void
  const first = new Promise<string>((resolve) => {
    releaseFirst = resolve
  })
  const second = new Promise<string>((resolve) => {
    releaseSecond = resolve
  })

  const loadFirst = (): Promise<string> => {
    trace.push('первая:вызов')
    return first
  }
  const loadSecond = (): Promise<string> => {
    trace.push('вторая:вызов')
    return second
  }

  const view = computed(function view() {
    const a = sync(loadFirst)
    const b = sync(loadSecond)
    return `${a}+${b}`
  })

  pump(trace, 'до', () => view())
  releaseFirst('раз')
  await first
  flush()

  // После первого возобновления вид считается заново, но `loadFirst` повторно
  // НЕ зовётся: его результат лежит в задаче, найденной по позиции.
  pump(trace, 'между', () => view())
  releaseSecond('два')
  await second
  flush()
  pump(trace, 'после', () => view())

  expect(trace).toEqual([
    'первая:вызов',
    'до:ждёт',
    'вторая:вызов',
    'между:ждёт',
    'после=раз+два',
  ])
})

test('nextTick и queueMicrotask чередуются одинаково', async () => {
  const trace: string[] = []
  const count = ref(0)

  const stop = watchEffect(() => {
    trace.push(`эффект:${count()}`)
  })
  expect(trace).toEqual(['эффект:0'])

  count(1)
  queueMicrotask(() => trace.push('микрозадача'))
  await nextTick()
  trace.push('после-nextTick')

  stop()

  // Порядок здесь — гарантия, а не случайность: запись канала ставит микрозадачу
  // пересчёта СРАЗУ, в момент записи. Поэтому граф досчитывается раньше любой
  // микрозадачи, поставленной после записи, и читатель, вставший в очередь после
  // правки, видит уже согласованный граф, а не полуобновлённый.
  expect(trace).toEqual(['эффект:0', 'эффект:1', 'микрозадача', 'после-nextTick'])
})

test('batch схлопывает записи в один пересчёт', () => {
  const trace: string[] = []
  const width = ref(1)
  const height = ref(1)

  const area = computed(function area() {
    trace.push('площадь:прогон')
    return width() * height()
  })

  const stop = watchEffect(() => {
    trace.push(`эффект:${area()}`)
  })

  batch(() => {
    width(2)
    height(3)
    trace.push('внутри-batch')
  })

  stop()

  expect(trace).toEqual([
    'площадь:прогон',
    'эффект:1',
    'внутри-batch',
    'площадь:прогон',
    'эффект:6',
  ])
})

test('узел без подписчиков собирается на том же flush', () => {
  const trace: string[] = []
  const source = ref(1)

  const view = computed(function view() {
    trace.push('вид:прогон')
    return source()
  })

  const stop = watchEffect(() => {
    view()
  })
  expect(trace).toEqual(['вид:прогон'])

  stop()
  flush()

  // Подписчиков не осталось — узел собран, и следующее чтение считает заново.
  view()
  expect(trace).toEqual(['вид:прогон', 'вид:прогон'])
})

test('ошибка внутри приостановки доходит до читателя тем же путём', async () => {
  const trace: string[] = []
  let reject!: (error: Error) => void
  const gate = new Promise<string>((_, no) => {
    reject = no
  })
  const load = (): Promise<string> => gate

  const view = computed(function view() {
    return sync(load)
  })

  pump(trace, 'до', () => view())

  reject(new Error('обрыв'))
  await gate.catch(() => undefined)
  flush()

  try {
    view()
    trace.push('после:без-ошибки')
  } catch (error) {
    trace.push(`после:ошибка=${(error as Error).message}`)
  }

  expect(trace).toEqual(['до:ждёт', 'после:ошибка=обрыв'])
})
