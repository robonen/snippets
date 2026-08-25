// Гейт корректности основания слоя моделей.
//
// Предмет — АТОМ и то, на чём он стоит: адреса ключей, порядок ключей,
// идемпотентность записи, невозможность броска на чужих данных, идентичность
// документов и гранулярность пересчёта.

import { flush, watchEffect } from '@sync/fiber'
import { describe, expect, test } from 'vitest'
import { Link } from '../../binary/link'
import { fixedClock } from '../../land/clock'
import { Land } from '../../land/land'
import { ROOT, type LocalId } from '../../land/view'
import type { Vary } from '../../binary/vary'
import { coreOf, createSpace, type Head, type Issue, type Space } from '../index'
import { readerFor } from '../kinds'
import { Note, Strict } from './blog'

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

function stand(peer = 0x11, salt = new Uint8Array([1, 2, 3])): Stand {
  const land = new Land(peerOf(peer), fixedClock(1000))
  const issues: Issue[] = []
  const space = createSpace({
    land,
    id: Link.land(peerOf(peer), new Uint8Array(8)),
    salt,
    report: issue => issues.push(issue),
  })
  return { land, space, issues }
}

/** Свежая голова под документ — номер узла, а не строка (ADR-016). */
function headAt(land: Land, id: number): Head {
  return land.nodeAt(id)
}

/** Прислать юниты чужого ленда, как они приехали бы по проводу. */
function deliver(to: Land, from: Land): void {
  to.apply(from.units())
  flush()
}

/**
 * Переписать значение НАШЕГО поля от лица чужого пира.
 *
 * Номера узлов через ленды НЕ переносятся: номер — плотный локальный
 * идентификатор (ADR-016), и у двух лендов один и тот же юнит получает разные
 * номера. Перевод идёт через 48-битный id формата — ровно так же, как это
 * делает приём пачки.
 */
function tamper(land: Land, field: string, value: Vary, peer = 0x99, when = 2000): void {
  const slot = land.order(ROOT).find(view => view.value === field)?.self as LocalId
  const node = land.nodes(slot)[0] as LocalId

  const other = new Land(peerOf(peer), fixedClock(when))
  other.write(other.nodeOf(land.idOf(slot)), ROOT, other.nodeOf(land.idOf(node)), value, 'term')
  deliver(land, other)
}

describe('atom reads and writes', () => {
  test('an unread field returns the blank of its type, not undefined and not null', () => {
    const { space } = stand()
    const note = space.root(Note)

    expect(note.title()).toBe('')
    expect(note.views()).toBe(0)
    expect(note.status()).toBe('draft')
    expect(note.tag()).toBe(null)
  })

  test('what was written reads back', () => {
    const { space } = stand()
    const note = space.root(Note)

    note.title('Файберы и CRDT')
    note.views(7)
    note.status('live')

    expect(note.title()).toBe('Файберы и CRDT')
    expect(note.views()).toBe(7)
    expect(note.status()).toBe('live')
  })

  test('all t.* lenses survive a round-trip through land bytes', () => {
    const { space } = stand()
    const doc = space.root(Strict)
    const when = new Date('2026-08-16T10:00:00.000Z')
    const home = Link.land(peerOf(0x44), new Uint8Array(8))

    doc.count(-7)
    doc.mail('anya@example.org')
    doc.when(when)
    doc.bin(new Uint8Array([1, 2, 3]))
    doc.big(0n)
    doc.flag(true)
    doc.ratio(1.5)
    doc.score(10)
    doc.words(['vue', 'crdt'])
    doc.meters({ a: 1, b: 2 })
    doc.home(home)

    expect(doc.count()).toBe(-7)
    expect(doc.mail()).toBe('anya@example.org')
    expect(doc.when()?.getTime()).toBe(when.getTime())
    expect(doc.bin()).toEqual(new Uint8Array([1, 2, 3]))
    // `0n` и `0` — РАЗНЫЕ байты и разные типы. У `$mol_vary` малый bigint терял
    // тег и возвращался числом (реестр, п. 40).
    expect(doc.big()).toBe(0n)
    expect(typeof doc.big()).toBe('bigint')
    expect(doc.flag()).toBe(true)
    expect(doc.ratio()).toBe(1.5)
    expect(doc.score()).toBe(10)
    expect(doc.words()).toEqual(['vue', 'crdt'])
    expect(doc.meters()).toEqual({ a: 1, b: 2 })
    expect(doc.home()?.str).toBe(home.str)
  })

  test('x(next) returns the LWW winner, not what was written', () => {
    const { space } = stand()
    const note = space.root(Note)
    expect(note.title('первый')).toBe('первый')
    expect(note.title.set('второй')).toBe('второй')
  })

  test('raw() returns the value before parsing', () => {
    const { space } = stand()
    const note = space.root(Note)
    expect(note.title.raw()).toBe(null)
    note.title('сырое')
    expect(note.title.raw()).toBe('сырое')
  })

  test('a write keeps self, so the subtree survives a value change', () => {
    const { land, space } = stand()
    const note = space.root(Note)

    note.title('первый')
    const slot = land.order(ROOT)[0]?.self as LocalId
    const before = land.nodes(slot)[0]

    note.title('второй')
    expect(land.nodes(slot)[0]).toBe(before)
  })

  test('clear() places a tombstone and the field returns to blank', () => {
    const { space } = stand()
    const note = space.root(Note)

    note.title('было')
    note.title.clear()
    expect(note.title()).toBe('')
  })

  test('clear() on an empty field writes not a single unit', () => {
    const { land, space } = stand()
    const note = space.root(Note)

    const before = land.size()
    note.title.clear()
    expect(land.size()).toBe(before)
  })
})

describe('idempotence — without it the echo between peers is endless', () => {
  test('x(x()) births no units', () => {
    const { land, space } = stand()
    const note = space.root(Note)
    note.title('раз')

    const before = land.size()
    for (let i = 0; i < 100; i++) note.title(note.title())
    expect(land.size()).toBe(before)
  })

  test('x(v); x(v) — exactly one unit per value', () => {
    const { land, space } = stand()
    const note = space.root(Note)

    const before = land.size()
    note.views(5)
    const once = land.size() - before
    note.views(5)
    expect(land.size() - before).toBe(once)
  })

  test('a lens refusal does not leave an empty key unit behind', () => {
    const { land, space } = stand()
    const doc = space.root(Strict)

    const before = land.size()
    expect(() => doc.count(1.5)).toThrow(TypeError)
    expect(() => doc.mail('нет собаки')).toThrow(TypeError)
    expect(() => doc.score(42)).toThrow(RangeError)
    // Ни ключевого юнита, ни значения: неудачная отправка формы не имеет права
    // навсегда добавлять документу поле.
    expect(land.size()).toBe(before)
    expect(doc.count()).toBe(0)
  })
})

describe('key order is part of the contract, not a side effect of the anchor', () => {
  test('keys land in first-write order, not reversed', () => {
    const { land, space } = stand()
    const note = space.root(Note)

    note.status('live')
    note.title('потом')
    note.views(3)

    // У baza `dive` шёл через `add` с `lead = hole`, и порядок выходил
    // ОБРАТНЫМ вставке (реестр, п. 29). Тест падает при возврате к нему.
    expect(land.order(ROOT).map(view => view.value)).toEqual(['status', 'title', 'views'])
  })
})

describe('key addresses are content-based and do not depend on position', () => {
  test('two peers writing one field converge to ONE key unit', () => {
    const clock = fixedClock(1000)
    const salt = new Uint8Array([9, 9])
    const one = new Land(peerOf(0x11), clock)
    const two = new Land(peerOf(0x22), clock)
    const a = createSpace({ land: one, salt, report: () => {} }).root(Note)
    const b = createSpace({ land: two, salt, report: () => {} }).root(Note)

    // Разный ПОРЯДОК полей у двух пиров: если бы `self` ключа зависел от точки
    // вставки, как в baza, вышло бы два поддерева на один ключ (реестр, п. 30).
    a.views(1)
    a.title('слева')
    b.title('справа')

    deliver(one, two)
    deliver(two, one)

    const keys = one.order(ROOT).map(view => view.value)
    expect(keys.filter(key => key === 'title')).toHaveLength(1)
    expect(keys.slice().sort()).toEqual(two.order(ROOT).map(view => view.value).sort())
    // Обе реплики читают одно и то же — сходимость на уровне ОПЕРАЦИЙ МОДЕЛИ.
    expect(a.title()).toBe(b.title())
  })

  test('the land salt changes the key address without changing observable behavior', () => {
    const salted = stand(0x11, new Uint8Array([7]))
    const plain = stand(0x11, new Uint8Array(0))

    salted.space.root(Note).title('x')
    plain.space.root(Note).title('x')

    expect(salted.space.root(Note).title()).toBe('x')
    expect(plain.space.root(Note).title()).toBe('x')
    expect(salted.land.idOf(salted.land.order(ROOT)[0]?.self as LocalId))
      .not.toEqual(plain.land.idOf(plain.land.order(ROOT)[0]?.self as LocalId))
  })
})

describe('reads NEVER throw', () => {
  test('garbage from a node of another version yields blank and exactly one Issue', () => {
    const { land, space, issues } = stand()
    const note = space.root(Note)
    note.views(1)

    // Чужой пир кладёт в числовое поле строку — схема это ЛИНЗА, а не
    // ограничение на диске (docs/05 §7.11).
    tamper(land, 'views', 'не число')

    expect(note.views()).toBe(0)
    expect(issues).toHaveLength(1)
    expect(issues[0]?.kind).toBe('decode')
    expect(issues[0]?.field).toBe('views')
    expect(issues[0]?.expected).toBe('int')
    expect(issues[0]?.got).toContain('не число')
    expect(issues[0]?.peer).not.toBe(null)
  })

  test('issue() explains the blank on a second pass', () => {
    const { land, space } = stand()
    const note = space.root(Note)
    note.views(1)

    tamper(land, 'views', true)

    expect(note.views.issue()?.expected).toBe('int')
    expect(note.title.issue()).toBe(null)
  })

  test('an unknown enum member does not become a valid value', () => {
    const { land, space, issues } = stand()
    const note = space.root(Note)
    note.status('live')

    tamper(land, 'status', 'член-из-будущего')

    // У `$mol_schema_enum` `cast` подставил бы `Options[0]` (реестр, п. 26).
    expect(note.status()).toBe('draft')
    expect(issues.map(issue => issue.kind)).toEqual(['decode'])
  })

  test('check() neither writes nor throws', () => {
    const { land, space } = stand()
    const doc = space.root(Strict)

    const before = land.size()
    expect(doc.mail.check('нет собаки')?.expected).toBe('email')
    expect(doc.mail.check('a@b')).toBe(null)
    expect(land.size()).toBe(before)
  })

  test('the onIssue subscription receives the same as the receiver', () => {
    const { land, space, issues } = stand()
    const heard: Issue[] = []
    const off = space.onIssue(issue => heard.push(issue))

    const note = space.root(Note)
    note.views(1)
    tamper(land, 'views', 'мусор')
    note.views()

    expect(heard).toEqual(issues)
    off()
  })
})

describe('identity and cache', () => {
  test('two doc() calls yield ONE object', () => {
    const { land, space } = stand()
    const at = headAt(land, 4242)
    expect(space.doc(Note, at)).toBe(space.doc(Note, at))
    expect(space.root(Note)).toBe(space.root(Note))
  })

  test('a document opens both by model name and by object', () => {
    const { space } = stand()
    expect(space.root('note')).toBe(space.root(Note))
  })

  test('the channel of one field is the same object on reopening', () => {
    const { space } = stand()
    expect(space.root(Note).title).toBe(space.root(Note).title)
  })

  test('documents of different heads are independent', () => {
    const { land, space } = stand()
    const one = space.doc(Note, headAt(land, 100))
    const two = space.doc(Note, headAt(land, 200))

    one.title('первый')
    two.title('второй')

    expect(one.title()).toBe('первый')
    expect(two.title()).toBe('второй')
  })

  test('all documents of one model have one key set in one order', () => {
    const { land, space } = stand()
    const one = space.doc(Note, headAt(land, 300))
    const two = space.doc(Note, headAt(land, 400))
    expect(Object.keys(one)).toEqual(Object.keys(two))
    expect(Object.keys(one)).toEqual(['title', 'views', 'status', 'tag', 'loud', '$'])
  })
})

describe('granularity — decision R3 in action', () => {
  test('the first write to a NEIGHBORING field does not recompute the read one', () => {
    const { space } = stand()
    const note = space.root(Note)

    let reads = 0
    const stop = watchEffect(() => {
      note.title()
      reads += 1
    })
    expect(reads).toBe(1)

    // Появление нового ключа меняет состав детей документа: `slot` соседей
    // пересчитается, но вернёт ту же голову — и `value` не тронется вовсе.
    note.views(1)
    flush()
    expect(reads).toBe(1)

    note.title('своё')
    flush()
    expect(reads).toBe(2)

    stop()
  })

  test('a field read subscribes to the arrival of a foreign unit', () => {
    const { land, space } = stand()
    const note = space.root(Note)

    let seen = 'не читали'
    const stop = watchEffect(() => {
      seen = note.title()
    })
    expect(seen).toBe('')

    const far = new Land(peerOf(0x22), fixedClock(2000))
    createSpace({ land: far, salt: new Uint8Array([1, 2, 3]), report: () => {} }).root(Note).title('издалека')
    deliver(land, far)

    expect(seen).toBe('издалека')
    stop()
  })
})

describe('derived fields', () => {
  test('read like ordinary fields and recompute with their source', () => {
    const { space } = stand()
    const note = space.root(Note)

    note.title('громко')
    expect(note.loud()).toBe('ГРОМКО')

    note.title('тише')
    expect(note.loud()).toBe('ТИШЕ')
  })

  test('a derived field reads THE SAME document as application code', () => {
    const { space } = stand()
    const note = space.root(Note)

    let runs = 0
    const stop = watchEffect(() => {
      note.loud()
      runs += 1
    })
    note.views(1)
    flush()
    expect(runs).toBe(1)

    note.title('раз')
    flush()
    expect(runs).toBe(2)
    stop()
  })
})

describe('$ — document operations', () => {
  test('exists() tells «empty» from «never created»', () => {
    const { space } = stand()
    const note = space.root(Note)

    expect(note.$.exists()).toBe(false)
    note.title('')
    expect(note.$.exists()).toBe(true)
  })

  test('link() yields the absolute pawn address, and it opens the same document', () => {
    const { land, space } = stand()
    const note = space.doc(Note, headAt(land, 777))
    const link = note.$.link()

    expect(link.bin).toHaveLength(22)
    expect(space.doc(Note, link)).toBe(note)
  })

  test('extras() shows keys absent from the schema', () => {
    const { land, space } = stand()
    const note = space.root(Note)
    note.title('своё')

    const other = new Land(peerOf(0x99), fixedClock(2000))
    other.write(ROOT, ROOT, other.nodeAt(555), 'поле-из-будущего', 'solo')
    deliver(land, other)

    expect(note.$.extras()).toEqual(['поле-из-будущего'])
    expect(note.title()).toBe('своё')
  })

  test('the meta slot leaks neither into extras nor into fields', () => {
    const { land, space } = stand()
    const note = space.root(Note)
    note.title('своё')

    const schema = Link.land(peerOf(0x33), new Uint8Array(8))
    const meta = land.post(ROOT, ROOT, '', 'solo')
    land.post(meta.self, ROOT, schema.bin, 'term')

    expect(note.$.extras()).toEqual([])
    expect(note.$.meta()?.str).toBe(schema.str)
    expect(note.title()).toBe('своё')
  })

  test('authors() and changedAt() traverse the subtree', () => {
    const { land, space } = stand()
    const note = space.root(Note)
    note.title('своё')

    const far = new Land(peerOf(0x22), fixedClock(2500))
    createSpace({ land: far, salt: new Uint8Array([1, 2, 3]), report: () => {} }).root(Note).views(9)
    deliver(land, far)

    expect(note.$.authors()).toHaveLength(2)
    expect(note.$.changedAt()?.getTime()).toBe(2500 * 1000)
    expect(space.doc(Note, headAt(land, 31337)).$.changedAt()).toBe(null)
  })

  test('drop() places a tombstone on every key', () => {
    const { space } = stand()
    const note = space.root(Note)

    note.title('было')
    note.views(3)
    note.$.drop()

    expect(note.$.exists()).toBe(false)
    expect(note.title()).toBe('')
    expect(note.views()).toBe(0)
  })

  test('canWrite() is honest about S6: the land does not parse rights yet', () => {
    const { space } = stand()
    expect(space.root(Note).$.canWrite()).toBe(true)
  })
})

describe('by(peer) — who wrote what', () => {
  test('the version of the peer that survived into the current state is visible', () => {
    const { land, space } = stand()
    const mine = peerOf(0x11)
    const theirs = peerOf(0x22)

    const note = space.root(Note)
    note.title('моё')

    expect(note.title.by(mine)).toBe('моё')
    expect(note.title.by(theirs)).toBe('')

    tamper(land, 'title', 'чужое', 0x22, 3000)

    expect(note.title()).toBe('чужое')
    expect(note.title.by(theirs)).toBe('чужое')
  })
})

describe('transaction', () => {
  test('edit() returns the result and wakes subscribers once', () => {
    const { space } = stand()
    const note = space.root(Note)

    let runs = 0
    const stop = watchEffect(() => {
      note.title()
      note.views()
      runs += 1
    })
    expect(runs).toBe(1)

    const out = space.edit(() => {
      note.title('раз')
      note.views(2)
      return 'готово'
    })

    expect(out).toBe('готово')
    expect(runs).toBe(2)
    stop()
  })
})

describe('the price of decisions is named out loud', () => {
  test('a detached method fails EXPRESSIVELY — that is R4', () => {
    const { space } = stand()
    const { set } = space.root(Note).title
    expect(() => set('x')).toThrow(/detaches/)
  })

  test('an empty cell of the kind table fails with the kind name', () => {
    // ТЕСТ ПЕРЕПИСАН, а не удалён. Предметом был `post.tags` — единственный на
    // тот момент несобранный вид; сейчас все девять клеток заполнены (atom,
    // list, dict, text, parts, index, link, links, part), и прежний ассерт
    // проверял бы не механизм, а то, что до вида ещё не дошли руки.
    //
    // Механизм важнее предмета: клетка обязана падать С НАЗВАНИЕМ ВИДА, а не
    // молча возвращать `undefined` — `undefined` не является значением ни одного
    // типа схемы (решение Р6), и он утёк бы в прикладной код как «значение».
    // Поэтому спрашиваем таблицу напрямую, и сторож переживёт появление
    // десятого вида.
    const nowhere = readerFor('нет-такого-вида')
    expect(() => nowhere(coreOf(stand().space), undefined as never, ROOT)).toThrow(/нет-такого-вида/)
  })

  test('no one can open a neighboring land without createSpace({open})', () => {
    const { space } = stand()
    expect(() => space.of(Link.hole)).toThrow(/no one can open/)
  })

  test('the outward land opens with the same handle the next layer will get', () => {
    const { land, space } = stand()
    expect(coreOf(space).land).toBe(land)
  })
})
