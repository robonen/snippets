// Гейт типов слоя моделей (docs/05 §8.3).
//
// Тесты типов — часть набора, а не бонус (PRINCIPLES, «Типы»). Проверяется
// ОБЕ стороны: правильный код собирается без единой аннотации, неправильный не
// собирается. Каждая директива `@ts-expect-error` — сама себе тест: не
// сработавшая дала бы TS2578 и покраснела бы вместе со всеми.
//
// Прогон идёт двумя способами и оба обязательны: `vitest` исполняет файл (и
// ловит, что он вообще импортируется), `tsc --noEmit` проверяет утверждения —
// `expectTypeOf` в рантайме не делает ничего.

import { describe, expectTypeOf, test } from 'vitest'
import type { Link } from '../../binary/link'
import {
  atom,
  cellOf,
  coreOf,
  link,
  links,
  list,
  model,
  t,
  type Cast,
  type Doc,
  type Peer,
  type Point,
  type Type,
} from '../index'
import type { Key } from '../value'
import './blog'

// Документы объявлены, а не открыты: файл проверяет ТИПЫ, и заводить ради этого
// ленд значило бы мерить не то и падать не там.
declare const post: Doc<'post'>
declare const blog: Doc<'blog'>
declare const note: Doc<'note'>

describe('reads are inferred as the value, not the pawn', () => {
  test('all nine field kinds', () => {
    expectTypeOf(post.title()).toEqualTypeOf<string>()
    expectTypeOf(post.status()).toEqualTypeOf<'draft' | 'live' | 'archived'>()
    expectTypeOf(post.tags()).toEqualTypeOf<readonly string[]>()
    expectTypeOf(post.body()).toEqualTypeOf<string>()
    expectTypeOf(post.author()).toEqualTypeOf<Doc<'user'> | null>()
    expectTypeOf(post.stats()).toEqualTypeOf<Doc<'stats'>>()
    expectTypeOf(post.comments('c1')).toEqualTypeOf<Doc<'comment'>>()
    expectTypeOf(post.reactions('👍')).toEqualTypeOf<number>()
    expectTypeOf(blog.archive(['2026', '08', 'vue'])).toEqualTypeOf<Doc<'post'> | null>()
  })

  test('a derived field is inferred from the function body', () => {
    expectTypeOf(post.excerpt()).toEqualTypeOf<string>()
    expectTypeOf(post.hot()).toEqualTypeOf<boolean>()
    expectTypeOf(note.loud()).toEqualTypeOf<string>()
  })

  test('channel operations', () => {
    expectTypeOf(post.tags.at(0)).toEqualTypeOf<string | null>()
    expectTypeOf(post.author.ensure()).toEqualTypeOf<Doc<'user'>>()
    expectTypeOf(post.body.pointAt(0)).toEqualTypeOf<Point>()
    expectTypeOf(post.title.set('x')).toEqualTypeOf<string>()
    expectTypeOf(post.title.by({} as Peer)).toEqualTypeOf<string>()
    expectTypeOf(post.$.authors()).toEqualTypeOf<readonly Peer[]>()
    expectTypeOf(post.$.extras()).toEqualTypeOf<readonly Key[]>()
    expectTypeOf(post.$.link()).toEqualTypeOf<Link>()
    expectTypeOf(post.$.meta()).toEqualTypeOf<Link | null>()
  })

  test('not a single any — for every field kind', () => {
    expectTypeOf(post.title).not.toBeAny()
    expectTypeOf(post.tags).not.toBeAny()
    expectTypeOf(post.comments).not.toBeAny()
    expectTypeOf(post.stats).not.toBeAny()
    expectTypeOf(blog.archive).not.toBeAny()
    expectTypeOf(post.$).not.toBeAny()
  })
})

describe('mutual recursion through the registry', () => {
  test('unfolds both ways and does not hit the limit', () => {
    // ЭТА строка — вся причина, по которой поле хранит ИМЯ цели, а не тонк.
    // `link(() => User)` даёт TS7022 на константах схемы и каскад TS18046
    // дальше, а дубль схемы интерфейсами стоит трёх аннотаций на модель.
    expectTypeOf(post.author()!.posts()[0]!.author()!.name()).toEqualTypeOf<string>()
    expectTypeOf(post.author()!.posts()[0]!.status()).toEqualTypeOf<'draft' | 'live' | 'archived'>()
    expectTypeOf(post.comments('c1').author()!.posts()[0]!.title()).toEqualTypeOf<string>()
  })
})

describe('Cast versus Type — decision R5', () => {
  test('an enum has no blank, a string does', () => {
    expectTypeOf(t.string).toExtend<Type<string>>()
    expectTypeOf(t.date).toExtend<Cast<Date>>()
    expectTypeOf(t.enum(['a', 'b'])).toExtend<Cast<'a' | 'b'>>()
    expectTypeOf(t.enum(['a', 'b']).or('a')).toExtend<Type<'a' | 'b'>>()
    expectTypeOf(t.maybe(t.date)).toExtend<Type<Date | null>>()
  })

  test('a list element needs no blank', () => {
    // `list` принимает `Cast`, поэтому перечисление годится как есть.
    expectTypeOf(list(t.enum(['a', 'b']))).not.toBeAny()
  })
})

describe('invalid code does not compile', () => {
  test('writes and calls', () => {
    // @ts-expect-error число вместо строки
    post.title(42)
    // @ts-expect-error члена нет в перечислении
    post.status('published')
    // @ts-expect-error у атома нет списковых операций
    post.title.push('x')
    // @ts-expect-error ссылка nullable, точку ставить нельзя
    post.author().name()
    // @ts-expect-error производное поле не пишется
    post.excerpt('x')
    // @ts-expect-error опечатка в имени поля
    post.titel()
  })

  test('schema declaration', () => {
    // @ts-expect-error у перечисления нет blank — нужен .or() или t.maybe()
    atom(t.enum(['a', 'b']))
    // @ts-expect-error `$` зарезервирован под операции документа
    model('bad', { $: atom(t.string) })
    // @ts-expect-error `t.date` не Type: естественного пустого у даты нет
    atom(t.date)
    // @ts-expect-error модель не зарегистрирована в Models
    link('нет-такой')
    // @ts-expect-error и у множественной ссылки тоже
    links('psot')
  })

  test('the index checks the path length', () => {
    // @ts-expect-error путь короче объявленной глубины
    blog.archive(['2026'])
    // @ts-expect-error путь длиннее
    blog.archive(['2026', '08', 'vue', 'лишнее'])
  })

  test('internal handles do not accept just anything', () => {
    // @ts-expect-error пространство — это не ленд
    coreOf({})
    // @ts-expect-error канал — это не документ
    cellOf(post)
  })
})
