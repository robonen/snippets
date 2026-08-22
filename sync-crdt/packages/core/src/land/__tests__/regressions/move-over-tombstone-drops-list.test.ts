import { expect, test } from 'vitest'
import { fixedClock, Replica } from '../../replica'
import { readAll } from '../harness'

/**
 * Та же дыра в `Replica.move`, что и в `move-past-branched-lead`, но заходом
 * через надгробие — и с самым громким исходом: **список исчезает целиком**.
 *
 * `move` ищет последователя в `this.order(head)`, а там надгробий нет. В списке
 * `[1, 2, 3]` после удаления `2` цепочка выглядит так:
 *
 * ```
 * 1 ← †2 ← 3          читается [1, 3]
 * ```
 *
 * `move(1, за 3)` видит соседом единицы тройку, у тройки `lead = †2`, «значит
 * переподвешивать нечего» — и постит `1.lead = 3`. Получается замкнутое
 * `1 → 3 → †2 → 1`, недостижимое от корня. Живых элементов было двое, стало ноль.
 *
 * Проверка `follower.lead === self` и есть источник дефекта: `sand_move` из baza
 * переподвешивает последователя **безусловно**, и на этом сценарии сохраняет
 * список. Это расхождение с оригиналом, а не сознательное упрощение.
 */
test('move поверх надгробия обнуляет весь список', () => {
  const clock = fixedClock(1000)
  const replica = new Replica('p1', clock)

  const one = replica.insert('', '1')
  const two = replica.insert(one.self, '2')
  const three = replica.insert(two.self, '3')

  expect(readAll(replica)).toEqual(['1', '2', '3'])

  expect(replica.remove(two.self)).toBe(true)
  expect(readAll(replica)).toEqual(['1', '3'])

  expect(replica.move(one.self, three.self)).toBe(true)

  // Падает: фактически читается [] — из двух живых элементов не осталось ни одного.
  expect(readAll(replica)).toEqual(['3', '1'])
})
