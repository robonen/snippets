// Property-гейт сливаемого текста.
//
// PRINCIPLES, правило 2: «для всего, что имеет инварианты, — property-тесты, а
// не только примеры». У текста инвариантов четыре, и все четыре ломаются на
// входах, которых в примерах не бывает: round-trip записи, эквивалентность
// `write` обычному срезу строки, обратимость каретки и сходимость реплик.
//
// Набор из docs/04 §6 поднят на уровень ОПЕРАЦИЙ МОДЕЛИ, а не сырых юнитов —
// это буквальное исполнение наблюдения PRINCIPLES про второго потребителя:
// набор, написанный из тех же предположений, что и код, целый класс ошибок не
// видит.

import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { Paper } from './paper'
import { born, deliver, stand, type Stand } from './shelf-stand'

/**
 * Алфавит намеренно злой: экзотические пробелы, диакритика, суррогатные пары,
 * переводы строк и пунктуация вперемешку. Обычный `fc.string()` не породил бы
 * ни одного составного эмодзи и ни одного абзаца.
 */
const PIECES = fc.constantFrom(
  'a', 'B', '1', ' ', '  ', '\n', '\r\n', '\t', '.', '-', '(', ')',
  'раз', 'Два', 'ЕЩЁ', ' ', ' ', ' ',
  '\u{1f600}', '\u{1f469}\u{1f3ff}‍\u{1f91d}‍\u{1f9d1}\u{1f3ff}', 'Е́',
)

const text = (max = 10): fc.Arbitrary<string> =>
  fc.array(PIECES, { maxLength: max }).map(parts => parts.join(''))

/** Без астральных символов: там срез строки режет суррогатную пару, и `write` его правит. */
const flat = (max = 10): fc.Arbitrary<string> =>
  fc.array(
    fc.constantFrom('a', 'B', '1', ' ', '  ', '\n', '.', '-', 'раз', 'Два', '\t'),
    { maxLength: max },
  ).map(parts => parts.join(''))

describe('текст: round-trip записи', () => {
  test('что записали — то и прочитали, на любой строке', () => {
    fc.assert(
      fc.property(text(14), value => {
        const at = stand()
        const paper = at.space.root(Paper)
        paper.body(value)
        expect(paper.body()).toBe(value)
        // Токены и абзацы — два разложения ТОГО ЖЕ текста, а не его пересказ.
        expect(paper.body.tokens().join('')).toBe(value)
        expect(paper.body.paragraphs().join('')).toBe(value)
        expect(paper.body.size()).toBe(value.length)
      }),
      { numRuns: 300 },
    )
  })

  test('серия записей сходится к последней', () => {
    fc.assert(
      fc.property(fc.array(text(8), { minLength: 1, maxLength: 6 }), values => {
        const at = stand()
        const paper = at.space.root(Paper)
        for (const value of values) paper.body(value)
        expect(paper.body()).toBe(values[values.length - 1])
      }),
      { numRuns: 200 },
    )
  })

  test('повторная запись того же значения не рождает юнитов', () => {
    fc.assert(
      fc.property(text(10), value => {
        const at = stand()
        const paper = at.space.root(Paper)
        paper.body(value)
        expect(born(at, () => paper.body(value))).toBe(0)
        expect(born(at, () => paper.body(paper.body()))).toBe(0)
      }),
      { numRuns: 200 },
    )
  })
})

describe('текст: write равен срезу строки', () => {
  test('`write(next, from, to)` даёт `s.slice(0,from) + next + s.slice(to)`', () => {
    fc.assert(
      fc.property(flat(12), flat(4), fc.nat(40), fc.nat(40), (base, patch, a, b) => {
        const from = Math.min(a, b)
        const to = Math.max(a, b)

        const at = stand()
        const paper = at.space.root(Paper)
        paper.body(base)
        paper.body.write(patch, from, to)

        const cutFrom = Math.min(from, base.length)
        const cutTo = Math.min(to, base.length)
        expect(paper.body()).toBe(base.slice(0, cutFrom) + patch + base.slice(cutTo))
      }),
      { numRuns: 500 },
    )
  })

  test('серия правок диапазона равна той же серии над обычной строкой', () => {
    fc.assert(
      fc.property(
        flat(10),
        fc.array(fc.tuple(flat(3), fc.nat(30), fc.nat(30)), { maxLength: 6 }),
        (base, edits) => {
          const at = stand()
          const paper = at.space.root(Paper)
          paper.body(base)

          let mirror = base
          for (const [patch, a, b] of edits) {
            const from = Math.min(Math.min(a, b), mirror.length)
            const to = Math.min(Math.max(a, b), mirror.length)
            paper.body.write(patch, from, to)
            mirror = mirror.slice(0, from) + patch + mirror.slice(to)
          }

          expect(paper.body()).toBe(mirror)
        },
      ),
      { numRuns: 300 },
    )
  })
})

describe('текст: каретка обратима', () => {
  test('`offsetAt(pointAt(off)) === off` для каждого смещения текста', () => {
    // Именно этот инвариант ломает сдвиг на единицу в границе токена: он не
    // ловится ни одним merge-тестом и проявляется как прыжок курсора через
    // слово (docs/05 §3.10).
    fc.assert(
      fc.property(text(10), value => {
        const at = stand()
        const paper = at.space.root(Paper)
        paper.body(value)

        for (let off = 0; off <= value.length; off++) {
          const point = paper.body.pointAt(off)
          if (value.length === 0) {
            expect(point.found).toBe(false)
            continue
          }
          expect(point.found).toBe(true)
          if (!point.found) return
          expect(paper.body.offsetAt(point.caret)).toBe(off)
        }
      }),
      { numRuns: 200 },
    )
  })

  test('за концом текста каретки нет, есть остаток', () => {
    fc.assert(
      fc.property(text(8), fc.integer({ min: 1, max: 20 }), (value, over) => {
        const at = stand()
        const paper = at.space.root(Paper)
        paper.body(value)

        const point = paper.body.pointAt(value.length + over)
        expect(point.found).toBe(false)
        if (point.found) return
        expect(point.rest).toBe(over)
      }),
      { numRuns: 200 },
    )
  })
})

describe('текст: сходимость реплик', () => {
  type Step =
    | { readonly kind: 'set'; readonly at: 0 | 1; readonly value: string }
    | { readonly kind: 'write'; readonly at: 0 | 1; readonly value: string; readonly from: number; readonly to: number }
    | { readonly kind: 'deliver'; readonly at: 0 | 1 }
    | { readonly kind: 'tick'; readonly at: 0 | 1 }

  const step: fc.Arbitrary<Step> = fc.oneof(
    fc.record({ kind: fc.constant('set' as const), at: fc.constantFrom(0 as const, 1 as const), value: flat(6) }),
    fc.record({
      kind: fc.constant('write' as const),
      at: fc.constantFrom(0 as const, 1 as const),
      value: flat(2),
      from: fc.nat(20),
      to: fc.nat(20),
    }),
    fc.record({ kind: fc.constant('deliver' as const), at: fc.constantFrom(0 as const, 1 as const) }),
    fc.record({ kind: fc.constant('tick' as const), at: fc.constantFrom(0 as const, 1 as const) }),
  )

  test('случайные операции МОДЕЛИ и случайное расписание доставки сходятся', () => {
    fc.assert(
      fc.property(fc.array(step, { maxLength: 16 }), steps => {
        const sides: readonly [Stand, Stand] = [stand(0x11, 1000), stand(0x22, 1000)]
        const papers = [sides[0].space.root(Paper), sides[1].space.root(Paper)] as const

        for (const one of steps) {
          const paper = papers[one.at]
          if (one.kind === 'set') paper.body(one.value)
          else if (one.kind === 'write') {
            paper.body.write(one.value, Math.min(one.from, one.to), Math.max(one.from, one.to))
          } else if (one.kind === 'tick') sides[one.at].clock.advance(1)
          else deliver(sides[one.at], sides[one.at === 0 ? 1 : 0])
        }

        // Доставка до неподвижной точки: приём монотонен по решётке LWW.
        for (let pass = 0; pass < 6; pass++) {
          deliver(sides[0], sides[1])
          deliver(sides[1], sides[0])
        }

        const left = papers[0].body()
        const right = papers[1].body()
        expect(left).toBe(right)
        // Сходимость без чтения — не сходимость: токены и абзацы обязаны
        // совпасть тоже, иначе реплики согласны про строку и не согласны про то,
        // где в ней границы правок.
        expect(papers[0].body.tokens()).toEqual(papers[1].body.tokens())
        expect(papers[0].body.paragraphs()).toEqual(papers[1].body.paragraphs())
      }),
      { numRuns: 120 },
    )
  })

  test('доставка идемпотентна: повтор пачки ничего не меняет', () => {
    fc.assert(
      fc.property(flat(10), flat(10), (one, two) => {
        const left = stand(0x11, 1000)
        const right = stand(0x22, 1000)
        left.space.root(Paper).body(one)
        right.space.root(Paper).body(two)

        deliver(left, right)
        deliver(right, left)
        const settled = left.space.root(Paper).body()
        const size = left.land.size()

        deliver(left, right)
        deliver(left, right)
        expect(left.land.size()).toBe(size)
        expect(left.space.root(Paper).body()).toBe(settled)
      }),
      { numRuns: 150 },
    )
  })
})
