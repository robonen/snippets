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

describe('словарь: чтение и запись', () => {
  test('непрочитанный ключ отдаёт blank своего типа', () => {
    const shelf = stand().space.root(Shelf)
    expect(shelf.counts('нет')).toBe(0)
    expect(shelf.labels(7)).toBe('')
    expect(shelf.counts.keys()).toEqual([])
    expect(shelf.counts.size()).toBe(0)
    expect(shelf.counts.has('нет')).toBe(false)
  })

  test('записанное читается обратно, x(key, next) возвращает победителя LWW', () => {
    const shelf = stand().space.root(Shelf)
    expect(shelf.counts('👍', 1)).toBe(1)
    expect(shelf.counts('👍')).toBe(1)
    expect(shelf.counts.set('👍', 2)).toBe(2)
    expect(shelf.counts('👍')).toBe(2)
    expect(shelf.counts.has('👍')).toBe(true)
  })

  test('ключи ЧИСЛА доезжают числами, а не строками', () => {
    const shelf = stand().space.root(Shelf)
    shelf.labels(7, 'семь')
    shelf.labels(8, 'восемь')
    expect(shelf.labels.keys()).toEqual([7, 8])
    expect(shelf.labels(7)).toBe('семь')
  })

  test('порядок ключей — ВСТАВОЧНЫЙ', () => {
    // Регрессия против baza: там `dive` шёл через `add` с `lead = hole`, и ключи
    // ложились в обратном порядке — побочный эффект якоря, не заявленный в
    // контракте (реестр, п. 29). Здесь порядок — часть контракта.
    const shelf = stand().space.root(Shelf)
    shelf.counts('xxx', 1)
    shelf.counts('yyy', 2)
    shelf.counts('zzz', 3)
    expect(shelf.counts.keys()).toEqual(['xxx', 'yyy', 'zzz'])
  })

  test('идемпотентная запись — НОЛЬ юнитов, первая — ровно два', () => {
    const at = stand()
    const shelf = at.space.root(Shelf)
    // Первая запись в поле: ключевой юнит поля, ключевой юнит ключа и значение.
    expect(born(at, () => shelf.counts('a', 1))).toBe(3)
    expect(born(at, () => shelf.counts('a', 1))).toBe(0)
    expect(born(at, () => shelf.counts('a', shelf.counts('a')))).toBe(0)
    // Ключ уже есть — второй ключ стоит ключевой юнит плюс значение.
    expect(born(at, () => shelf.counts('b', 2))).toBe(2)
  })

  test('delete и clear', () => {
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

  test('rename СОХРАНЯЕТ поддерево: тот же self, другое имя', () => {
    const shelf = stand().space.root(Shelf)
    shelf.counts('было', 42)
    shelf.counts('рядом', 1)
    shelf.counts.rename('было', 'стало')
    expect(shelf.counts.keys()).toEqual(['стало', 'рядом'])
    expect(shelf.counts('стало')).toBe(42)
    expect(shelf.counts('было')).toBe(0)
  })

  test('rename на занятое имя не оставляет двух ключей под одним именем', () => {
    const at = stand()
    const shelf = at.space.root(Shelf)
    shelf.counts('a', 1)
    shelf.counts('b', 2)
    shelf.counts.rename('a', 'b')
    expect(shelf.counts.keys()).toEqual(['b'])
    expect(shelf.counts('b')).toBe(1)
  })

  test('запись НЕ реентерантна: сеттер не перевычисляет канал изнутри себя', () => {
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

describe('словарь: мусор от чужой версии', () => {
  test('ключ чужого типа пропускается, чтение не бросает, Issue есть', () => {
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

  test('meta-слот не протекает в keys()', () => {
    // Ключевой юнит с ПУСТЫМ именем — это ссылка на схему, а не ключ данных
    // (docs/05 §3.9 и §9). Протечь в `keys()` он права не имеет.
    const at = stand()
    const shelf = at.space.root(Shelf)
    shelf.counts('a', 1)
    tamper(at, slotOf(at, 'counts'), '')

    expect(shelf.counts.keys()).toEqual(['a'])
    expect(shelf.counts.size()).toBe(1)
  })

  test('значение чужого типа даёт blank и Issue, а не бросок', () => {
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

describe('словарь: слияние двух реплик', () => {
  test('один ключ, вставленный в РАЗНЫЕ позиции, даёт ОДНО поддерево', () => {
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

  test('«Dictionary merge» — значение под ключом разводится по LWW', () => {
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

describe('части: документ по ключу', () => {
  test('часть есть всегда, пишется полями и попадает в keys()', () => {
    const shelf = stand().space.root(Shelf)
    shelf.cards('c1').title('Первый!')
    shelf.cards('c2').rank(3)

    expect(shelf.cards('c1').title()).toBe('Первый!')
    expect(shelf.cards('c2').rank()).toBe(3)
    expect(shelf.cards.keys()).toEqual(['c1', 'c2'])
    expect(shelf.cards.size()).toBe(2)
  })

  test('идентичность: два обращения дают ОДИН объект', () => {
    const shelf = stand().space.root(Shelf)
    expect(shelf.cards('c1')).toBe(shelf.cards('c1'))
  })

  test('has НЕ создаёт ключ, обращение — создаёт', () => {
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

  test('delete и clear убирают ключ из keys()', () => {
    const shelf = stand().space.root(Shelf)
    shelf.cards('c1').title('раз')
    shelf.cards('c2').title('два')
    shelf.cards.delete('c1')
    expect(shelf.cards.keys()).toEqual(['c2'])
    shelf.cards.clear()
    expect(shelf.cards.keys()).toEqual([])
  })

  test('две реплики, заведшие один ключ, сходятся к ОДНОМУ документу', () => {
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

describe('индекс: словарь словарей', () => {
  test('чтение отсутствующей ветки НЕ создаёт ни одного юнита', () => {
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

  test('ensure заводит ветку, чтение её находит, delete убирает', () => {
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

  test('ensert идемпотентен и на глубине 1', () => {
    const at = stand()
    const shelf = at.space.root(Shelf)
    const first = shelf.flat.ensure(['один'])
    expect(born(at, () => void shelf.flat.ensure(['один']))).toBe(0)
    expect(shelf.flat(['один'])).toBe(first)
    expect(shelf.flat.keys([])).toEqual(['один'])
  })

  test('путь не той длины не проходит и в рантайме', () => {
    const shelf = stand().space.root(Shelf)
    // @ts-expect-error путь короче объявленной глубины
    expect(() => shelf.archive(['2026'])).toThrow(/глубины 3/)
    // @ts-expect-error префикс не может быть полной глубины
    expect(() => shelf.archive.keys(['a', 'b', 'c'])).toThrow(/префикс/)
  })

  test('две реплики, заведшие один путь, сходятся к одному документу', () => {
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

  test('приезд ветки от соседа будит читателя', () => {
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
