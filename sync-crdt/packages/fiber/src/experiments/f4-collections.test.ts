import { expect, test } from 'vitest'
import { ReactiveMap, ReactiveSet, computed, flush, ref, watchEffect } from '../index'

test('map: a reader of one key does not wake on a neighboring key change', () => {
  const map = new ReactiveMap<string, number>()
  map.set('a', 1)
  map.set('b', 2)

  let readsA = 0
  let readsB = 0
  const viewA = computed(function viewA() {
    readsA++
    return map.get('a')
  })
  const viewB = computed(function viewB() {
    readsB++
    return map.get('b')
  })

  expect(viewA()).toBe(1)
  expect(viewB()).toBe(2)
  expect(readsA).toBe(1)
  expect(readsB).toBe(1)

  map.set('b', 20)
  flush()

  expect(viewA()).toBe(1)
  expect(viewB()).toBe(20)
  // Ради этой строки коллекция и переписана: в `$mol_wire_dict` проснулись бы оба.
  expect(readsA).toBe(1)
  expect(readsB).toBe(2)
})

test('map: writing the same value wakes no one', () => {
  const map = new ReactiveMap<string, number>()
  map.set('a', 1)

  let reads = 0
  const view = computed(function view() {
    reads++
    return map.get('a')
  })
  view()
  expect(reads).toBe(1)

  map.set('a', 1)
  flush()
  view()
  expect(reads).toBe(1)
})

test('map: version nodes are created only for keys that were read', () => {
  const map = new ReactiveMap<string, number>()
  for (let i = 0; i < 100; i++) map.set(`k${i}`, i)

  // Записали сотню, не прочитали ни одного — версий нет.
  expect(map.tracked).toBe(0)

  const view = computed(function view() {
    return map.get('k5')
  })
  view()
  expect(map.tracked).toBe(1)
})

test('map: deleting a key removes its version node', () => {
  const map = new ReactiveMap<string, number>()
  map.set('a', 1)

  let reads = 0
  const view = computed(function view() {
    reads++
    return map.get('a')
  })
  view()
  expect(map.tracked).toBe(1)

  map.delete('a')
  flush()
  // Версия удалена вместе с ключом — карта не растёт на обороте ключей, которые
  // никто больше не читает.
  expect(map.tracked).toBe(0)

  // А живой читатель, проснувшись, заведёт себе новую — и это правильно.
  expect(view()).toBeUndefined()
  expect(reads).toBe(2)
  expect(map.tracked).toBe(1)
})

test('map: iteration subscribes to the key set, not the values', () => {
  const map = new ReactiveMap<string, number>()
  map.set('a', 1)

  let reads = 0
  const keys = computed(function keys() {
    reads++
    return [...map.keys()]
  })

  expect(keys()).toEqual(['a'])
  expect(reads).toBe(1)

  // Значение поменялось, состав ключей — нет.
  map.set('a', 2)
  flush()
  expect(keys()).toEqual(['a'])
  expect(reads).toBe(1)

  map.set('b', 3)
  flush()
  expect(keys()).toEqual(['a', 'b'])
  expect(reads).toBe(2)
})

test('map: peek reads without subscribing', () => {
  const map = new ReactiveMap<string, number>()
  map.set('a', 1)

  let reads = 0
  const view = computed(function view() {
    reads++
    return map.peek('a')
  })
  expect(view()).toBe(1)

  map.set('a', 2)
  flush()
  expect(view()).toBe(1)
  expect(reads).toBe(1)
})

test('set: the same granularity', () => {
  const set = new ReactiveSet<string>()
  set.add('a')

  let readsA = 0
  let readsB = 0
  const hasA = computed(function hasA() {
    readsA++
    return set.has('a')
  })
  const hasB = computed(function hasB() {
    readsB++
    return set.has('b')
  })
  hasA()
  hasB()

  set.add('b')
  flush()

  expect(hasA()).toBe(true)
  expect(hasB()).toBe(true)
  expect(readsA).toBe(1)
  expect(readsB).toBe(2)
})

test('cell: ref covers the single-value case', () => {
  const cell = ref(1)

  let reads = 0
  const stop = watchEffect(() => {
    reads++
    cell()
  })
  expect(reads).toBe(1)

  cell(2)
  flush()
  expect(reads).toBe(2)

  cell(2)
  flush()
  expect(reads).toBe(2)

  expect(cell.node.value).toBe(2)
  stop()
})
