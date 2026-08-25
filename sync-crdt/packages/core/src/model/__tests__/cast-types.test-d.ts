// Тесты ТИПОВ для ссылок, частей и `cast` — часть набора, а не бонус.
//
// Требование 4 из docs/05: неправильный код НЕ КОМПИЛИРУЕТСЯ. Здесь это
// проверяется в обе стороны: правильное собирается без единой аннотации, а на
// каждое неправильное стоит `@ts-expect-error` — неиспользованная директива сама
// даёт TS2578, поэтому «проверка не сработала» тут невозможна.

import { expectTypeOf, test } from 'vitest'
import type { Link } from '../../binary/link'
import { cast } from '../cast'
import { atom, dict, links, list, t, type Doc } from '../index'
import { Author, Gauge, Meter, Note } from './refs'
import { createSpace } from '../index'
import { fixedClock } from '../../land/clock'
import { Land } from '../../land/land'

declare const note: Doc<'ref-note'>
declare const author: Doc<'ref-author'>

const AS_LIST = list(t.string)
const AS_DICT = dict(t.string, t.maybe(t.string))
const AS_REF = atom(t.maybe(t.link))
const AS_REFS = links('ref-author')

test('link, part, and multi-link are inferred without annotations', () => {
  expectTypeOf(note.author()).toEqualTypeOf<Doc<'ref-author'> | null>()
  expectTypeOf(note.author.ensure()).toEqualTypeOf<Doc<'ref-author'>>()
  expectTypeOf(note.editors()).toEqualTypeOf<readonly Doc<'ref-author'>[]>()
  expectTypeOf(note.editors.at(0)).toEqualTypeOf<Doc<'ref-author'> | null>()
  expectTypeOf(note.editors.attach()).toEqualTypeOf<Doc<'ref-author'>>()
  // Вложенная часть есть ВСЕГДА — `null` в её типе нет вовсе.
  expectTypeOf(note.stats()).toEqualTypeOf<Doc<'ref-meter'>>()
  expectTypeOf(note.stats().views()).toEqualTypeOf<number>()

  // Взаимная рекурсия разворачивается в обе стороны и не упирается в лимит.
  expectTypeOf(author.notes()[0]!.author()!.notes()[0]!.title()).toEqualTypeOf<string>()

  // Ни одного `any` по каждому виду поля.
  expectTypeOf(note.author).not.toBeAny()
  expectTypeOf(note.editors).not.toBeAny()
  expectTypeOf(note.stats).not.toBeAny()
})

test('cast infers the channel from the spec and the document from the model', () => {
  expectTypeOf(cast(note.body, AS_LIST)()).toEqualTypeOf<readonly string[]>()
  expectTypeOf(cast(note.marks, AS_LIST).at(0)).toEqualTypeOf<string | null>()
  expectTypeOf(cast(note.author, AS_REF)()).toEqualTypeOf<Link | null>()
  expectTypeOf(cast(note.author, AS_REFS)()).toEqualTypeOf<readonly Doc<'ref-author'>[]>()
  expectTypeOf(cast(note.tags, AS_DICT).keys()).toEqualTypeOf<readonly string[]>()

  // Модель — объектом и именем, оба дают документ этой модели.
  expectTypeOf(cast(note.stats, Gauge)).toEqualTypeOf<Doc<'ref-gauge'>>()
  expectTypeOf(cast(note.stats, 'ref-meter')).toEqualTypeOf<Doc<'ref-meter'>>()
  expectTypeOf(cast(note.stats, Meter).views()).toEqualTypeOf<number>()

  // Документ целиком тоже переводится: `Doc` несёт `$`, а `$` — ручку.
  expectTypeOf(cast(note.stats(), AS_DICT).keys()).toEqualTypeOf<readonly string[]>()
  expectTypeOf(cast(note, Gauge)).toEqualTypeOf<Doc<'ref-gauge'>>()
})

test('invalid code does not compile', () => {
  // @ts-expect-error число вместо строки
  note.title(42)
  // @ts-expect-error у ссылки нет списковых операций
  note.author.push(author)
  // @ts-expect-error ссылка nullable, точку ставить нельзя
  note.author().name()
  // @ts-expect-error часть не пишется целиком
  note.stats(author)
  // @ts-expect-error модель не зарегистрирована в Models
  cast(note.stats, 'ref-нет-такой')
  // @ts-expect-error спека — это поле или модель, а не строка типа
  cast(note.tags, 'строка')
  // @ts-expect-error переводить можно канал или документ, а не что попало
  cast(42, AS_LIST)
  // @ts-expect-error у части нет `ensure`: она есть всегда
  note.stats.ensure()
  // @ts-expect-error `attach` есть у множественной ссылки, а не у одиночной
  note.author.attach()
})

test('space and model agree on the name', () => {
  const land = new Land(undefined as never, fixedClock(0))
  const space = createSpace({ land })
  expectTypeOf(space.doc(Note, 0 as never)).toEqualTypeOf<Doc<'ref-note'>>()
  expectTypeOf(space.doc(Author, 0 as never)).toEqualTypeOf<Doc<'ref-author'>>()
  // @ts-expect-error чужое имя модели
  space.doc('ref-нет-такой', 0 as never)
})
