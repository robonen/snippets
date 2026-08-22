import { expect, test } from 'vitest'
import { computed, flush, isSuspend, ref, sync } from '../index'
import type { Link } from '../graph'

/**
 * E1 — гипотеза ADR-003.
 *
 * Если при приостановке НЕ обрезать хвост зависимостей, следующий прогон
 * переиспользует те же объекты `Link` без аллокаций.
 *
 * Доказательство строится на идентичности объектов (`toBe`, не `toEqual`), а не на
 * счётчиках: `link()` из alien-signals либо возвращает существующее ребро, либо
 * создаёт новое, третьего не дано.
 */

function depsOf(channel: { readonly node: { deps: Link | undefined } }): Link[] {
  const out: Link[] = []
  for (let cursor = channel.node.deps; cursor !== undefined; cursor = cursor.nextDep) {
    out.push(cursor)
  }
  return out
}

/** Прочитать, проглотив приостановку. Возвращает промис ожидания либо null. */
function pump(read: () => unknown): Promise<unknown> | null {
  try {
    read()
    return null
  } catch (error) {
    if (isSuspend(error)) return error
    throw error
  }
}

test('E1: рёбра переиспользуются после приостановки', async () => {
  const a = ref('a')
  const b = ref('b')

  let releaseFirst!: (value: string) => void
  let releaseSecond!: (value: string) => void
  const first = new Promise<string>((resolve) => {
    releaseFirst = resolve
  })
  const second = new Promise<string>((resolve) => {
    releaseSecond = resolve
  })
  // Стабильные ссылки обязательны: позиционное опознание задачи сверяет саму функцию.
  const loadFirst = (): Promise<string> => first
  const loadSecond = (): Promise<string> => second

  // Две приостановки, а не одна: после единственной файбер досчитался бы и `complete()`
  // уничтожил бы одноразовые задачи вместе с их рёбрами — доказывать было бы нечего.
  const total = computed(function total() {
    const left = a()
    const middle = sync(loadFirst)
    const right = b()
    const tail = sync(loadSecond)
    return `${left}-${middle}-${right}-${tail}`
  })

  expect(pump(() => total())).not.toBeNull()

  // До первой приостановки успели прочитаться только `a` и первая задача.
  const before = depsOf(total)
  expect(before).toHaveLength(2)

  releaseFirst('v1')
  await first
  flush()

  // Второй прогон дошёл дальше и встал на второй задаче — значит хвост не обрезан.
  expect(pump(() => total())).not.toBeNull()

  const middleState = depsOf(total)
  expect(middleState).toHaveLength(4)

  // Главное утверждение: рёбра, собранные до приостановки, — те же самые объекты.
  expect(middleState[0]).toBe(before[0])
  expect(middleState[1]).toBe(before[1])

  releaseSecond('v2')
  await second
  flush()

  expect(total()).toBe('a-v1-b-v2')
})

test('E1-контроль: изменившаяся зависимость даёт НОВОЕ ребро', () => {
  const which = ref(true)
  const a = ref(1)
  const b = ref(2)

  const pick = computed(function pick() {
    return which() ? a() : b()
  })

  expect(pick()).toBe(1)
  const before = depsOf(pick)
  expect(before).toHaveLength(2)

  which(false)
  flush()
  expect(pick()).toBe(2)

  const after = depsOf(pick)
  expect(after).toHaveLength(2)

  // Позиция 0 не менялась — ребро переиспользовано.
  expect(after[0]).toBe(before[0])
  // Позиция 1 сменила зависимость — ребро обязано быть другим.
  // Без этой проверки предыдущий тест ничего не доказывал бы: `toBe` могло
  // оказаться истинным просто потому, что рёбра никогда не пересоздаются.
  expect(after[1]).not.toBe(before[1])
  expect(after[1]?.dep).toBe(b.node)
})

test('E1: хвост обрезается после успешного прогона — призрачной подписки не остаётся', async () => {
  const on = ref(true)
  const extra = ref('x')

  let release!: (value: string) => void
  const gate = new Promise<string>((resolve) => {
    release = resolve
  })
  const load = (): Promise<string> => gate

  const view = computed(function view() {
    const flag = on()
    const value = sync(load)
    return flag ? `${value}${extra()}` : value
  })

  const waiting = pump(() => view())
  expect(waiting).not.toBeNull()

  release('v')
  await waiting
  flush()
  expect(view()).toBe('vx')
  expect(extra.node.subs).not.toBeUndefined()

  // Ветка отключилась — хвост зависимостей должен быть обрезан на прогоне,
  // который завершился без приостановки.
  on(false)
  flush()

  // Пересчёт атома повторяет и загрузку: коммит предыдущего прогона уничтожил
  // одноразовую задачу, поэтому приостановка случится ещё раз. Подробности —
  // в тесте про «sync() внутри атома не кэш» ниже.
  const again = pump(() => view())
  if (again !== null) {
    await again
    flush()
  }

  expect(view()).toBe('v')
  expect(extra.node.subs).toBeUndefined()
})

test('sync() внутри атома — не кэш: пересчёт атома повторяет загрузку', async () => {
  let calls = 0
  const tick = ref(0)

  const load = (): Promise<number> => {
    calls++
    return Promise.resolve(calls)
  }

  const view = computed(function view() {
    tick()
    return sync(load)
  })

  const first = pump(() => view())
  if (first !== null) await first
  flush()
  expect(view()).toBe(1)
  expect(calls).toBe(1)

  // Тот же атом, изменившаяся зависимость → новое логическое вычисление →
  // одноразовая задача создаётся заново и загрузка выполняется повторно.
  //
  // Это не дефект, а граница ответственности: кэширование асинхронного источника —
  // работа отдельного атома, а не `sync()`. Иначе `sync()` пришлось бы наделить
  // собственной политикой инвалидации, которой у одноразовой задачи быть не может.
  tick(1)
  flush()
  const second = pump(() => view())
  if (second !== null) await second
  flush()
  expect(view()).toBe(2)
  expect(calls).toBe(2)

  // Правильный способ закэшировать: вынести источник в свой атом.
  const cached = computed(function cached() {
    return sync(load)
  })
  const consumer = computed(function consumer() {
    tick()
    return cached()
  })

  const third = pump(() => consumer())
  if (third !== null) await third
  flush()
  const before = consumer()
  const callsAfterFirst = calls

  tick(2)
  flush()
  expect(consumer()).toBe(before)
  expect(calls).toBe(callsAfterFirst)
})
