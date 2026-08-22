import { compare } from './lww'
import { ROOT, type Sand } from './sand'

/**
 * LWW-свёртка по `self` внутри одного `head`.
 *
 * Один и тот же `self` может прийти в нескольких экземплярах: от разных пиров
 * (каждый постит своё изменение того же элемента) и от одного пира в разное
 * время (правка, перемещение, удаление). Живым считается ровно один — победитель
 * по {@link compare}.
 *
 * Результат **не зависит от порядка обхода** входного массива: ноль
 * {@link compare} возвращает только для юнитов одного поста, а они в наборе
 * встречаются один раз. Это и делает `read()` детерминированным на всех репликах.
 */
export function resolveNaive(sands: readonly Sand[], head: string): ReadonlyMap<string, Sand> {
  const winners = new Map<string, Sand>()

  for (const sand of sands) {
    if (sand.head !== head) continue
    const prev = winners.get(sand.self)
    if (prev !== undefined && compare(sand, prev) >= 0) continue
    winners.set(sand.self, sand)
  }

  return winners
}

/**
 * ЭТА реализация — рабочая, несмотря на имя. Замер (`bench/budgets.json`) показал,
 * что однопроходная раскладка из baza (`order.ts`) быстрее только на списке, который
 * рос дописыванием в конец: 0.67–0.81 от нашего времени. На данных, похожих на
 * реальные, она проигрывает — 1.16–1.62, потому что почти каждый юнит попадает в
 * очередь ожидания (`stalled_share` 0.65–1.0) и разбирается каскадом.
 *
 * Группировка по `lead` с сортировкой групп такой платы не несёт. Поэтому
 * `Replica.order()` зовёт именно её, а `order.ts` остаётся оракулом в
 * дифференциальных тестах.
 *
 * Референсная реализация `order()` — честно тупая, O(n log n) на сортировках
 * и O(n) на обходе, зато очевидно корректная.
 *
 * Три шага:
 * 1. свернуть версии одного `self` по LWW;
 * 2. сгруппировать победителей по `lead` и отсортировать каждую группу
 *    компаратором — конкуренты за одну позицию раскладываются детерминированно;
 * 3. обойти в глубину от {@link ROOT}: сначала сам узел, потом всё, что встало
 *    за ним. Именно спуск в глубину даёт interleaving-free — блок, вставленный
 *    цепочкой `lead`, выкладывается целиком, прежде чем начнётся соседний.
 *
 * **Надгробия убираются из результата, но не из графа.** Удалённый узел остаётся
 * точкой привязки: на него ссылаются по `lead` те, кто был вставлен после него
 * (в том числе конкурентно, до того как удаление доехало). Выкинув надгробие из
 * обхода, мы потеряли бы всё его поддерево — живые элементы исчезли бы вместе с
 * мёртвым. Поэтому `walk` спускается в детей всегда, а `value === null` влияет
 * только на попадание в выдачу.
 *
 * **Сироты не теряются.** Узлы, недостижимые от корня (кольца из конкурентных
 * Узел, чей `lead` не дошёл, временно невидим (это ожидаемо: причинность
 * восстановится с доставкой). Но конкурентные `move` могут замкнуть цепочку
 * `lead` в кольцо — такое кольцо недостижимо от корня и выпадает целиком.
 * `sand_ordered` из baza в этом случае дописывает сирот в хвост; здесь этого
 * намеренно нет, см. `__tests__/regressions/move-cycle-drops-items.test.ts`.
 *
 * @example
 * ```ts
 * orderNaive([b, a], ROOT).map(s => s.value) // → ['a', 'b'], если b.lead === a.self
 * ```
 */
export function orderNaive(sands: readonly Sand[], head: string): readonly Sand[] {
  const winners = resolveNaive(sands, head)

  const kids = new Map<string, Sand[]>()
  for (const sand of winners.values()) {
    const bucket = kids.get(sand.lead)
    if (bucket === undefined) kids.set(sand.lead, [sand])
    else bucket.push(sand)
  }
  for (const bucket of kids.values()) bucket.sort(compare)

  const out: Sand[] = []
  const seen = new Set<string>()

  // Обход итеративный, а не рекурсивный: цепочка из 10 000 последовательных
  // вставок — обычный список, а не патология, и на ней рекурсия ложилась по стеку.
  const walk = (from: string): void => {
    const stack: Sand[] = []
    const roots = kids.get(from)
    if (roots !== undefined) {
      for (let i = roots.length - 1; i >= 0; i--) stack.push(roots[i] as Sand)
    }

    while (stack.length > 0) {
      const node = stack.pop() as Sand
      // Кольцо в цепочке `lead` не должно вешать обход. Оно возникает при
      // конкурентных `move`, и это не патология входных данных, а штатный итог
      // независимых правок.
      if (seen.has(node.self)) continue
      seen.add(node.self)

      if (node.value !== null) out.push(node)

      const children = kids.get(node.self)
      if (children !== undefined) {
        for (let i = children.length - 1; i >= 0; i--) stack.push(children[i] as Sand)
      }
    }
  }

  walk(ROOT)

  // Сироты — то, до чего обход от корня не добрался: замкнувшиеся в кольцо узлы и
  // те, чей `lead` ещё не доехал. Они дописываются в хвост в порядке LWW.
  //
  // Без этого шага живые по LWW элементы молча пропадали из чтения, а `convergence`
  // этого не ловил: реплики согласованно теряли одни и те же элементы. Именно так
  // поступает `sand_ordered` из baza — там очередь разбирается до конца и место
  // находится каждому юниту.
  if (seen.size < winners.size) {
    const orphans = [...winners.values()].filter(sand => !seen.has(sand.self))
    orphans.sort(compare)
    for (const orphan of orphans) {
      if (seen.has(orphan.self)) continue
      seen.add(orphan.self)
      if (orphan.value !== null) out.push(orphan)
      // У сироты могут быть свои потомки — они тоже недостижимы от корня.
      walk(orphan.self)
    }
  }

  return out
}
