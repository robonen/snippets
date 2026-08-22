import { expect, test } from 'vitest'
import { computed, flush, ref, type Link, type Node } from '../index'

/**
 * Порт корпуса `mol/wire/pub/sub/sub.test.ts` — сбор зависимостей.
 *
 * Оригинал работает с голыми `$mol_wire_pub` / `$mol_wire_pub_sub` и вручную
 * открывает-закрывает окно трекинга (`track_on` / `track_cut` / `track_off`). У нас
 * такого уровня в публичном API нет и не будет: трекинг открывает только пересчёт
 * файбера. Поэтому переносится наблюдаемое следствие — состав и порядок списка
 * зависимостей после прогона, — а не механика окна.
 *
 * **Расхождение: кратность.** У `$mol` `pub_list` хранит повторы (`[pub1, pub2, pub2]`),
 * потому что позиция в списке — это позиция вызова. У нас повторное чтение той же
 * зависимости в пределах одного прогона ребра не добавляет: `link()` отсеивает его по
 * номеру прогона. Ребро — это подписка, а подписаться дважды на одно и то же нельзя;
 * позиционная идентичность задач (`getTask`) от этого не страдает, потому что курсор
 * `depsTail` на дедуплицированном чтении не двигается.
 *
 * Сценарий `cyclic detection` не дублируется: он уже перенесён в `mol-solo.test.ts`
 * как `Cycle: Fail`.
 */

function depsOf(channel: { readonly node: { deps: Link | undefined } }): Node[] {
  const out: Node[] = []
  for (let cursor = channel.node.deps; cursor !== undefined; cursor = cursor.nextDep) {
    out.push(cursor.dep as Node)
  }
  return out
}

test('Collect deps: список зависимостей — порядок чтения, без повторов', () => {
  const first = ref(1)
  const second = ref(2)

  const view = computed(function view() {
    // Порядок и кратность как в оригинале: pub1, pub2, pub2.
    return first() + second() + second()
  })

  expect(view()).toBe(5)
  // В `$mol` здесь было бы [first, second, second].
  expect(depsOf(view)).toEqual([first.node, second.node])
})

test('Collect deps: повторный прогон переписывает список целиком', () => {
  const first = ref(1)
  const second = ref(2)
  const flipped = ref(false)

  const view = computed(function view() {
    return flipped() ? second() + first() + first() : first() + second() + second()
  })

  view()
  expect(depsOf(view)).toEqual([flipped.node, first.node, second.node])

  flipped(true)
  flush()
  view()
  // Оригинал после второго окна трекинга ждёт [pub1, pub1, pub2]; у нас тот же
  // порядок чтения, но без кратности — и с источником условия во главе.
  expect(depsOf(view)).toEqual([flipped.node, second.node, first.node])
})

test('Collect deps: чтение, выпавшее из прогона, отписывается', () => {
  const on = ref(true)
  const value = ref(1)

  const view = computed(function view() {
    return on() ? value() : 0
  })

  expect(view()).toBe(1)
  expect(value.node.subs).not.toBeUndefined()

  on(false)
  flush()
  expect(view()).toBe(0)
  expect(depsOf(view)).toEqual([on.node])
  expect(value.node.subs).toBeUndefined()
})
