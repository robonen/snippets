// Гейт корректности списка: реконсиляция, якоря, порядок операций и слияние.
//
// Порт корпуса `list.test.ts` из baza — с ИСПРАВЛЕННЫМИ ожиданиями там, где
// оригинал зафиксировал эталоном собственный дефект (реестр, пп. 29 и 38), и
// через бинарный round-trip, потому что `units_steal` слеп и к кодеку, и к
// идентичности после десериализации (реестр, п. 39; docs/05 §8.1).

import { flush, watchEffect } from '@sync/fiber'
import { describe, expect, test } from 'vitest'
import { ROOT, type LocalId } from '../../land/view'
import { coreOf } from '../index'
import { born, deliver, stand, sync, tamper, type Stand } from './shelf-stand'
import { Shelf } from './shelf'

/** Слот поля документа — то, под чем лежат элементы списка. */
function slotOf(at: Stand, field: string): LocalId {
  return coreOf(at.space).keyIndex(ROOT).get(field) as LocalId
}

/** Заготовка на четырёх числах — та же, с которой начинаются 14 кейсов baza. */
function quartet(): Stand {
  const origin = stand(0x11)
  origin.space.root(Shelf).sizes([1, 2, 3, 4])
  return origin
}

/** Реплика, получившая всё от `origin` и дальше живущая своей жизнью. */
function fork(origin: Stand, peer: number): Stand {
  const copy = stand(peer)
  deliver(copy, origin)
  return copy
}

describe('список: операции и порядок', () => {
  test('непрочитанное поле — пустой массив, а не null и не undefined', () => {
    const { space } = stand()
    expect(space.root(Shelf).tags()).toEqual([])
    expect(space.root(Shelf).sizes()).toEqual([])
  })

  test('push кладёт в КОНЕЦ, unshift — в НАЧАЛО', () => {
    // Регрессия против baza: там `add` постил с `lead = hole`, то есть в начало,
    // а `splice` в том же классе дописывал в конец — две противоположные
    // семантики без единого слова в документации (реестр, п. 29).
    const shelf = stand().space.root(Shelf)
    shelf.tags(['b', 'c'])
    shelf.tags.push('d')
    expect(shelf.tags()).toEqual(['b', 'c', 'd'])
    shelf.tags.unshift('a')
    expect(shelf.tags()).toEqual(['a', 'b', 'c', 'd'])
  })

  test('insert, removeAt, remove, move, clear', () => {
    const shelf = stand().space.root(Shelf)
    shelf.tags(['a', 'b', 'c', 'd'])

    shelf.tags.insert(2, 'x')
    expect(shelf.tags()).toEqual(['a', 'b', 'x', 'c', 'd'])

    shelf.tags.removeAt(2)
    expect(shelf.tags()).toEqual(['a', 'b', 'c', 'd'])

    shelf.tags.remove('c')
    expect(shelf.tags()).toEqual(['a', 'b', 'd'])

    shelf.tags.move(0, 2)
    expect(shelf.tags()).toEqual(['b', 'a', 'd'])

    shelf.tags.clear()
    expect(shelf.tags()).toEqual([])
    expect(shelf.tags.size()).toBe(0)
  })

  test('remove убирает ВСЕ вхождения — после него has() обязан быть false', () => {
    const shelf = stand().space.root(Shelf)
    shelf.tags(['a', 'b', 'a', 'c', 'a'])
    shelf.tags.remove('a')
    expect(shelf.tags()).toEqual(['b', 'c'])
    expect(shelf.tags.has('a')).toBe(false)
  })

  test('at, size, has', () => {
    const shelf = stand().space.root(Shelf)
    shelf.tags(['vue', 'crdt'])
    expect(shelf.tags.at(0)).toBe('vue')
    expect(shelf.tags.at(-1)).toBe('crdt')
    expect(shelf.tags.at(7)).toBe(null)
    expect(shelf.tags.size()).toBe(2)
    expect(shelf.tags.has('crdt')).toBe(true)
    expect(shelf.tags.has('нет')).toBe(false)
  })

  test('splice по умолчанию дописывает в конец, с границами — заменяет отрезок', () => {
    const shelf = stand().space.root(Shelf)
    shelf.sizes([1, 2, 3])
    shelf.sizes.splice([9])
    expect(shelf.sizes()).toEqual([1, 2, 3, 9])
    shelf.sizes.splice([7, 8], 0, 2)
    expect(shelf.sizes()).toEqual([7, 8, 3, 9])
  })

  test('has не бросает на значении, которое линза даже не кодирует', () => {
    // `has` — это ВОПРОС, и единственный честный ответ на «есть ли в списке
    // значение, которое туда не кладётся» — «нет». Бросать имеет право запись.
    const shelf = stand().space.root(Shelf)
    shelf.mails(['anya@example.org'])
    expect(shelf.mails.has('не почта')).toBe(false)
    expect(() => shelf.mails(['не почта'])).toThrow()
  })

  test('отказ линзы не оставляет за собой ПОЛОВИНУ списка', () => {
    const at = stand()
    const shelf = at.space.root(Shelf)
    const before = at.land.size()
    expect(() => shelf.mails(['a@b', 'мимо', 'c@d'])).toThrow()
    expect(at.land.size()).toBe(before)
    expect(shelf.mails()).toEqual([])
  })
})

describe('список: реконсиляция — счётчиком, а не глазами', () => {
  test('поменял ОДИН элемент — родился РОВНО ОДИН юнит', () => {
    // Требование DoD стадии (docs/05 §2.3 и §8.5, `list/reconcile-1000`).
    const at = stand()
    const shelf = at.space.root(Shelf)
    shelf.tags(['vue', 'crdt', 'draft'])

    const units = born(at, () => {
      shelf.tags(shelf.tags().map(tag => (tag === 'draft' ? 'ready' : tag)))
    })

    expect(units).toBe(1)
    expect(shelf.tags()).toEqual(['vue', 'crdt', 'ready'])
  })

  test('идемпотентная запись — НОЛЬ юнитов', () => {
    const at = stand()
    const shelf = at.space.root(Shelf)
    shelf.tags(['vue', 'crdt'])
    expect(born(at, () => shelf.tags(shelf.tags()))).toBe(0)
    expect(born(at, () => shelf.tags.set(['vue', 'crdt']))).toBe(0)
  })

  test('замена сохраняет ПОДДЕРЕВО элемента: тот же self, другое значение', () => {
    // Именно на этом стоит переименование ключа словаря (docs/05 §3.8).
    const at = stand()
    const core = coreOf(at.space)
    const shelf = at.space.root(Shelf)
    shelf.tags(['a', 'b'])

    const slot = slotOf(at, 'tags')
    const before = core.order(slot).map(view => view.self)
    // Ребёнок первого элемента — он и обязан пережить замену значения.
    core.post(before[0] as LocalId, ROOT as LocalId, at.land.nodeAt(0xbeef), 'вложенное', 'term')
    flush()

    shelf.tags(['A', 'b'])
    const after = core.order(slot).map(view => view.self)
    expect(after).toEqual(before)
    expect(core.order(before[0] as LocalId).map(view => view.value)).toEqual(['вложенное'])
  })

  test('вставка тождественного соседа НЕ схлопывается: занятый адрес пропускается', () => {
    // ОЖИДАНИЕ ИСПРАВЛЕНО вместе с `predictItem`. Прежняя редакция этого теста
    // фиксировала эталоном то, что `insert(1, 'b')` в `['a', 'b']` ничего не
    // делает: адрес `H(соль ‖ head ‖ lead ‖ значение)` совпадал с адресом уже
    // стоящего за тем же якорем 'b', и `post` переклеивал ЕГО вместо рождения
    // второго. Это не цена контентного адреса, а потеря записи — у baza тот же
    // адрес считается СИДОМ, а `self_make` крутит `if (_self_all.has(idea))
    // continue` до свободного (реестр, п. 32). Пропуск занятого живого узла
    // добавлен в `address.ts`.
    //
    // Схлопывание одинаковых КОНКУРЕНТНЫХ вставок при этом цело: две реплики с
    // одним состоянием видят одну и ту же занятость, делают один и тот же
    // пропуск и приходят к одному адресу.
    const shelf = stand().space.root(Shelf)
    shelf.tags(['a', 'b'])
    shelf.tags.insert(1, 'b')
    expect(shelf.tags()).toEqual(['a', 'b', 'b'])

    // Разные якоря — разные узлы, и дубли живут спокойно.
    shelf.tags(['x', 'x', 'x'])
    expect(shelf.tags()).toEqual(['x', 'x', 'x'])
  })

  test('«Insert before removed before changed» — приоритет ветвей', () => {
    // Порт baza как есть: смена приоритета ветвей ломает именно этот кейс.
    const shelf = stand().space.root(Shelf)
    shelf.tags(['foo', 'bar'])
    shelf.tags(['xxx', 'foo', 'bar'])
    shelf.tags(['xxx', 'bars'])
    expect(shelf.tags()).toEqual(['xxx', 'bars'])
  })

  test('«Many moves» — серия перестановок', () => {
    const shelf = stand().space.root(Shelf)
    shelf.tags(['foo', 'bar', 'lol'])
    shelf.tags.move(2, 1)
    shelf.tags.move(2, 1)
    shelf.tags.move(0, 3)
    shelf.tags.move(2, 1)
    expect(shelf.tags()).toEqual(['bar', 'foo', 'lol'])
  })

  test('«Reorder separated sublists» — две независимые перестановки', () => {
    const shelf = stand().space.root(Shelf)
    shelf.sizes([1, 2, 3, 4, 5, 6])

    shelf.sizes.move(3, 5)
    shelf.sizes.move(3, 5)
    shelf.sizes.move(5, 4)

    shelf.sizes.move(0, 2)
    shelf.sizes.move(0, 2)
    shelf.sizes.move(2, 1)

    expect(shelf.sizes()).toEqual([1, 3, 2, 4, 6, 5])
  })

  test('запись НЕ реентерантна: сеттер не перевычисляет канал изнутри себя', () => {
    // У baza `items_vary` заканчивался на `return this.items_vary()` — канал
    // считался из самого себя (реестр, п. 37). Здесь значение приходит обычным
    // распространением, поэтому эффект перезапускается ровно один раз на правку,
    // а не уходит в рекурсию.
    const at = stand()
    const shelf = at.space.root(Shelf)
    shelf.tags(['a'])

    let runs = 0
    const seen: string[][] = []
    const stop = watchEffect(() => {
      runs += 1
      seen.push([...shelf.tags()])
    })
    expect(runs).toBe(1)

    shelf.tags(['a', 'b'])
    flush()
    expect(runs).toBe(2)
    expect(seen[1]).toEqual(['a', 'b'])

    // Второе подряд значение обязано ДОЕХАТЬ: сигнал состава детей бьётся на
    // каждую смену победителя, а не только на первую (реестр, п. 43).
    shelf.tags(['a', 'c'])
    flush()
    expect(runs).toBe(3)
    expect(shelf.tags()).toEqual(['a', 'c'])
    stop()
  })
})

describe('список: мусор от чужой версии', () => {
  test('чтение не бросает, негодный элемент даёт Issue и пропускается', () => {
    const at = stand()
    const shelf = at.space.root(Shelf)
    shelf.tags(['a', 'b'])

    // Чужой пир кладёт в список число там, где схема ждёт строку. Юнит едет
    // через байты и собирается заново — как приехал бы по проводу (§8.1).
    tamper(at, slotOf(at, 'tags'), 42)

    expect(() => shelf.tags()).not.toThrow()
    expect(shelf.tags()).toEqual(['a', 'b'])
    // Позиции считаются по ленду, а не по прочитанному: иначе один
    // недобросовестный пир сдвигал бы индексы всем остальным.
    expect(shelf.tags.size()).toBe(3)
    expect(at.issues.map(issue => issue.kind)).toContain('decode')
    expect(shelf.tags.issue()?.field).toBe('tags')
  })
})

describe('список: слияние двух реплик', () => {
  test('одинаковые вставки схлопываются, разные — расходятся', () => {
    const left = stand(0x22)
    const right = stand(0x33)
    left.space.root(Shelf).tags(['foo', 'xxx'])
    right.space.root(Shelf).tags(['foo', 'yyy'])
    sync(left, right)

    const seenLeft = left.space.root(Shelf).tags()
    const seenRight = right.space.root(Shelf).tags()
    expect(seenLeft).toEqual(seenRight)
    // 'foo' у обеих реплик получил ОДИН адрес: контентный `self` и есть
    // бесплатная дедупликация конкурентных вставок (docs/05 §3.6).
    expect(seenLeft.filter(tag => tag === 'foo')).toHaveLength(1)
    expect(seenLeft).toContain('xxx')
    expect(seenLeft).toContain('yyy')
  })

  test('«Insert after wiped» — надгробие остаётся якорем', () => {
    const origin = quartet()
    const left = fork(origin, 0x22)
    const right = fork(origin, 0x33)

    left.space.root(Shelf).sizes([1, 3, 4])
    right.clock.advance(2)
    right.space.root(Shelf).sizes([1, 2, 7, 3, 4])

    sync(left, right)
    expect(left.space.root(Shelf).sizes()).toEqual([1, 7, 3, 4])
    expect(right.space.root(Shelf).sizes()).toEqual([1, 7, 3, 4])
  })

  test('«Wiped before inserted» — тот же итог при обратном порядке правок', () => {
    const origin = quartet()
    const left = fork(origin, 0x22)
    const right = fork(origin, 0x33)

    left.space.root(Shelf).sizes([1, 2, 7, 3, 4])
    right.clock.advance(2)
    right.space.root(Shelf).sizes([1, 3, 4])

    sync(left, right)
    expect(left.space.root(Shelf).sizes()).toEqual([1, 7, 3, 4])
    expect(right.space.root(Shelf).sizes()).toEqual([1, 7, 3, 4])
  })

  test('«Insert before wiped» — удалённый сосед не утаскивает вставку', () => {
    const origin = quartet()
    const left = fork(origin, 0x22)
    const right = fork(origin, 0x33)

    left.space.root(Shelf).sizes.removeAt(2)
    right.clock.advance(2)
    right.space.root(Shelf).sizes([1, 2, 7, 3, 4])

    sync(left, right)
    expect(left.space.root(Shelf).sizes()).toEqual([1, 2, 7, 4])
    expect(right.space.root(Shelf).sizes()).toEqual([1, 2, 7, 4])
  })

  test('«Wiped after inserted» — реплики сходятся и ничего не теряют', () => {
    const { left, right } = wipedAfterInserted()
    const seen = left.space.root(Shelf).sizes()
    expect(right.space.root(Shelf).sizes()).toEqual(seen)
    expect([...seen].sort((a, b) => a - b)).toEqual([1, 2, 4, 7])
  })

  /**
   * ИЗВЕСТНЫЙ ДЕФЕКТ ОСНОВАНИЯ (S3), а не этого слоя. Красная строка с понятой
   * причиной честнее зелёной, полученной подгонкой (PRINCIPLES).
   *
   * Ранг узла среди сиблингов, делящих один `lead`, определяется меткой его
   * ПОБЕДИТЕЛЯ (`graph.ts`, `#push` → `cmpAt`), а не меткой ВСТАВКИ. Надгробие —
   * это новая версия узла со свежей меткой, поэтому удаление элемента
   * ПЕРЕУПОРЯДОЧИВАЕТ его живых соседей: здесь надгробие «3» (t = 1002) обгоняет
   * конкурентно вставленную «7» (t = 1001), и «4», висящая на «3», уезжает
   * вперёд неё — [1,2,4,7] вместо [1,2,7,4].
   *
   * Слой моделей закрыть это не может: метка ставится лендом на каждую запись, а
   * позиция и значение едут в одном юните. Зеркальный кейс «Insert before wiped»
   * зелёный ровно потому, что там надгробие СТАРШЕ вставки.
   *
   * Лечится в S3 — рангом по метке первой версии узла, а не победителя.
   */
  test.fails('«Wiped after inserted» — надгробие не должно переупорядочивать соседей', () => {
    const { left, right } = wipedAfterInserted()
    expect(left.space.root(Shelf).sizes()).toEqual([1, 2, 7, 4])
    expect(right.space.root(Shelf).sizes()).toEqual([1, 2, 7, 4])
  })

  function wipedAfterInserted(): { readonly left: Stand; readonly right: Stand } {
    const origin = quartet()
    const left = fork(origin, 0x22)
    const right = fork(origin, 0x33)

    left.space.root(Shelf).sizes([1, 2, 7, 3, 4])
    right.clock.advance(2)
    right.space.root(Shelf).sizes.removeAt(2)

    sync(left, right)
    return { left, right }
  }

  test('«Insert before changed» / «Change after inserted» — обе реплики сходятся', () => {
    const origin = quartet()
    const left = fork(origin, 0x22)
    const right = fork(origin, 0x33)

    left.space.root(Shelf).sizes([1, 2, 7, 4])
    right.clock.advance(2)
    right.space.root(Shelf).sizes([1, 2, 13, 3, 4])

    sync(left, right)
    expect(left.space.root(Shelf).sizes()).toEqual([1, 2, 13, 7, 4])
    expect(right.space.root(Shelf).sizes()).toEqual([1, 2, 13, 7, 4])
  })

  test('вставка рядом с перестановкой — реплики сходятся в обе стороны', () => {
    const origin = quartet()
    const left = fork(origin, 0x22)
    const right = fork(origin, 0x33)

    left.space.root(Shelf).sizes([1, 7, 2, 3, 4])
    right.clock.advance(2)
    right.space.root(Shelf).sizes.move(0, 2)

    sync(left, right)
    const seen = left.space.root(Shelf).sizes()
    expect(right.space.root(Shelf).sizes()).toEqual(seen)
    // Ни один живой элемент не потерялся — кольцо из конкурентных `move`
    // разбирается сиротами в `order()`, а не молчаливой потерей.
    expect([...seen].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 7])
  })

  test('порядок доставки не влияет на итог', () => {
    const origin = quartet()
    const left = fork(origin, 0x22)
    const right = fork(origin, 0x33)
    left.space.root(Shelf).sizes([1, 2, 9, 3, 4])
    right.clock.advance(2)
    right.space.root(Shelf).sizes([1, 2, 3, 8])

    deliver(left, right)
    deliver(right, left)
    const first = left.space.root(Shelf).sizes()
    expect(right.space.root(Shelf).sizes()).toEqual(first)

    const back = quartet()
    const one = fork(back, 0x22)
    const two = fork(back, 0x33)
    one.space.root(Shelf).sizes([1, 2, 9, 3, 4])
    two.clock.advance(2)
    two.space.root(Shelf).sizes([1, 2, 3, 8])

    deliver(one, two)
    deliver(two, one)
    expect(one.space.root(Shelf).sizes()).toEqual(first)
  })
})
