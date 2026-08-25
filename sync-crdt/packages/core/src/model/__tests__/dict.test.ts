// Гейт корректности словаря, частей и индекса.
//
// Порт корпуса `dict.test.ts` / `empire.test.ts` из baza — с ИСПРАВЛЕННЫМИ
// ожиданиями там, где оригинал зафиксировал эталоном собственный дефект:
// порядок ключей был обратен вставке и нигде не заявлен (реестр, п. 29;
// docs/05 §7.15), а `self` ключа выводился из точки вставки, отчего один ключ
// давал два поддерева (реестр, п. 30).

import { flush, watchEffect } from '@sync/fiber'
import { describe, expect, test } from 'vitest'
import { ROOT, type LocalId } from '../../land/view'
import { coreOf } from '../index'
import { born, deliver, stand, sync, tamper, type Stand } from './shelf-stand'
import { Shelf } from './shelf'

/** Слот поля документа — то, под чем лежат ключевые юниты. */
function slotOf(at: Stand, field: string): LocalId {
  return coreOf(at.space).keyIndex(ROOT).get(field) as LocalId
}

/** Сколько РЕАЛЬНЫХ детей у слота поля: два поддерева на один ключ видно здесь. */
function kidsOf(at: Stand, field: string): number {
  const slot = slotOf(at, field)
  return slot === undefined ? 0 : coreOf(at.space).order(slot).length
}

describe('dict: reads and writes', () => {
  test('an unread key returns the blank of its type', () => {
    const shelf = stand().space.root(Shelf)
    expect(shelf.counts('нет')).toBe(0)
    expect(shelf.labels(7)).toBe('')
    expect(shelf.counts.keys()).toEqual([])
    expect(shelf.counts.size()).toBe(0)
    expect(shelf.counts.has('нет')).toBe(false)
  })

  test('what was written reads back, x(key, next) returns the LWW winner', () => {
    const shelf = stand().space.root(Shelf)
    expect(shelf.counts('👍', 1)).toBe(1)
    expect(shelf.counts('👍')).toBe(1)
    expect(shelf.counts.set('👍', 2)).toBe(2)
    expect(shelf.counts('👍')).toBe(2)
    expect(shelf.counts.has('👍')).toBe(true)
  })

  test('NUMBER keys arrive as numbers, not strings', () => {
    const shelf = stand().space.root(Shelf)
    shelf.labels(7, 'семь')
    shelf.labels(8, 'восемь')
    expect(shelf.labels.keys()).toEqual([7, 8])
    expect(shelf.labels(7)).toBe('семь')
  })

  test('key order is INSERTION order', () => {
    // Регрессия против baza: там `dive` шёл через `add` с `lead = hole`, и ключи
    // ложились в обратном порядке — побочный эффект якоря, не заявленный в
    // контракте (реестр, п. 29). Здесь порядок — часть контракта.
    const shelf = stand().space.root(Shelf)
    shelf.counts('xxx', 1)
    shelf.counts('yyy', 2)
    shelf.counts('zzz', 3)
    expect(shelf.counts.keys()).toEqual(['xxx', 'yyy', 'zzz'])
  })

  test('an idempotent write is ZERO units, the first one exactly two', () => {
    const at = stand()
    const shelf = at.space.root(Shelf)
    // Первая запись в поле: ключевой юнит поля, ключевой юнит ключа и значение.
    expect(born(at, () => shelf.counts('a', 1))).toBe(3)
    expect(born(at, () => shelf.counts('a', 1))).toBe(0)
    expect(born(at, () => shelf.counts('a', shelf.counts('a')))).toBe(0)
    // Ключ уже есть — второй ключ стоит ключевой юнит плюс значение.
    expect(born(at, () => shelf.counts('b', 2))).toBe(2)
  })

  test('delete and clear', () => {
    const shelf = stand().space.root(Shelf)
    shelf.counts('a', 1)
    shelf.counts('b', 2)
    shelf.counts.delete('a')
    expect(shelf.counts.keys()).toEqual(['b'])
    expect(shelf.counts.has('a')).toBe(false)
    expect(shelf.counts('a')).toBe(0)
    shelf.counts.clear()
    expect(shelf.counts.keys()).toEqual([])
  })

  test('rename KEEPS the subtree: same self, different name', () => {
    const shelf = stand().space.root(Shelf)
    shelf.counts('было', 42)
    shelf.counts('рядом', 1)
    shelf.counts.rename('было', 'стало')
    expect(shelf.counts.keys()).toEqual(['стало', 'рядом'])
    expect(shelf.counts('стало')).toBe(42)
    expect(shelf.counts('было')).toBe(0)
  })

  test('rename onto a taken name does not leave two keys under one name', () => {
    const at = stand()
    const shelf = at.space.root(Shelf)
    shelf.counts('a', 1)
    shelf.counts('b', 2)
    shelf.counts.rename('a', 'b')
    expect(shelf.counts.keys()).toEqual(['b'])
    expect(shelf.counts('b')).toBe(1)
  })

  test('writes are NOT reentrant: the setter does not recompute the channel from within itself', () => {
    // У baza `atom.vary_of` заканчивался на `return this.vary_of(peer)` —
    // канал считался из самого себя (реестр, п. 37).
    const shelf = stand().space.root(Shelf)
    shelf.counts('n', 1)

    let runs = 0
    const stop = watchEffect(() => {
      runs += 1
      shelf.counts('n')
    })
    expect(runs).toBe(1)

    shelf.counts('n', 2)
    flush()
    expect(runs).toBe(2)

    // Второе подряд значение обязано доехать (реестр, п. 43).
    shelf.counts('n', 3)
    flush()
    expect(runs).toBe(3)
    expect(shelf.counts('n')).toBe(3)
    stop()
  })
})

describe('dict: garbage from a foreign version', () => {
  test('a key of a foreign type is skipped, the read does not throw, an Issue is there', () => {
    const at = stand()
    const shelf = at.space.root(Shelf)
    shelf.counts('a', 1)
    // В словарь со строковыми ключами приезжает ключ-массив.
    tamper(at, slotOf(at, 'counts'), [1, 2])

    expect(() => shelf.counts.keys()).not.toThrow()
    expect(shelf.counts.keys()).toEqual(['a'])
    expect(at.issues.some(issue => issue.kind === 'decode')).toBe(true)
    expect(shelf.counts.issue()?.expected).toBe('key')
  })

  test('the meta slot does not leak into keys()', () => {
    // Ключевой юнит с ПУСТЫМ именем — это ссылка на схему, а не ключ данных
    // (docs/05 §3.9 и §9). Протечь в `keys()` он права не имеет.
    const at = stand()
    const shelf = at.space.root(Shelf)
    shelf.counts('a', 1)
    tamper(at, slotOf(at, 'counts'), '')

    expect(shelf.counts.keys()).toEqual(['a'])
    expect(shelf.counts.size()).toBe(1)
  })

  test('a value of a foreign type yields blank and an Issue, not a throw', () => {
    const at = stand()
    const shelf = at.space.root(Shelf)
    shelf.counts('a', 1)
    const slot = coreOf(at.space).keyIndex(slotOf(at, 'counts')).get('a') as LocalId
    tamper(at, slot, 'строка вместо числа')

    expect(() => shelf.counts('a')).not.toThrow()
    expect(shelf.counts('a')).toBe(0)
    expect(at.issues.some(issue => issue.kind === 'decode')).toBe(true)
  })
})

describe('dict: merging two replicas', () => {
  test('one key inserted at DIFFERENT positions yields ONE subtree', () => {
    // Реестр, п. 30. У baza `self` ключа выводился из `head + lead`, то есть от
    // ТОЧКИ ВСТАВКИ: два пира, добавившие один ключ в разные места, получали два
    // поддерева на один ключ. Наш адрес контентный — `H(соль ‖ head ‖ ключ)`, —
    // и такие вставки схлопываются по LWW.
    const left = stand(0x22)
    const right = stand(0x33)

    left.space.root(Shelf).counts('a', 1)
    left.space.root(Shelf).counts('k', 2)
    // У правой реплики «k» — ПЕРВЫЙ ключ, то есть другая точка вставки.
    right.space.root(Shelf).counts('k', 5)

    sync(left, right)

    const keys = left.space.root(Shelf).counts.keys()
    expect(right.space.root(Shelf).counts.keys()).toEqual(keys)
    expect(keys.filter(key => key === 'k')).toHaveLength(1)
    // Детей у слота ровно столько же, сколько ключей: ни одного дубля.
    expect(kidsOf(left, 'counts')).toBe(keys.length)
    expect(left.space.root(Shelf).counts('k')).toBe(right.space.root(Shelf).counts('k'))
  })

  test('«Dictionary merge» — the value under a key is settled by LWW', () => {
    const left = stand(0x22)
    const right = stand(0x33)

    left.space.root(Shelf).counts('n', 666)
    right.clock.advance(2)
    right.space.root(Shelf).counts('n', 777)

    sync(left, right)
    expect(left.space.root(Shelf).counts('n')).toBe(777)
    expect(right.space.root(Shelf).counts('n')).toBe(777)
  })
})

describe('parts: a document by key', () => {
  test('a part always exists, is written by fields, and shows up in keys()', () => {
    const shelf = stand().space.root(Shelf)
    shelf.cards('c1').title('Первый!')
    shelf.cards('c2').rank(3)

    expect(shelf.cards('c1').title()).toBe('Первый!')
    expect(shelf.cards('c2').rank()).toBe(3)
    expect(shelf.cards.keys()).toEqual(['c1', 'c2'])
    expect(shelf.cards.size()).toBe(2)
  })

  test('identity: two accesses yield ONE object', () => {
    const shelf = stand().space.root(Shelf)
    expect(shelf.cards('c1')).toBe(shelf.cards('c1'))
  })

  test('has does NOT create a key, an access does', () => {
    const at = stand()
    const shelf = at.space.root(Shelf)
    expect(born(at, () => void shelf.cards.has('c1'))).toBe(0)
    expect(shelf.cards.keys()).toEqual([])

    // Обращение материализует ключевой юнит: иначе `cards('c1').title('!')`
    // оставил бы словарь пустым, а поля — сиротами (docs/05 §2.5).
    expect(born(at, () => void shelf.cards('c1'))).toBe(2)
    expect(shelf.cards.keys()).toEqual(['c1'])
    // Повторное обращение идемпотентно: адрес контентный.
    expect(born(at, () => void shelf.cards('c1'))).toBe(0)
  })

  test('delete and clear remove the key from keys()', () => {
    const shelf = stand().space.root(Shelf)
    shelf.cards('c1').title('раз')
    shelf.cards('c2').title('два')
    shelf.cards.delete('c1')
    expect(shelf.cards.keys()).toEqual(['c2'])
    shelf.cards.clear()
    expect(shelf.cards.keys()).toEqual([])
  })

  test('two replicas that created one key converge to ONE document', () => {
    const left = stand(0x22)
    const right = stand(0x33)
    left.space.root(Shelf).cards('c1').title('слева')
    right.clock.advance(2)
    right.space.root(Shelf).cards('c1').rank(9)

    sync(left, right)
    expect(left.space.root(Shelf).cards.keys()).toEqual(['c1'])
    expect(left.space.root(Shelf).cards('c1').title()).toBe('слева')
    expect(left.space.root(Shelf).cards('c1').rank()).toBe(9)
    expect(kidsOf(left, 'cards')).toBe(1)
  })
})

describe('index: a dict of dicts', () => {
  test('reading a missing branch creates NOT A SINGLE unit', () => {
    // Новый кейс корпуса (docs/05 §8.1, `empire.test.ts` 1 → 3).
    const at = stand()
    const shelf = at.space.root(Shelf)
    let seen: unknown = 'не трогали'
    expect(born(at, () => {
      seen = shelf.archive(['2026', '08', 'vue'])
    })).toBe(0)
    expect(seen).toBe(null)
    expect(shelf.archive.keys([])).toEqual([])
  })

  test('ensure creates a branch, a read finds it, delete removes it', () => {
    const shelf = stand().space.root(Shelf)
    shelf.archive.ensure(['2026', '08', 'vue']).title('Файберы')
    shelf.archive.ensure(['2026', '07', 'crdt']).title('Ленд')

    expect(shelf.archive(['2026', '08', 'vue'])?.title()).toBe('Файберы')
    expect(shelf.archive(['2026', '08', 'нет'])).toBe(null)
    expect(shelf.archive(['2025', '08', 'vue'])).toBe(null)

    expect(shelf.archive.keys([])).toEqual(['2026'])
    expect(shelf.archive.keys(['2026'])).toEqual(['08', '07'])
    expect(shelf.archive.keys(['2026', '08'])).toEqual(['vue'])

    shelf.archive.delete(['2026', '08', 'vue'])
    expect(shelf.archive(['2026', '08', 'vue'])).toBe(null)
    expect(shelf.archive.keys(['2026', '08'])).toEqual([])
    // Соседняя ветка цела: удаляется ЛИСТ, а не путь.
    expect(shelf.archive(['2026', '07', 'crdt'])?.title()).toBe('Ленд')
  })

  test('ensert is idempotent at depth 1 too', () => {
    const at = stand()
    const shelf = at.space.root(Shelf)
    const first = shelf.flat.ensure(['один'])
    expect(born(at, () => void shelf.flat.ensure(['один']))).toBe(0)
    expect(shelf.flat(['один'])).toBe(first)
    expect(shelf.flat.keys([])).toEqual(['один'])
  })

  test('a path of the wrong length is rejected at runtime too', () => {
    const shelf = stand().space.root(Shelf)
    // @ts-expect-error путь короче объявленной глубины
    expect(() => shelf.archive(['2026'])).toThrow(/depth 3/)
    // @ts-expect-error префикс не может быть полной глубины
    expect(() => shelf.archive.keys(['a', 'b', 'c'])).toThrow(/prefix/)
  })

  test('two replicas that created one path converge to one document', () => {
    const left = stand(0x22)
    const right = stand(0x33)
    left.space.root(Shelf).archive.ensure(['2026', '08', 'vue']).title('слева')
    right.clock.advance(2)
    right.space.root(Shelf).archive.ensure(['2026', '08', 'vue']).rank(4)

    sync(left, right)
    expect(left.space.root(Shelf).archive.keys(['2026', '08'])).toEqual(['vue'])
    const doc = left.space.root(Shelf).archive(['2026', '08', 'vue'])
    expect(doc?.title()).toBe('слева')
    expect(doc?.rank()).toBe(4)
  })

  test('a branch arriving from a neighbor wakes the reader', () => {
    const left = stand(0x22)
    const right = stand(0x33)
    const shelf = left.space.root(Shelf)

    let seen: string | null = null
    const stop = watchEffect(() => {
      seen = shelf.archive(['2026', '08', 'vue'])?.title() ?? null
    })
    expect(seen).toBe(null)

    right.space.root(Shelf).archive.ensure(['2026', '08', 'vue']).title('издалека')
    deliver(left, right)
    expect(seen).toBe('издалека')
    stop()
  })
})
