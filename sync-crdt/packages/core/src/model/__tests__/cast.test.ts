// Гейт корректности `cast`: другой ВИД на те же юниты, ноль миграции данных.
//
// ─── Что здесь порт, а что новое ─────────────────────────────────────────────
//
// `baza/cast/cast.test.ts` — 51 строка и ДВА кейса: «Atom <=> List» и
// «Atom <=> Dict». docs/05 §9 требует шести, добавив `text↔list` и `dict↔list`.
//
// Оба порта идут с ИСПРАВЛЕННЫМ ожиданием, и это не косметика:
//
//   `list.add(3)` у baza постил с `lead = hole`, то есть В НАЧАЛО, и потому её
//   ассерт `reg.vary() === 3` фиксировал СЛЕДСТВИЕ ДЕФЕКТА (реестр, п. 29).
//   У нас `push` кладёт в конец, `unshift` — в начало, и обе стороны заявлены
//   контрактом, а не выведены из якоря;
//
//   `dict.dive(2, …)` у baza тоже уходил в начало через `add`, поэтому её
//   ассерт `reg.vary() === 2` держал обратный порядок ключей. У нас ключ всегда
//   в конец (docs/05 §7.15), и первый ключ остаётся первым.
//
// ─── Почему `cast` вообще бесплатен ──────────────────────────────────────────
//
// Вид не участвует в ХРАНЕНИИ: атом берёт первого живого ребёнка, список — всех,
// словарь — всех и читает их значения как ключи. Поэтому «перевод вида» это
// новая ручка на ту же координату, а не миграция. Предмет проверки здесь —
// именно это: НОЛЬ новых юнитов на любой перевод.

import { flush, watchEffect } from '@sync/fiber'
import { describe, expect, test } from 'vitest'
import { Link } from '../../binary/link'
import { fixedClock } from '../../land/clock'
import { Land } from '../../land/land'
import { cast } from '../cast'
import {
  atom,
  coreOf,
  createSpace,
  dict,
  links,
  list,
  ModelError,
  t,
  type Head,
  type Issue,
  type Space,
  type SpaceCore,
} from '../index'
import { Author, Gauge, Meter, Note } from './refs'

/**
 * Спеки — МОДУЛЬНЫЕ константы.
 *
 * Мемоизация ячейки идёт по объекту спеки, поэтому `cast(x, list(t.string))` в
 * цикле завёл бы по ячейке на вызов. Это ровно та цена, о которой говорит
 * docs/05 §7.10 — бесплатно по данным, не по кэшу, — и в тестах она должна быть
 * видна как дисциплина, а не как случайность.
 */
const AS_ATOM = atom(t.maybe(t.string))
const AS_LIST = list(t.string)
const AS_DICT = dict(t.string, t.maybe(t.string))
const AS_REF = atom(t.maybe(t.link))
const AS_REFS = links('ref-author')

function peerOf(byte: number): Link {
  const bin = new Uint8Array(8)
  bin[0] = byte
  return Link.peer(bin)
}

const HOME: Link = Link.land(peerOf(0x01), new Uint8Array(8))

interface Stand {
  readonly land: Land
  readonly space: Space
  readonly issues: Issue[]
}

function stand(peer = 0x11): Stand {
  const land = new Land(peerOf(peer), fixedClock(1000))
  const issues: Issue[] = []
  const space = createSpace({ land, id: HOME, salt: new Uint8Array([5, 5]), report: i => issues.push(i) })
  return { land, space, issues }
}

function noteAt(land: Land, id = 4242): Head {
  return land.nodeAt(id)
}

/** Сколько юнитов постилось за действие — см. `link.test.ts`, там же и почему. */
function posted(space: Space, fn: () => void): number {
  const core = coreOf(space) as { post: SpaceCore['post'] }
  const was = core.post
  let count = 0
  core.post = (head, lead, self, value, tag) => {
    count += 1
    was(head, lead, self, value, tag)
  }
  try {
    fn()
  } finally {
    core.post = was
  }
  return count
}

describe('1. atom ↔ list (port of baza «Atom <=> List», expectation fixed)', () => {
  test('one slot, two views, and order is part of the contract', () => {
    const { land, space } = stand()
    const note = space.doc(Note, noteAt(land))
    const one = cast(note.tags, AS_ATOM)

    // Атом пишет первого живого ребёнка — список видит его единственным элементом.
    one('1')
    expect(note.tags()).toEqual(['1'])

    note.tags(['1', '2'])
    expect(one()).toBe('1')

    // ИСПРАВЛЕНО ПРОТИВ baza: там `add` постил в НАЧАЛО и ассерт ждал `3`.
    note.tags.push('3')
    expect(note.tags()).toEqual(['1', '2', '3'])
    expect(one()).toBe('1')

    // «В начало» теперь называется своим именем и делает ровно это.
    note.tags.unshift('4')
    expect(one()).toBe('4')

    // Запись атома — тот же `self`, значит замена первого элемента, а не вставка.
    one('5')
    expect(note.tags()).toEqual(['5', '1', '2', '3'])
  })
})

describe('2. atom ↔ dict (port of baza «Atom <=> Dict», expectation fixed)', () => {
  test('a dict key is an ordinary unit value, and renaming keeps the subtree', () => {
    const { land, space } = stand()
    const note = space.doc(Note, noteAt(land))
    const key = cast(note.marks, AS_ATOM)

    key('a')
    expect(note.marks.keys()).toEqual(['a'])

    note.marks('b', 'foo')
    // ИСПРАВЛЕНО ПРОТИВ baza: там `dive` уходил в начало через `add`, и ассерт
    // ждал `2` (то есть новый ключ). У нас ключ всегда в конец (docs/05 §7.15),
    // поэтому первым остаётся прежний.
    expect(key()).toBe('a')
    expect(note.marks.keys()).toEqual(['a', 'b'])

    note.marks.delete('a')
    expect(key()).toBe('b')

    // Переименование через атомный вид: ТОТ ЖЕ `self`, другое значение — и
    // поддерево ключа переезжает вместе с ним.
    key('c')
    expect(note.marks.has('b')).toBe(false)
    expect(note.marks('c')).toBe('foo')
  })
})

describe('3. dict ↔ list (new)', () => {
  test('dict keys are exactly the list of values of its children', () => {
    const { land, space } = stand()
    const note = space.doc(Note, noteAt(land))
    const names = cast(note.marks, AS_LIST)

    note.marks('x', '1')
    note.marks('y', '2')
    expect(names()).toEqual(['x', 'y'])

    // И обратно: положенное списком становится ключом словаря.
    names.push('z')
    expect(note.marks.keys()).toEqual(['x', 'y', 'z'])
    // Значения соседей при этом целы: список тронул только состав детей.
    expect(note.marks('x')).toBe('1')

    // Удаление списком — удаление ключа.
    names.remove('x')
    expect(note.marks.keys()).toEqual(['y', 'z'])
  })
})

describe('4. text ↔ list (new)', () => {
  test('text is a list of paragraphs over the same units', () => {
    const { land, space } = stand()
    const note = space.doc(Note, noteAt(land))
    note.body('Первый абзац.\nВторой абзац.')

    // РАСХОЖДЕНИЕ С docs/05 §2.6, зафиксированное здесь: там `cast(post.body,
    // list(t.string))()` обещает ТОКЕНЫ. При двухуровневом хранении, которого
    // требует §3.10 (абзацы, внутри токены), прямые дети слота текста — АБЗАЦЫ,
    // и список видит именно их. Обещание §2.6 выполнимо только на одноуровневом
    // тексте, то есть противоречит §3.10 того же документа.
    const paras = cast(note.body, AS_LIST)
    expect(paras().length).toBe(2)
    expect(note.body.paragraphs().length).toBe(2)
  })

  test('what was written as a list, text reads as its own text', () => {
    const { land, space } = stand()
    const note = space.doc(Note, noteAt(land, 77))

    cast(note.body, AS_LIST)(['раз', 'два'])
    expect(note.body()).toBe('раздва')
    // `size()`, а не обещанный docs/05 §1.4 `length()`: текстовый канал назвал
    // длину так же, как её называют список и словарь. Расхождение с документом
    // фиксируется здесь, чтобы оно не осталось незамеченным.
    expect((note.body as unknown as { size(): number }).size()).toBe(6)
  })
})

describe('5. link ↔ atom ↔ multi-link', () => {
  test('the same pawn reads as an address, an entity, and a list of entities', () => {
    const { land, space } = stand()
    const note = space.doc(Note, noteAt(land))
    const author = note.author.ensure()
    author.name('Аня')

    // Сырой адрес — то, что лежит в юните.
    const raw = cast(note.author, AS_REF)()
    expect(raw).not.toBe(null)
    expect((raw as Link).resolve(HOME).str).toBe(author.$.link().str)

    // Тот же слот как множественная ссылка: один элемент.
    const many = cast(note.author, AS_REFS)
    expect(many().length).toBe(1)
    expect(many()[0]).toBe(author)

    // И обратно: добавленное множественным видом видно одиночному как ПЕРВОЕ.
    const second = space.doc(Author, land.nodeAt(909))
    second.name('Боря')
    many.add(second)
    expect(many().map(x => x.name())).toEqual(['Аня', 'Боря'])
    expect(note.author()?.name()).toBe('Аня')
  })
})

describe('6. document ↔ document and document ↔ dict', () => {
  test('same head, different model — the schema is a LENS, not an on-disk prohibition', () => {
    const { land, space, issues } = stand()
    const note = space.doc(Note, noteAt(land))
    note.stats().views(5)

    // Та же голова, прочитанная другой схемой.
    const gauge = cast(note.stats, Gauge)
    expect(gauge.$.link().str).toBe(note.stats().$.link().str)
    // `views` объявлен строкой, а лежит число: `blank` плюс ровно один `Issue`,
    // и НИ ОДНОГО броска (docs/05 §4).
    expect(() => gauge.views()).not.toThrow()
    expect(gauge.views()).toBe('')
    expect(issues.some(i => i.kind === 'decode' && i.field === 'views')).toBe(true)

    // Данные не тронуты: обратный перевод возвращает то же число.
    expect(cast(gauge, Meter).views()).toBe(5)
  })

  test('a document as a dict: its children are the keys', () => {
    const { land, space } = stand()
    const note = space.doc(Note, noteAt(land))
    note.stats().views(5)
    note.stats().likes(2)

    const fields = cast(note.stats(), AS_DICT)
    expect(fields.keys()).toEqual(['views', 'likes'])
  })

  test('a view of the ROOT document is rejected loudly', () => {
    const { space } = stand()
    // ROOT служит и головой ленда, и сентинелом «поля ещё нет», поэтому такой
    // вид молча читался бы пустым. Молчание тут хуже отказа.
    expect(() => cast(space.root(Note), AS_DICT)).toThrow(ModelError)
  })
})

describe('view translation invariants', () => {
  test('a view translation writes NOT A SINGLE unit', () => {
    const { land, space } = stand()
    const note = space.doc(Note, noteAt(land))
    note.tags(['vue', 'crdt'])
    note.marks('x', '1')
    note.author.ensure()
    flush()

    expect(posted(space, () => {
      cast(note.tags, AS_ATOM)()
      cast(note.tags, AS_DICT).keys()
      cast(note.marks, AS_LIST)()
      cast(note.author, AS_REF)()
      cast(note.author, AS_REFS)()
      cast(note.stats, Gauge)
      cast(note.stats(), AS_DICT).keys()
    })).toBe(0)
  })

  test('the view is memoized: cast(x, v) === cast(x, v), subscriptions do not multiply', () => {
    const { land, space } = stand()
    const note = space.doc(Note, noteAt(land))

    expect(cast(note.tags, AS_LIST)).toBe(cast(note.tags, AS_LIST))
    expect(cast(note.marks, AS_ATOM)).toBe(cast(note.marks, AS_ATOM))
    // Разные спеки — разные каналы: это два вида, а не один.
    expect(cast(note.tags, AS_LIST) as unknown).not.toBe(cast(note.tags, AS_ATOM) as unknown)
    // Документ по голове мемоизирован тем же реестром, что и обычное открытие.
    expect(cast(note.stats, Gauge)).toBe(cast(note.stats, Gauge))
  })

  test('the view translation itself subscribes to nothing', () => {
    const { land, space } = stand()
    const note = space.doc(Note, noteAt(land))

    let runs = 0
    const stop = watchEffect(() => {
      cast(note.tags, AS_ATOM)
      runs += 1
    })
    expect(runs).toBe(1)

    // Появление СОСЕДНЕГО поля меняет состав детей документа. Знай `cast` про
    // слот заранее — он бы от этого пересчитывался, то есть подписка возникала
    // бы там, где данных не читают вовсе.
    note.title('соседнее поле')
    flush()
    expect(runs).toBe(1)
    stop()
  })

  test('all views look at ONE node', () => {
    const { land, space } = stand()
    const head = noteAt(land)
    const note = space.doc(Note, head)
    note.tags(['vue'])

    const core = coreOf(space)
    const slot = core.keyIndex(head).get('tags')
    expect(slot).toBeDefined()
    // Через список видно значение, через атом — его же, и оба лежат под `slot`.
    expect(note.tags()).toEqual(['vue'])
    expect(cast(note.tags, AS_ATOM)()).toBe('vue')
    expect(land.order(slot as Head).map(view => view.value)).toEqual(['vue'])
  })
})
