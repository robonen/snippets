import { expect, test } from 'vitest'
import {
  ReactiveMap,
  async,
  computed,
  flush,
  isSuspend,
  setTaskMismatchHandler,
  sync,
} from '../index'

/**
 * Порт корпуса `mol/wire/plex/plex.test.ts` — ключевые каналы.
 *
 * **Семантика записи у нас другая, и это осознанно.** В `$mol` запись в канал
 * заново выполняет само вычисление с новым аргументом и кладёт результат
 * (`resync`): `foo(next?) { return next ?? default }` даёт «канал с подменой»
 * даром. У нас — модель Vue: сеттер обязан записать в реактивный источник, а
 * пересчёт случится сам, потому что источник изменился.
 *
 * Магии меньше, шагов больше, зато нет второго способа изменить состояние в обход
 * источников — и видно, где именно живут данные.
 *
 * Сценарий «Memoize by single complex key» не переносится: ключ у нас обязан быть
 * примитивом. Ключ сравнивается на каждом обращении, и глубокое сравнение объектов
 * на горячем пути обошлось бы дороже самого вычисления.
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

test('Memoize by single simple key: каждый ключ считается сам по себе', () => {
  const overrides = new ReactiveMap<string, string>()

  const names = computed.keyed({
    get: (user: string) => overrides.get(user) ?? user,
    set: (user: string, next: string) => overrides.set(user, next),
  })

  const listed = computed(function listed() {
    return [names('jin'), names('john')]
  })

  expect(listed()).toEqual(['jin', 'john'])

  names('jin', 'JIN')
  flush()
  expect(listed()).toEqual(['JIN', 'john'])
})

test('Deep deps: рекурсия по ключам и инвалидация вглубь', () => {
  let sums = 0
  const overrides = new ReactiveMap<number, number>()

  const value: (index: number, next?: number) => number = computed.keyed({
    get: (index: number): number => {
      const override = overrides.get(index)
      if (override !== undefined) return override
      if (index < 2) return 1
      sums++
      return value(index - 1) + value(index - 2)
    },
    set: (index: number, next: number) => overrides.set(index, next),
  })

  expect(value(4)).toBe(5)
  expect(sums).toBe(3)

  value(1, 2)
  flush()
  expect(value(4)).toBe(8)
  // Пересчитались только зависевшие от изменившегося ключа: 2, 3 и 4.
  expect(sums).toBe(6)
})

test('Error caching: значение, пришедшее снаружи, доводит ожидание до конца', async () => {
  const stored = new ReactiveMap<string, number>()
  // Ожидание, которое само по себе никогда не разрешится: значение придёт записью.
  const never = new Promise<never>(() => {})
  const wait = (): Promise<never> => never

  const data: (id: string, next?: number) => number = computed.keyed({
    get: (id: string): number => stored.get(id) ?? sync(wait),
    set: (id: string, next: number) => stored.set(id, next),
  })

  const waiting = async(() => data('1'))

  setTimeout(() => {
    data('1', 123)
    flush()
  }, 0)

  expect(await waiting).toBe(123)
})

test('ключевой канал: приостановка на одном ключе не блокирует остальные', async () => {
  const gates = new Map<string, { promise: Promise<string>; release: (v: string) => void }>()

  const gateFor = (id: string) => {
    let found = gates.get(id)
    if (found === undefined) {
      let release!: (v: string) => void
      const promise = new Promise<string>((resolve) => {
        release = resolve
      })
      found = { promise, release }
      gates.set(id, found)
    }
    return found
  }

  // Загрузчик стабилен по ключу: `sync(() => …)` создавал бы новую стрелку на каждом
  // прогоне, позиционное опознание задачи не срабатывало бы, и ожидание начиналось
  // заново после каждого перезапуска. Это то самое требование стабильной ссылки.
  const loaders = new Map<string, () => Promise<string>>()
  const loaderFor = (id: string) => {
    let found = loaders.get(id)
    if (found === undefined) {
      found = () => gateFor(id).promise
      loaders.set(id, found)
    }
    return found
  }

  const item = computed.keyed((id: string) => sync(loaderFor(id)))

  expect(pump(() => item('a'))).not.toBeNull()
  expect(pump(() => item('b'))).not.toBeNull()

  gateFor('b').release('B')
  await gateFor('b').promise
  flush()

  expect(item('b')).toBe('B')
  // Ключ `a` всё ещё ждёт — и это никак не помешало ключу `b`.
  expect(pump(() => item('a'))).not.toBeNull()

  gateFor('a').release('A')
  await gateFor('a').promise
  flush()
  expect(item('a')).toBe('A')
})

test('нестабильная ссылка в sync(): значение не доезжает никогда', async () => {
  const mismatches: Array<{ sub: string; found: string; wanted: string }> = []
  setTaskMismatchHandler((info) => mismatches.push(info))

  try {
    const gate = Promise.resolve('готово')

    const view = computed(function view() {
      // Намеренно нестабильная ссылка — так писать нельзя.
      return sync(() => gate)
    })

    // Каждый прогон заводит новую задачу: старую не опознать, потому что стрелка
    // другая. Значит после разрешения промиса файбер приостанавливается снова —
    // и так до бесконечности. Ошибка не «замедляет», она делает значение
    // недостижимым, поэтому диагностика обязательна.
    for (let attempt = 0; attempt < 5; attempt++) {
      const waiting = pump(() => view())
      expect(waiting).not.toBeNull()
      await waiting
      flush()
    }

    expect(mismatches.length).toBeGreaterThan(0)
  } finally {
    setTaskMismatchHandler(null)
  }
})
