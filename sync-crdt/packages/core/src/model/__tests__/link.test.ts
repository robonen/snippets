// Гейт корректности: ссылки, вложенные части и гранулярность рождения.
//
// Предмет — три раздельные операции вместо `dive(key, P, auto)` (реестр, п. 28),
// громкий отказ вместо молчаливого `null` (п. 35), относительность внутриленд-
// ссылок (порт `land.test` «Inner Links are relative to forked Land») и три
// ветки `born` из docs/05 §5.

import { flush, watchEffect } from '@sync/fiber'
import { describe, expect, test } from 'vitest'
import { Link } from '../../binary/link'
import { fixedClock } from '../../land/clock'
import { Land } from '../../land/land'
import { ROOT, type LocalId } from '../../land/view'
import { cast } from '../cast'
import {
  atom,
  coreOf,
  createSpace,
  ModelError,
  t,
  type Head,
  type Issue,
  type Space,
  type SpaceCore,
} from '../index'
import { Author, GUEST_LAND, LOST_LAND, Note, Vault } from './refs'

function peerOf(byte: number): Link {
  const bin = new Uint8Array(8)
  bin[0] = byte
  return Link.peer(bin)
}

/** Общий адрес ленда у обеих реплик: детерминизм `ensure` считается от него. */
const HOME: Link = Link.land(peerOf(0x01), new Uint8Array(8))
const SALT = new Uint8Array([7, 7, 7])

interface Stand {
  readonly land: Land
  readonly space: Space
  readonly issues: Issue[]
  /** Ленды-соседи, заведённые по требованию `of()`. */
  readonly lands: Map<string, Land>
}

/**
 * Стенд с настоящим реестром соседних лендов.
 *
 * `open` обязателен: без него `born: 'area'` и `born: {land}` некуда рождать, а
 * `LOST_LAND` не открывается НИКОГДА — на нём проверяется, что отказ громкий.
 */
function stand(peer = 0x11, when = 1000): Stand {
  const issues: Issue[] = []
  const spaces = new Map<string, Space>()
  const lands = new Map<string, Land>()

  const open = (other: Link): Space => {
    if (other.equals(LOST_LAND)) {
      throw new ModelError(`no one can open the neighboring land «${other.str}»`, 'test.open')
    }
    const key = other.str
    const found = spaces.get(key)
    if (found !== undefined) return found

    const next = new Land(peerOf(peer), fixedClock(when))
    lands.set(key, next)
    const space = createSpace({ land: next, id: other, salt: SALT, report: i => issues.push(i), open })
    spaces.set(key, space)
    return space
  }

  const land = new Land(peerOf(peer), fixedClock(when))
  const space = createSpace({ land, id: HOME, salt: SALT, report: i => issues.push(i), open })
  spaces.set(HOME.str, space)
  return { land, space, issues, lands }
}

/** Прислать юниты чужого ленда, как они приехали бы по проводу. */
function deliver(to: Land, from: Land): void {
  to.apply(from.units())
  flush()
}

/** Голова заметки — не корень: корень занят под `space.root`. */
function noteAt(land: Land, id = 4242): Head {
  return land.nodeAt(id)
}

/**
 * Сколько юнитов ПОСТИЛОСЬ за действие.
 *
 * Не `land.size()`: тот считает различимые тройки (голова, пир, self), поэтому
 * перезапись узла тем же пиром его не двигает — а именно перезапись и есть
 * «замена элемента одним юнитом». Считать надо посты, и единственная честная
 * точка счёта — сам `core.post`.
 */
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

describe('link: read, write, create — three different operations (registry, item 28)', () => {
  test('an unread link is null, and not a single unit for the read', () => {
    const { land, space } = stand()
    const note = space.doc(Note, noteAt(land))

    const before = land.size()
    expect(note.author()).toBe(null)
    expect(note.editors()).toEqual([])
    expect(land.size()).toBe(before)
  })

  test('read, write, and create do not get mixed up', () => {
    const { land, space } = stand()
    const note = space.doc(Note, noteAt(land))

    // Чтение ничего не создаёт.
    expect(note.author()).toBe(null)
    expect(land.size()).toBe(0)

    // Создание — ЯВНАЯ операция, а не третий аргумент чтения.
    const author = note.author.ensure()
    expect(note.author()).toBe(author)
    expect(land.size()).toBeGreaterThan(0)

    // Запись — третья операция, и она принимает сущность, а не флаг.
    const other = space.doc(Author, land.nodeAt(999))
    note.author.set(other)
    expect(note.author()).toBe(other)
  })

  test('ensure is idempotent: two calls yield ONE entity and one set of units', () => {
    const { land, space } = stand()
    const note = space.doc(Note, noteAt(land))

    const first = note.author.ensure()
    const size = land.size()
    const second = note.author.ensure()

    expect(second).toBe(first)
    expect(land.size()).toBe(size)
  })

  test('ensure is deterministic: two replicas converge to one entity', () => {
    const a = stand(0x21)
    const b = stand(0x22)

    const one = a.space.doc(Note, noteAt(a.land)).author.ensure()
    one.name('Аня')
    const two = b.space.doc(Note, noteAt(b.land)).author.ensure()
    two.name('Аня')

    deliver(a.land, b.land)
    deliver(b.land, a.land)

    // Адрес — H(соль ‖ ссылка на само поле), поэтому у обеих реплик он один.
    expect(one.$.link().str).toBe(two.$.link().str)
    expect(a.space.doc(Note, noteAt(a.land)).author()?.name()).toBe('Аня')
    // Одна сущность, а не две: возьми адрес рандомом — здесь было бы два автора.
    expect(a.land.order(noteAt(a.land)).length).toBe(1)
  })

  test('an intra-land link is stored RELATIVE', () => {
    const { land, space } = stand()
    const note = space.doc(Note, noteAt(land))
    const author = note.author.ensure()

    // Сырой вид на те же юниты: то, что реально лежит в ленде.
    const raw = cast(note.author, atom(t.maybe(t.link)))()
    expect(raw).not.toBe(null)
    // Секции peer и area нулевые — ссылка относительная, 6 значащих байт из 22.
    expect((raw as Link).bin.subarray(0, 16).every(byte => byte === 0)).toBe(true)
    // А наружу она приходит абсолютной, разрешённой на читающий ленд.
    expect(author.$.link().str.startsWith(HOME.str)).toBe(true)
  })

  test('clear erases the link but not the entity', () => {
    const { land, space } = stand()
    const note = space.doc(Note, noteAt(land))
    const author = note.author.ensure()
    author.name('Аня')

    note.author.clear()
    expect(note.author()).toBe(null)
    // Сущность жива: `link` это ссылка, а не владение.
    expect(space.doc(Author, land.nodeOf(author.$.link().bin.subarray(16, 22))).name()).toBe('Аня')
  })
})

describe('link: foreign data does not crash reads (docs/05 §4)', () => {
  test('a number instead of a link is null and Issue{decode}, not a throw', () => {
    const { land, space, issues } = stand()
    const note = space.doc(Note, noteAt(land))
    note.author.ensure()

    // Пишем мусор в тот же слот сырым видом — так это выглядело бы от узла
    // другой версии.
    cast(note.author, atom(t.number))(42)

    expect(() => note.author()).not.toThrow()
    expect(note.author()).toBe(null)
    expect(issues.map(i => i.kind)).toContain('decode')
    expect(issues[issues.length - 1]?.field).toBe('author')
  })

  test('a link to a land no one can open is null and Issue{broken-link}', () => {
    const { land, space, issues } = stand()
    const note = space.doc(Note, noteAt(land))

    // Абсолютная пешка в LOST_LAND: формат верный, доступа нет.
    const far = Link.pawn(LOST_LAND, new Uint8Array([0, 0, 0, 0, 0, 9]))
    cast(note.author, atom(t.maybe(t.link)))(far)

    expect(note.author()).toBe(null)
    const issue = issues.find(i => i.kind === 'broken-link')
    expect(issue?.field).toBe('author')
    expect(issue?.got).toBe(far.str)
  })

  test('a land-level link is not an entity: null and an Issue, not half a document', () => {
    const { land, space, issues } = stand()
    const note = space.doc(Note, noteAt(land))
    cast(note.author, atom(t.maybe(t.link)))(GUEST_LAND)

    expect(note.author()).toBe(null)
    expect(issues.some(i => i.kind === 'broken-link')).toBe(true)
  })
})

describe('multi-link', () => {
  test('add appends to the END — order is part of the contract (registry, item 29)', () => {
    const { land, space } = stand()
    const note = space.doc(Note, noteAt(land))
    const one = space.doc(Author, land.nodeAt(101))
    const two = space.doc(Author, land.nodeAt(102))
    one.name('раз')
    two.name('два')

    note.editors.add(one)
    note.editors.add(two)

    expect(note.editors().map(x => x.name())).toEqual(['раз', 'два'])
    expect(note.editors.size()).toBe(2)
    expect(note.editors.at(0)).toBe(one)
    expect(note.editors.has(two)).toBe(true)
  })

  test('writing the membership is RECONCILIATION: replacing one element costs one unit', () => {
    const { land, space } = stand()
    const note = space.doc(Note, noteAt(land))
    const authors = [101, 102, 103].map(id => space.doc(Author, land.nodeAt(id)))

    note.editors(authors)

    // Тот же состав — НОЛЬ юнитов. Без этого любое эхо от пира и любой ре-рендер
    // рождают юнит, и диффы летят по кругу между двумя узлами бесконечно.
    expect(posted(space, () => {
      note.editors(note.editors())
    })).toBe(0)

    // Один элемент заменён — РОВНО один юнит: замена по тому же `self`.
    const fresh = space.doc(Author, land.nodeAt(104))
    expect(posted(space, () => {
      note.editors([authors[0] as never, fresh as never, authors[2] as never])
    })).toBe(1)
    expect(note.editors().map(x => x.$.link().str)).toEqual(
      [authors[0], fresh, authors[2]].map(x => (x as never as { $: { link(): Link } }).$.link().str),
    )
  })

  test('remove and move change the membership without touching entities', () => {
    const { land, space } = stand()
    const note = space.doc(Note, noteAt(land))
    const authors = [101, 102, 103].map(id => space.doc(Author, land.nodeAt(id)))
    note.editors(authors)

    note.editors.move(0, 2)
    expect(note.editors().map(x => x.$.link().str)).toEqual(
      [authors[1], authors[2], authors[0]].map(x => (x as never as { $: { link(): Link } }).$.link().str),
    )

    note.editors.remove(authors[2] as never)
    expect(note.editors().length).toBe(2)
    expect(note.editors.has(authors[2] as never)).toBe(false)
  })

  test('attach creates DIFFERENT entities, unlike ensure', () => {
    const { space, land } = stand()
    const note = space.doc(Note, noteAt(land))

    const one = note.editors.attach()
    const two = note.editors.attach()

    expect(one).not.toBe(two)
    expect(one.$.link().str).not.toBe(two.$.link().str)
    one.name('первый')
    two.name('второй')
    expect(note.editors().map(x => x.name())).toEqual(['первый', 'второй'])
  })

  test('a broken link drops out of the output and yields an Issue, not a hole in the array', () => {
    const { land, space, issues } = stand()
    const note = space.doc(Note, noteAt(land))
    const good = space.doc(Author, land.nodeAt(101))
    good.name('живой')
    note.editors.add(good)

    // Подкладываем мусор вторым элементом тем же сырым видом.
    const slot = land.order(noteAt(land)).find(view => view.value === 'editors')?.self as LocalId
    land.post(slot, land.order(slot)[0]?.self ?? ROOT, 'не ссылка', 'term')
    flush()

    expect(note.editors().map(x => x.name())).toEqual(['живой'])
    expect(issues.some(i => i.kind === 'decode' && i.field === 'editors')).toBe(true)
  })

  test('clear erases the whole membership', () => {
    const { land, space } = stand()
    const note = space.doc(Note, noteAt(land))
    note.editors([101, 102].map(id => space.doc(Author, land.nodeAt(id))))
    note.editors.clear()
    expect(note.editors()).toEqual([])
  })
})

describe('nested part', () => {
  test('a part always exists, and a read writes NOT A SINGLE unit', () => {
    const { land, space } = stand()
    const note = space.doc(Note, noteAt(land))

    const before = land.size()
    expect(note.stats().views()).toBe(0)
    expect(note.stats().likes()).toBe(0)
    expect(land.size()).toBe(before)
    // Тот же документ на том же адресе — идентичность, а не копия.
    expect(note.stats()).toBe(note.stats())
  })

  test('the first write inside completes the chain up to the parent', () => {
    const { land, space } = stand()
    const head = noteAt(land)
    const note = space.doc(Note, head)

    note.stats().views(7)

    // Ключевой юнит `stats` появился В ДЕТЯХ заметки: без этого часть не «живёт
    // в поддереве родителя», а висит на узле, до которого не дойти обходом.
    const keys = land.order(head).map(view => view.value)
    expect(keys).toContain('stats')
    expect(note.stats().views()).toBe(7)
    // И адрес не поехал: тот, что предсказали до записи, и есть записанный.
    expect(note.stats()).toBe(space.doc(Note, head).stats())
  })

  test('a part is included in the traversal of the parent subtree', () => {
    const { land, space } = stand()
    const head = noteAt(land)
    const note = space.doc(Note, head)
    note.stats().views(1)

    expect(note.$.exists()).toBe(true)
    expect(note.$.changedAt()).not.toBe(null)
    // Юниты части лежат под её головой, а голова — ребёнок заметки.
    const slot = land.order(head).find(view => view.value === 'stats')?.self as LocalId
    expect(land.order(slot).map(view => view.value)).toContain('views')
  })

  test('two replicas write into a part independently and converge', () => {
    const a = stand(0x31)
    const b = stand(0x32)

    a.space.doc(Note, noteAt(a.land)).stats().views(10)
    b.space.doc(Note, noteAt(b.land)).stats().likes(3)

    deliver(a.land, b.land)
    deliver(b.land, a.land)

    const one = a.space.doc(Note, noteAt(a.land)).stats()
    const two = b.space.doc(Note, noteAt(b.land)).stats()
    expect([one.views(), one.likes()]).toEqual([10, 3])
    expect([two.views(), two.likes()]).toEqual([10, 3])
  })

  test('a part cannot be written whole — and loudly so', () => {
    const { land, space } = stand()
    const note = space.doc(Note, noteAt(land))
    expect(() => (note.stats as unknown as (next: unknown) => void)({})).toThrow(ModelError)
  })
})

describe('birth granularity (docs/05 §5)', () => {
  test('here — an own entity in the own land', () => {
    const { land, space } = stand()
    const vault = space.doc(Vault, land.nodeAt(500))
    const born = vault.here.ensure()
    born.name('дома')

    expect(born.$.link().str.startsWith(HOME.str)).toBe(true)
    expect(land.size()).toBeGreaterThan(0)
  })

  test('area — a separate land of the same lord, its own sync stream', () => {
    const { land, space, lands } = stand()
    const vault = space.doc(Vault, land.nodeAt(500))
    const born = vault.area.ensure()
    born.name('в области')

    const at = born.$.link()
    // Лорд тот же, area другая — это и есть «внутри ленда, но синкается отдельно».
    expect(at.land().str).not.toBe(HOME.str)
    expect(at.peer().str).toBe(HOME.peer().str)
    expect(at.area().str).not.toBe('')
    expect(lands.has(at.land().str)).toBe(true)
    // Юниты уехали в СОСЕДНИЙ ленд, а не в наш.
    expect((lands.get(at.land().str) as Land).size()).toBeGreaterThan(0)
    expect(vault.area()?.name()).toBe('в области')
  })

  test('{land} — a new land with its own rights', () => {
    const { land, space, lands } = stand()
    const vault = space.doc(Vault, land.nodeAt(500))
    const born = vault.guest.ensure()
    born.name('в гостях')

    expect(born.$.link().land().str).toBe(GUEST_LAND.str)
    expect((lands.get(GUEST_LAND.str) as Land).size()).toBeGreaterThan(0)
    expect(vault.guest()?.name()).toBe('в гостях')
  })

  test('born from the call overrides born from the schema', () => {
    const { land, space } = stand()
    const vault = space.doc(Vault, land.nodeAt(500))
    const born = vault.here.ensure({ land: GUEST_LAND })
    expect(born.$.link().land().str).toBe(GUEST_LAND.str)
  })

  test('land access denial is LOUD: Issue{denied} plus a throw (registry, item 35)', () => {
    const { land, space, issues } = stand()
    const vault = space.doc(Vault, land.nodeAt(500))

    expect(() => vault.lost.ensure()).toThrow(ModelError)

    const denied = issues.find(i => i.kind === 'denied')
    expect(denied).toBeDefined()
    expect(denied?.field).toBe('lost')
    expect(denied?.expected).toContain(LOST_LAND.str)
    // Молчаливого `null` тут нет ни в каком виде: ссылка так и не появилась.
    expect(vault.lost()).toBe(null)
    // И UI мог спросить заранее.
    expect(vault.$.canWrite()).toBe(true)
  })
})

describe('link reactivity', () => {
  test('a link appearing wakes the reader, a neighboring field does not', () => {
    const { land, space } = stand()
    const note = space.doc(Note, noteAt(land))

    let seen = 0
    const stop = watchEffect(() => {
      note.author()
      seen += 1
    })
    expect(seen).toBe(1)

    note.title('соседнее поле')
    flush()
    expect(seen).toBe(1)

    note.author.ensure()
    flush()
    expect(seen).toBe(2)
    stop()
  })
})
