import { expect, test } from 'vitest'
import { Link } from '../../../binary/link'
import { SandUnit, shotKey } from '../../../binary/unit'
import { fixedClock } from '../../../land/clock'
import { Land } from '../../../land/land'
import { memoryStore } from '../../../store/memory'
import { atom, createSpace, model, t } from '../../index'

/**
 * Закрытая дыра: **обычный текст не помещался в юнит**.
 *
 * Значение живёт внутри санда, а туда влезает 62 байта ([03 §2](../../../../../../docs/03-binary-format.md)).
 * Это 31 кириллическая буква — половина заголовка. Всё, что длиннее, формат
 * выносит в `ball`, а хранилища для `ball` не было: долг был записан на S5, и до
 * него `post.title('Заголовок обычной длины…')` ОТКАЗЫВАЛ — самый заметный
 * пользователю дефект во всём проекте.
 *
 * Тест держался красным намеренно и позеленел, когда S5 дыру закрыла. Теперь он
 * сторожит закрытое, и потому проверяет ТРИ вещи, а не одну:
 *
 *   1. запись длинного значения проходит и читается обратно;
 *   2. значение действительно уехало в `ball` — иначе тест зеленел бы от того,
 *      что кто-то поднял потолок inline и сломал формат;
 *   3. оно переживает круг через хранилище, потому что дыра была именно там:
 *      юнит без приложенного балла ни сохранить, ни поднять нельзя.
 */

const Memo = model('memo', { title: atom(t.string) })

declare module '../../registry' {
  interface Models {
    memo: typeof Memo
  }
}

/** 47 букв, 91 байт UTF-8 — заголовок, каких пишут тысячами. */
const LONG = 'Заголовок обычной длины для заметки пользователя'

const LAND = Link.land(Link.peer(new Uint8Array(8).fill(0xa1)), new Uint8Array(8))

function landOf(byte = 1): Land {
  const land = new Land(Link.peer(new Uint8Array(8).fill(byte)), fixedClock(1000))
  land.track()
  return land
}

test('a short value writes and reads', () => {
  const doc = createSpace({ land: landOf() }).root(Memo)
  doc.title('Привет')
  expect(doc.title()).toBe('Привет')
})

test('an ordinary Russian title writes and reads', () => {
  const doc = createSpace({ land: landOf() }).root(Memo)
  expect(new TextEncoder().encode(LONG).length).toBeGreaterThan(62)

  doc.title(LONG)
  expect(doc.title()).toBe(LONG)
})

test('a long value lives in ball, not stretched inline', () => {
  // Без этой проверки тест позеленел бы и от того, что кто-то «починил» дыру,
  // подняв потолок inline: формат этого не позволяет (потолок 62 Б — маркер 63
  // занят выносом, ADR-расхождение №20), и такая починка была бы поломкой.
  const land = landOf()
  createSpace({ land }).root(Memo).title(LONG)

  const part = land.part()
  const big = part.units.filter(unit => unit instanceof SandUnit && unit.big())
  expect(big).toHaveLength(1)

  const sand = big[0] as SandUnit
  expect(sand.size()).toBeGreaterThan(62)
  // И балл ПРИЛОЖЕН: юнит, объявивший вынос без байтов, не кодируется вовсе —
  // в формате нет маркера «балл отделён» (docs/03 §2, «Открытый вопрос»).
  expect(part.balls.get(shotKey(sand.shot()))?.length).toBe(sand.size())
})

test('a long value survives a round trip through the store', () => {
  // Ровно то, чего не было: `ball` некуда сохранить. Круг идёт через настоящую
  // память хранилища, то есть через образ-арену, а не через `packEncode` в
  // переменную.
  const store = memoryStore()
  const one = landOf()
  createSpace({ land: one }).root(Memo).title(LONG)
  store.save(LAND, one.flush(LAND))

  const two = landOf(2)
  two.adopt(store.load(LAND))
  expect(createSpace({ land: two }).root(Memo).title()).toBe(LONG)
})
