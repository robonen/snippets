import { expect, test } from 'vitest'
import { watchEffect, flush, computed,  peek, ref, sync } from '../index'

test('computed: считает лениво и кэширует', () => {
  const source = ref(2)
  let runs = 0

  const double = computed(() => {
    runs++
    return source() * 2
  })

  // Ленивость: пока не прочитали — не считали.
  expect(runs).toBe(0)

  expect(double()).toBe(4)
  expect(double()).toBe(4)
  expect(runs).toBe(1)

  source(5)
  flush()
  expect(double()).toBe(10)
  expect(runs).toBe(2)
})

test('computed: только для чтения — запись отвергается', () => {
  const value = computed(function value() {
    return 1
  })

  // @ts-expect-error канал только для чтения: сеттера у него нет
  expect(() => value(2)).toThrow(/только для чтения/)
})

test('computed: записываемый вариант — пара get/set, как computed во Vue', () => {
  const celsius = ref(0)
  const fahrenheit = computed({
    get: () => celsius() * 1.8 + 32,
    set: (next: number) => celsius((next - 32) / 1.8),
  })

  expect(fahrenheit()).toBe(32)

  expect(fahrenheit(212)).toBe(212)
  expect(celsius()).toBe(100)

  celsius(50)
  flush()
  expect(fahrenheit()).toBe(122)
})

test('computed: set() позволяет записать сам undefined', () => {
  const stored = ref<string | undefined>('исходное')
  const proxy = computed({
    // Внутри сеттера тоже нужна явная форма: `stored(next)` при `next === undefined`
    // означало бы чтение, а не запись. Ради этого случая `.set()` и существует.
    get: () => stored(),
    set: (next: string | undefined) => {
      stored.set(next)
    },
  })

  expect(proxy()).toBe('исходное')

  // Обычный вызов `proxy(undefined)` — это чтение, поэтому для записи `undefined`
  // существует явная форма.
  expect(proxy.set(undefined)).toBeUndefined()
  expect(stored.node.value).toBeUndefined()
})

test('computed: peek читает без подписки и без пересчёта', () => {
  const source = ref(1)
  let runs = 0
  const view = computed(() => {
    runs++
    return source()
  })

  expect(peek(view)).toBeUndefined()
  expect(runs).toBe(0)

  expect(view()).toBe(1)
  expect(peek(view)).toBe(1)
  expect(runs).toBe(1)
})

test('computed: композиция без классов и прототипов', () => {
  // Ради этого API всё и переделано: узел данных — это функция-фабрика,
  // возвращающая набор каналов. Ни `this`, ни наследования, ни патчинга прототипов.
  function createCounter(start: number) {
    const count = ref(start)
    const double = computed(() => count() * 2)
    const increment = () => count(count() + 1)
    return { count, double, increment }
  }

  const first = createCounter(1)
  const second = createCounter(10)

  expect(first.double()).toBe(2)
  expect(second.double()).toBe(20)

  first.increment()
  flush()

  expect(first.double()).toBe(4)
  // Экземпляры полностью независимы: общего прототипа у них нет.
  expect(second.double()).toBe(20)
})

test('computed.keyed: свой кэш на каждый ключ', () => {
  const source = ref(1)
  const runs: number[] = []

  const item = computed.keyed((id: number) => {
    runs.push(id)
    return `${id}:${source()}`
  })

  expect(item(1)).toBe('1:1')
  expect(item(2)).toBe('2:1')
  expect(item(1)).toBe('1:1')
  expect(runs).toEqual([1, 2])

  source(7)
  flush()
  expect(item(1)).toBe('1:7')
  expect(runs).toEqual([1, 2, 1])
})

test('computed.keyed: записываемый вариант', () => {
  const store = new Map<string, number>()
  const backing = ref(0)

  const cell = computed.keyed({
    get: (key: string) => {
      backing()
      return store.get(key) ?? 0
    },
    set: (key: string, next: number) => {
      store.set(key, next)
      backing(backing() + 1)
    },
  })

  expect(cell('a')).toBe(0)
  expect(cell('a', 5)).toBe(5)
  expect(cell('a')).toBe(5)
  expect(cell('b')).toBe(0)
})

test('computed.keyed: forget и clear убирают ключи', () => {
  let runs = 0
  const item = computed.keyed((id: number) => {
    runs++
    return id * 2
  })

  item(1)
  item(2)
  expect(item.size).toBe(2)
  expect(runs).toBe(2)

  item.forget(1)
  expect(item.size).toBe(1)
  expect(item(1)).toBe(2)
  expect(runs).toBe(3)

  item.clear()
  expect(item.size).toBe(0)
})

test('computed.keyed: осиротевшие ключи вычищаются по ходу обращений', () => {
  const on = ref(true)
  const item = computed.keyed((id: number) => id * 2)

  // Читаем ключ 0 через наблюдателя — узел жив, пока на него смотрят.
  const stop = watchEffect(() => {
    if (on()) item(0)
  })
  expect(item.size).toBe(1)

  // Наблюдатель отвернулся: узел собран сборщиком графа, но запись в карте осталась.
  on(false)
  flush()

  // Сотня обращений к новым ключам запускает подметание.
  for (let i = 1; i <= 100; i++) item(i)
  // Ключ 0 к этому моменту вычищен: в карте только то, что читали сейчас.
  expect(item.size).toBeLessThanOrEqual(100)

  stop()
})

test('computed: приостановка работает через канал так же, как через файбер', async () => {
  let release!: (value: string) => void
  const gate = new Promise<string>((resolve) => {
    release = resolve
  })
  const load = (): Promise<string> => gate

  const view = computed(function view() {
    return `значение: ${sync(load)}`
  })

  let suspended = false
  try {
    view()
  } catch {
    suspended = true
  }
  expect(suspended).toBe(true)

  release('готово')
  await gate
  flush()
  expect(view()).toBe('значение: готово')
})
