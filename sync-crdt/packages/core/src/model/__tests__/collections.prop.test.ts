// Property-гейт коллекций.
//
// Четыре свойства, и все четыре — про обещания, которые примерами не
// проверяются:
//
// 1. `reconcile.equal` — эквивалентность боевой реконсиляции и референсной
//    (`reconcile-naive.ts`): совпадают и содержимое, и число юнитов, и
//    ПОСЛЕДОВАТЕЛЬНОСТЬ `self`. Последнее и есть предмет: якорь протягивается
//    через уже сделанные записи, и ошибка в нём выглядит как правильный список,
//    собранный из вдвое большего числа юнитов.
// 2. `reconcile.minimal` — «поменял k позиций — родилось ровно k юнитов». Это
//    требование DoD стадии, поднятое с одного примера до произвольных массивов.
// 3. `collections.idempotent` — `x(x())` и `x(k, x(k))` не рождают юнитов.
//    Без этого эхо между двумя пирами бесконечно.
// 4. `collections.converge` — две реплики, случайные операции МОДЕЛИ, случайное
//    расписание доставки → одинаковое чтение. Набор, написанный из тех же
//    предположений, что и код, целого класса ошибок не видит (PRINCIPLES).

import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import type { Vary } from '../../binary/vary'
import { ROOT, type LocalId, type SandView } from '../../land/view'
import { coreOf } from '../index'
import { reconcile } from '../list'
import { reconcileNaive } from './reconcile-naive'
import { born, deliver, stand, sync, type Stand } from './shelf-stand'
import { Shelf } from './shelf'

const RUNS = 200

/** Короткий алфавит: повторы значений — самый интересный вход реконсиляции. */
const itemArb = fc.constantFrom('a', 'b', 'c', 'd', 'e')
const listArb = fc.array(itemArb, { minLength: 0, maxLength: 8 })

function slotOf(at: Stand, field: string): LocalId | undefined {
  return coreOf(at.space).keyIndex(ROOT).get(field)
}

describe('reconcile против референсной реализации', () => {
  test('содержимое, число юнитов и порядок self совпадают с наивным планом', () => {
    fc.assert(
      fc.property(listArb, listArb, fc.nat(8), fc.nat(8), (prev, next, a, b) => {
        const at = stand()
        const shelf = at.space.root(Shelf)
        // Стартовое состояние ставится через тот же канал: референс сравнивает
        // ПРАВКУ, а не способ завести список.
        shelf.tags(prev)

        const core = coreOf(at.space)
        const slot = slotOf(at, 'tags')
        if (slot === undefined) {
          // Пустой список поля не заводит вовсе — сравнивать нечего.
          expect(prev).toEqual([])
          return
        }

        const kids = core.order(slot)
        const from = Math.min(a, kids.length)
        const to = Math.max(from, Math.min(b, kids.length))
        const raw = next as readonly Vary[]

        const plan = reconcileNaive(core, slot, kids, raw, from, to)

        // СХЛОПЫВАНИЕ КОНТЕНТНОГО АДРЕСА — отдельный сценарий, и у него свой
        // пример-тест. `self` элемента считается как `H(соль ‖ head ‖ lead ‖
        // значение)` (формула baza, сохранённая docs/05 §3.6 намеренно), поэтому
        // вставка значения, тождественного тому, что уже стоит за тем же якорем,
        // попадает в ТОТ ЖЕ узел. Для слияния одинаковых вставок это и есть
        // смысл формулы; для локальной правки — вырожденный случай, который
        // референс не моделирует и моделировать не должен.
        const clash = plan.posts.some(
          post => post.kind === 'insert' && at.land.peek(post.self) !== null,
        )
        if (clash) return

        const units = born(at, () => {
          reconcile(core, slot, kids, raw, from, to)
        })

        expect(units).toBe(plan.posts.length)
        expect(shelf.tags()).toEqual(plan.values)
        expect(core.order(slot).map((view: SandView) => view.self)).toEqual(plan.selves)
      }),
      { numRuns: RUNS },
    )
  })

  test('поменял k позиций — родилось ровно k юнитов', () => {
    fc.assert(
      fc.property(
        fc.array(itemArb, { minLength: 1, maxLength: 8 }),
        fc.array(fc.boolean(), { minLength: 1, maxLength: 8 }),
        (base, mask) => {
          const at = stand()
          const shelf = at.space.root(Shelf)
          shelf.tags(base)

          // Правка ТОЙ ЖЕ длины: каждая помеченная позиция получает значение,
          // которого там точно не было, остальные не трогаются.
          let changed = 0
          const next = base.map((value, i) => {
            if (mask[i % mask.length] !== true) return value
            changed += 1
            return `${value}!`
          })

          const units = born(at, () => shelf.tags(next))
          expect(units).toBe(changed)
          expect(shelf.tags()).toEqual(next)
        },
      ),
      { numRuns: RUNS },
    )
  })
})

describe('идемпотентность', () => {
  test('x(x()) и x(k, x(k)) не рождают юнитов', () => {
    fc.assert(
      fc.property(listArb, fc.integer({ min: -50, max: 50 }), (items, count) => {
        const at = stand()
        const shelf = at.space.root(Shelf)
        shelf.tags(items)
        shelf.counts('n', count)

        expect(born(at, () => shelf.tags(shelf.tags()))).toBe(0)
        expect(born(at, () => shelf.counts('n', shelf.counts('n')))).toBe(0)
        expect(born(at, () => shelf.cards('c1'))).toBeLessThanOrEqual(2)
        expect(born(at, () => shelf.cards('c1'))).toBe(0)
      }),
      { numRuns: RUNS },
    )
  })
})

describe('сходимость на операциях модели', () => {
  test('две реплики со случайными правками читают одинаково', () => {
    const opArb = fc.oneof(
      fc.record({ kind: fc.constant('write' as const), items: listArb }),
      fc.record({ kind: fc.constant('push' as const), item: itemArb }),
      fc.record({ kind: fc.constant('unshift' as const), item: itemArb }),
      fc.record({ kind: fc.constant('remove' as const), item: itemArb }),
      fc.record({ kind: fc.constant('key' as const), key: itemArb, value: fc.nat(9) }),
      fc.record({ kind: fc.constant('drop' as const), key: itemArb }),
    )

    fc.assert(
      fc.property(
        fc.array(opArb, { minLength: 1, maxLength: 6 }),
        fc.array(opArb, { minLength: 1, maxLength: 6 }),
        fc.array(fc.boolean(), { minLength: 1, maxLength: 6 }),
        (mine, yours, schedule) => {
          const left = stand(0x22)
          const right = stand(0x33)
          const seed = ['a', 'b', 'c']
          left.space.root(Shelf).tags(seed)
          deliver(right, left)

          const apply = (at: Stand, ops: readonly (typeof mine)[number][]): void => {
            const shelf = at.space.root(Shelf)
            for (const op of ops) {
              if (op.kind === 'write') shelf.tags(op.items)
              else if (op.kind === 'push') shelf.tags.push(op.item)
              else if (op.kind === 'unshift') shelf.tags.unshift(op.item)
              else if (op.kind === 'remove') shelf.tags.remove(op.item)
              else if (op.kind === 'key') shelf.counts(op.key, op.value)
              else shelf.counts.delete(op.key)
            }
          }

          // Расписание доставки: часть правок уезжает по ходу, часть — в конце.
          for (let i = 0; i < schedule.length; i++) {
            apply(left, mine.slice(i, i + 1))
            apply(right, yours.slice(i, i + 1))
            if (schedule[i] === true) deliver(right, left)
          }
          apply(left, mine.slice(schedule.length))
          apply(right, yours.slice(schedule.length))

          // До сходимости: доставка в обе стороны, пока обмен что-то меняет.
          sync(left, right)
          sync(left, right)

          expect(left.space.root(Shelf).tags()).toEqual(right.space.root(Shelf).tags())
          expect(left.space.root(Shelf).counts.keys()).toEqual(right.space.root(Shelf).counts.keys())
          for (const key of left.space.root(Shelf).counts.keys()) {
            expect(left.space.root(Shelf).counts(key as string))
              .toBe(right.space.root(Shelf).counts(key as string))
          }
        },
      ),
      { numRuns: RUNS },
    )
  })
})
