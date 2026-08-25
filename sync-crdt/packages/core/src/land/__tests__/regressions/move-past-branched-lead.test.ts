import { expect, test } from 'vitest'
import { fixedClock, Replica } from '../../replica'
import { readAll } from '../harness'

/**
 * Регрессия из property-теста `reachability`, сид `327710307`
 * (`path: "0:0:6:3:5:6:6:7:7:7:9:6:1:7:11:0:10:5:…"`, ужато 39 раз).
 *
 * **Одна реплика, никакой конкуренции.** Это не предел модели из шапки
 * `order-naive.ts`, а дефект `Replica.move`: он переподвешивает ровно одного
 * последователя — того, что стоит следующим **в порядке чтения**, — тогда как
 * `lead`-детей у переезжающего узла может быть несколько.
 *
 * Как получаются двое детей у одного `lead`. Вставка `x` за `b0` не трогает
 * связь `b1.lead = b0`, а становится вторым ребёнком `b0` и выигрывает у `b1`
 * по времени:
 *
 * ```
 * b0 ← x      (свежий, идёт первым)
 * b0 ← b1
 * ```
 *
 * Читается `[b0, x, b1]` — верно. Теперь `move(b0, за b1)`: в порядке чтения за
 * `b0` стоит `x`, его и переподвешивают на `ROOT`. `b1.lead` остаётся `b0`, а
 * `b0.lead` становится `b1` — кольцо из двух узлов, и оба пропадают.
 *
 * `sand_move` из baza ([land.ts:934](../../../../../../baza/land/land.ts))
 * делает ровно то же самое; разница в том, что `sand_ordered` там дописывает
 * сирот в хвост и потеря не видна. Наш обход сирот не собирает, поэтому дефект
 * виден сразу — и чинить его надо в `move`, а не в `order`.
 */
test('move past its own descendant loses a node with two lead children', () => {
  const clock = fixedClock(1000)
  const replica = new Replica('p1', clock)

  const b0 = replica.insert('', 'b0')
  const b1 = replica.insert(b0.self, 'b1')
  replica.insert(b0.self, 'x')

  expect(readAll(replica)).toEqual(['b0', 'x', 'b1'])

  expect(replica.move(b0.self, b1.self)).toBe(true)

  // Внутри кольца «правильного» порядка не существует: цепочка `lead` замкнулась,
  // и любой линейный порядок одинаково произволен. Значение имеют два инварианта —
  // ничего не потеряно и все реплики читают одно и то же.
  const read = readAll(replica)
  expect(read).toHaveLength(3)
  expect([...read].sort()).toEqual(['b0', 'b1', 'x'])

  const observer = new Replica('observer', clock)
  observer.applySands([...replica.sands()].reverse())
  expect(readAll(observer)).toEqual(read)
})
