import { expect, test } from 'vitest'
import { ReactiveMap, ReactiveSet, computed, flush } from '../index'

/**
 * Порт корпуса `mol/wire/dict/dict.test.ts` и `mol/wire/set/set.test.ts`.
 *
 * Проверяется семантика наблюдения за коллекцией: за одним ключом, за размером, за
 * обходом. У `$mol` гранулярности по ключу нет — там любое изменение будит всех
 * читателей коллекции, — поэтому там, где оригинал ограничивается «значение
 * обновилось», мы дополнительно проверяем, что соседей не разбудило.
 *
 * Канала `dict.item(key, next)` у нас нет намеренно: `get`/`set`/`delete` покрывают
 * тот же смысл без третьего способа сказать одно и то же (правило 1).
 */

test('карта: наблюдение за одним значением', () => {
  const dict = new ReactiveMap<number, number>()
  const lucky = computed(function lucky() {
    return dict.get(777)
  })

  expect(lucky()).toBeUndefined()

  dict.set(666, 6666)
  flush()
  expect(lucky()).toBeUndefined()

  dict.set(777, 7777)
  flush()
  expect(lucky()).toBe(7777)

  dict.delete(777)
  flush()
  expect(lucky()).toBeUndefined()
})

test('карта: наблюдение за размером', () => {
  const dict = new ReactiveMap<number, number>()
  let runs = 0
  const size = computed(function size() {
    runs++
    return dict.size
  })

  expect(size()).toBe(0)
  expect(runs).toBe(1)

  dict.set(1, 1)
  flush()
  expect(size()).toBe(1)
  expect(runs).toBe(2)

  // Значение по существующему ключу меняется — состав ключей нет, размер тоже.
  dict.set(1, 2)
  flush()
  expect(size()).toBe(1)
  expect(runs).toBe(2)

  dict.delete(1)
  flush()
  expect(size()).toBe(0)
  expect(runs).toBe(3)
})

test('карта: наблюдение за обходом', () => {
  const dict = new ReactiveMap<number, number>()
  const listed = computed(function listed() {
    const out: number[] = []
    for (const [, value] of dict) out.push(value)
    return out
  })

  expect(listed()).toEqual([])

  dict.set(1, 10)
  flush()
  expect(listed()).toEqual([10])

  dict.set(2, 20)
  flush()
  expect(listed()).toEqual([10, 20])

  dict.delete(1)
  flush()
  expect(listed()).toEqual([20])
})

test('карта: наблюдение через forEach', () => {
  const dict = new ReactiveMap<number, number>()
  const summed = computed(function summed() {
    let sum = 0
    dict.forEach((value) => {
      sum += value
    })
    return sum
  })

  expect(summed()).toBe(0)

  dict.set(1, 10)
  flush()
  expect(summed()).toBe(10)

  dict.set(2, 20)
  flush()
  expect(summed()).toBe(30)
})

test('карта: чего нет в оригинале — сосед не будит', () => {
  const dict = new ReactiveMap<number, number>()
  dict.set(1, 1)
  dict.set(2, 2)

  let runs = 0
  const first = computed(function first() {
    runs++
    return dict.get(1)
  })
  first()
  expect(runs).toBe(1)

  // В `$mol_wire_dict` здесь проснулись бы читатели всех ключей.
  dict.set(2, 22)
  flush()
  first()
  expect(runs).toBe(1)

  dict.set(1, 11)
  flush()
  expect(first()).toBe(11)
  expect(runs).toBe(2)
})

test('множество: наблюдение за одним значением', () => {
  const set = new ReactiveSet<number>()
  const lucky = computed(function lucky() {
    return set.has(777)
  })

  expect(lucky()).toBe(false)

  set.add(666)
  flush()
  expect(lucky()).toBe(false)

  set.add(777)
  flush()
  expect(lucky()).toBe(true)

  set.delete(777)
  flush()
  expect(lucky()).toBe(false)
})

test('множество: размер и обход', () => {
  const set = new ReactiveSet<number>()
  const listed = computed(function listed() {
    return [...set]
  })
  const size = computed(function size() {
    return set.size
  })

  expect(listed()).toEqual([])
  expect(size()).toBe(0)

  set.add(1)
  flush()
  expect(listed()).toEqual([1])
  expect(size()).toBe(1)

  // Повторное добавление того же значения ничего не меняет.
  set.add(1)
  flush()
  expect(size()).toBe(1)

  set.delete(1)
  flush()
  expect(listed()).toEqual([])
  expect(size()).toBe(0)
})

test('множество: наблюдение через forEach', () => {
  const set = new ReactiveSet<number>()
  const summed = computed(function summed() {
    let sum = 0
    set.forEach((value) => {
      sum += value
    })
    return sum
  })

  expect(summed()).toBe(0)

  set.add(10)
  flush()
  expect(summed()).toBe(10)

  set.add(20)
  flush()
  expect(summed()).toBe(30)
})
