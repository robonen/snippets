import { expect, test } from 'vitest'
import { fixedClock, Replica } from '../../replica'
import { converge, readAll } from '../harness'

/**
 * Регрессия: **конкурентные `move` замыкают цепочку `lead` в кольцо, и кольцо
 * выпадает из чтения целиком**.
 *
 * Это тот самый предел, который заявлен в шапке `order-naive.ts`. Тест не
 * обходит его, а фиксирует: `orderNaive` обходит только достижимое от `ROOT`,
 * а кольцо лежит в отдельной компоненте графа.
 *
 * Сценарий минимальный и симметричный: две реплики берут общий список
 * `[1, 2, 3, 4]` и каждая ставит один элемент за другим — крест-накрест.
 *
 * ```
 * p1: move(1, за 3)   →  1.lead = 3
 * p2: move(3, за 1)   →  3.lead = 1
 * ```
 *
 * Оба юнита переживают LWW: они про разные `self`, спорить не с чем. После
 * слияния получается `1 → 3 → 1`, и обе реплики **согласованно** теряют
 * элементы `1` и `3`.
 *
 * Обрати внимание, чего здесь **нет**: сходимость не нарушена — реплики читают
 * одно и то же. Ломается другое свойство, reachability: элемент, живой по LWW,
 * обязан быть виден. `sand_ordered` из baza в этом месте дописывает сирот в
 * хвост; у нас этого нет, поэтому тест красный.
 *
 * @see ../convergence.prop.test.ts — свойство `reachability`
 */
test('конкурентные move крест-накрест роняют оба элемента из чтения', () => {
  const clock = fixedClock(1000)
  const left = new Replica('p1', clock)
  const right = new Replica('p2', clock)

  const selfs: string[] = []
  let lead = ''
  for (const value of ['1', '2', '3', '4']) {
    const sand = left.insert(lead, value)
    lead = sand.self
    selfs.push(sand.self)
  }

  converge(left, right)
  expect(readAll(right)).toEqual(['1', '2', '3', '4'])

  // Правки строго новее базы, иначе спор ушёл бы к арбитру по `peer`.
  clock.advance(1)

  expect(left.move(selfs[0]!, selfs[2]!)).toBe(true)
  expect(readAll(left)).toEqual(['2', '3', '1', '4'])

  expect(right.move(selfs[2]!, selfs[0]!)).toBe(true)
  expect(readAll(right)).toEqual(['1', '3', '2', '4'])

  converge(left, right)

  // Сходимость цела: обе реплики видят ровно одно и то же.
  expect(readAll(right)).toEqual(readAll(left))

  // А вот это падает: фактически обе читают ['2', '4'].
  // Порядок после слияния конкурентных move не определён однозначно, поэтому
  // требуем минимум — ни один живой элемент не исчез.
  expect([...readAll(left)].sort()).toEqual(['1', '2', '3', '4'])
})
