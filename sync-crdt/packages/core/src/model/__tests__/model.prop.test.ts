// Property-гейт основания слоя моделей.
//
// Три свойства, и все три — про обещания, которые примерами не проверяются:
//
// 1. `model.tamper` — чтение НИКОГДА не бросает, чем бы ни оказалось значение в
//    ленде, и на каждый испорченный юнит приходится РОВНО ОДИН `Issue` с
//    непустым контекстом. Примерный тест ловит те виды мусора, о которых автор
//    подумал; property — те, о которых не подумал.
// 2. `model.idempotent` — `x(x())` не рождает юнитов, `x(v); x(v)` рождает ровно
//    один. Без этого эхо между двумя пирами бесконечно.
// 3. `model.converge` — сходимость, поднятая на уровень ОПЕРАЦИЙ МОДЕЛИ, а не
//    сырых юнитов. Это буквальное исполнение наблюдения из PRINCIPLES про
//    второго потребителя ядра: набор, написанный из тех же предположений, что и
//    код, целого класса ошибок не видит.

import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { Link } from '../../binary/link'
import { type Vary, varyDecode, varyEncode } from '../../binary/vary'
import { fixedClock } from '../../land/clock'
import { Land } from '../../land/land'
import { ROOT, type LocalId } from '../../land/view'
import { createSpace, t, type Doc, type Issue, type Space } from '../index'
import { Note } from './blog'

const RUNS = 300

/** Потолок значения внутри юнита: 63 занято маркером выноса в `ball`. */
const INLINE_MAX = 62

function peerOf(byte: number): Link {
  const bin = new Uint8Array(8)
  bin[0] = byte
  return Link.peer(bin)
}

interface Stand {
  readonly land: Land
  readonly space: Space
  readonly issues: Issue[]
}

function stand(peer = 0x11): Stand {
  const land = new Land(peerOf(peer), fixedClock(1000))
  const issues: Issue[] = []
  const space = createSpace({ land, salt: new Uint8Array([1, 2, 3]), report: issue => issues.push(issue) })
  return { land, space, issues }
}

/**
 * Произвольное значение формата — все ветки `Vary`, кроме глубокой вложенности.
 *
 * Ограничение по размеру не эстетика: значение больше 62 байт уезжает в `ball`,
 * и это ДРУГОЙ сценарий (`Issue{kind:'shape'}`), у которого свой пример-тест.
 */
const varyArb: fc.Arbitrary<Vary> = fc.oneof(
  fc.constant(null),
  fc.boolean(),
  fc.integer({ min: -1000, max: 1000 }),
  fc.double({ noDefaultInfinity: true, noNaN: true, min: -1e6, max: 1e6 }),
  fc.bigInt({ min: -100n, max: 100n }),
  fc.string({ maxLength: 8 }),
  fc.uint8Array({ maxLength: 8 }),
  fc.date({ min: new Date(0), max: new Date(1e12), noInvalidDate: true }),
  fc.array(fc.integer({ min: 0, max: 9 }), { maxLength: 3 }),
  fc.dictionary(fc.string({ minLength: 1, maxLength: 3 }), fc.integer({ min: 0, max: 9 }), { maxKeys: 2 }),
)

const FIELDS = ['title', 'views', 'status', 'tag'] as const
type Field = (typeof FIELDS)[number]

/** Те же линзы, что в схеме `Note`, — чтобы ожидание считалось независимо. */
const LENSES = {
  title: t.string,
  views: t.int,
  status: t.enum(['draft', 'live']).or('draft'),
  tag: t.maybe(t.string),
}

const fieldArb = fc.constantFrom(...FIELDS)

/** Прочитать ВСЕ поля документа. Ни один вызов не имеет права бросить. */
function readAll(note: Doc<'note'>): Record<string, unknown> {
  return {
    title: note.title(),
    views: note.views(),
    status: note.status(),
    tag: note.tag(),
    loud: note.loud(),
  }
}

/** Заполнить одно поле законным НЕ-пустым значением: портить надо что-то. */
function seed(note: Doc<'note'>, field: Field): void {
  if (field === 'title') note.title('было')
  else if (field === 'views') note.views(1)
  else if (field === 'status') note.status('live')
  else note.tag('было')
}

/** Значение поля глазами чужого пира: номера узлов через ленды не переносятся. */
function tamper(land: Land, field: Field, raw: Vary): void {
  const slot = land.order(ROOT).find(view => view.value === field)?.self as LocalId
  const node = land.nodes(slot)[0] as LocalId
  const other = new Land(peerOf(0x99), fixedClock(2000))
  other.write(other.nodeOf(land.idOf(slot)), ROOT, other.nodeOf(land.idOf(node)), raw, 'term')
  land.apply(other.units())
}

describe('model.tamper — reads never throw', () => {
  test('an arbitrary Vary in an arbitrary field yields blank and exactly one Issue', () => {
    fc.assert(
      fc.property(fieldArb, varyArb, (field: Field, raw: Vary) => {
        fc.pre(varyEncode(raw).length <= INLINE_MAX)

        const { land, space, issues } = stand()
        const note = space.root(Note)

        seed(note, field)
        readAll(note)
        issues.length = 0

        tamper(land, field, raw)

        const seen = readAll(note)
        const lens = LENSES[field]
        // Ожидание считается от того, что РЕАЛЬНО доезжает до ленда, а не от
        // литерала: формат каноничен (ADR-008), и часть различий JS он не несёт
        // — `-0` и `+0` это одни и те же байты. Первая редакция сравнивала с
        // литералом и падала на сиде с `-0`: «expected +0 to deeply equal -0».
        // Требовать от слоя моделей различия, которого нет в байтах, — это
        // ложное ожидание, а не найденный дефект.
        const stored = varyDecode(varyEncode(raw))
        const decoded = stored === null ? null : lens.decode(stored)

        if (stored !== null && decoded === null) {
          // Мусор: значение — `blank`, и ровно один `Issue` с полным контекстом.
          expect(seen[field]).toEqual(lens.blank)
          expect(issues).toHaveLength(1)
          const issue = issues[0] as Issue
          expect(issue.kind).toBe('decode')
          expect(issue.field).toBe(field)
          expect(issue.expected).toBe(lens.name)
          expect(issue.got.length).toBeGreaterThan(0)
          expect(issue.peer).not.toBe(null)
          expect(issue.self).not.toBe(ROOT)
        } else {
          // Годное значение (или надгробие) — никаких жалоб.
          expect(issues).toHaveLength(0)
          expect(seen[field]).toEqual(stored === null ? lens.blank : decoded)
        }

        // Соседние поля не задеты вовсе: порча одного не рушит документ.
        for (const other of FIELDS) {
          if (other === field) continue
          expect(seen[other]).toEqual(LENSES[other].blank)
        }
      }),
      { numRuns: RUNS },
    )
  })
})

describe('model.idempotent — without it the echo between peers is endless', () => {
  test('x(x()) births no units, x(v); x(v) births exactly one', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 16 }), fc.integer({ min: -1e6, max: 1e6 }), (title, views) => {
        const { land, space } = stand()
        const note = space.root(Note)

        const empty = land.size()
        note.title(title)
        note.views(views)
        const written = land.size()
        expect(written).toBeGreaterThan(empty)

        note.title(title)
        note.views(views)
        expect(land.size()).toBe(written)

        for (let i = 0; i < 5; i++) {
          note.title(note.title())
          note.views(note.views())
        }
        expect(land.size()).toBe(written)
      }),
      { numRuns: RUNS },
    )
  })
})

interface Step {
  readonly peer: number
  readonly field: Field
  readonly value: number
  readonly clear: boolean
}

function step(note: Doc<'note'>, op: Step): void {
  if (op.clear) {
    if (op.field === 'title') note.title.clear()
    else if (op.field === 'views') note.views.clear()
    else if (op.field === 'status') note.status.clear()
    else note.tag.clear()
    return
  }
  if (op.field === 'title') note.title(`t${op.value}`)
  else if (op.field === 'views') note.views(op.value)
  else if (op.field === 'status') note.status(op.value % 2 === 0 ? 'draft' : 'live')
  else note.tag(op.value % 3 === 0 ? null : `g${op.value}`)
}

describe('model.converge — convergence at the level of model operations', () => {
  test('two replicas with a random schedule read the same', () => {
    const stepArb: fc.Arbitrary<Step> = fc.record({
      peer: fc.nat(1),
      field: fieldArb,
      value: fc.integer({ min: 0, max: 30 }),
      clear: fc.boolean(),
    })

    fc.assert(
      fc.property(
        fc.array(stepArb, { minLength: 1, maxLength: 24 }),
        fc.array(fc.nat(1), { maxLength: 10 }),
        (steps, sends) => {
          // Общие часы — самый злой случай: правки падают в одну секунду и
          // разводятся исключительно арбитром по `peer`.
          const clock = fixedClock(1000)
          const salt = new Uint8Array([5])
          const lands = [new Land(peerOf(0x11), clock), new Land(peerOf(0x22), clock)]
          const notes = lands.map(land => createSpace({ land, salt, report: () => {} }).root(Note))

          for (const op of steps) {
            step(notes[op.peer] as Doc<'note'>, op)
            if (op.value % 4 === 0) clock.advance(1)
          }

          // Случайные односторонние доставки посреди работы…
          for (const from of sends) {
            (lands[1 - from] as Land).apply((lands[from] as Land).units())
          }
          // …и потом до неподвижной точки: приём монотонен по решётке LWW.
          for (let round = 0; round < 8; round++) {
            const moved = (lands[0] as Land).apply((lands[1] as Land).units())
              + (lands[1] as Land).apply((lands[0] as Land).units())
            if (moved === 0) break
          }

          expect(readAll(notes[0] as Doc<'note'>)).toEqual(readAll(notes[1] as Doc<'note'>))
        },
      ),
      { numRuns: RUNS },
    )
  })
})
