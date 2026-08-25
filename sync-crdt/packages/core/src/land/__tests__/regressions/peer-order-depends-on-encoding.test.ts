import { expect, test } from 'vitest'
import { Link } from '../../../binary/link'
import { compare } from '../../lww'
import { ROOT, type Sand } from '../../sand'

/**
 * Регрессия: **исход конкурентной правки зависит от того, в какой кодировке
 * записан `peer`**.
 *
 * При равном `time` победителя выбирает `peer ↑` — арбитр, который обязан быть
 * одним и тем же у всех реплик. Пока `Sand.peer` — строка, `compare` сравнивает
 * её оператором `<`, то есть по кодовым единицам UTF-16. Для hex это совпадает
 * с порядком байт. Для base64url — **нет**: алфавит ставит цифры (52…61) после
 * букв, а `-`/`_` (62/63) в ASCII идут до цифр.
 *
 * Опасность не в том, что один из порядков «неправильный» — оба детерминированы
 * и оба сходятся. Опасность в том, что их **два**, и тест на сходимость их не
 * различит: каждая пара реплик сходится сама с собой, просто к разным ответам.
 *
 * Канон — байты (ADR-015). Этот тест сторожит сам факт расхождения, чтобы при
 * переезде слоя ленда на бинарный юнит его нельзя было не заметить.
 */

const PEER_LOW = new Uint8Array([0xf4, 0, 0, 0, 0, 0, 0, 0])
const PEER_HIGH = new Uint8Array([0xf8, 0, 0, 0, 0, 0, 0, 0])

function hex(bin: Uint8Array): string {
  let out = ''
  for (const byte of bin) out += byte.toString(16).padStart(2, '0')
  return out
}

function at(peer: string): Sand {
  return { self: 's', head: ROOT, lead: ROOT, peer, time: 1, tick: 0, value: 1 }
}

test('link text and bytes yield the OPPOSITE peer order', () => {
  const low = Link.peer(PEER_LOW)
  const high = Link.peer(PEER_HIGH)

  // По байтам порядок очевиден: 0xf4 < 0xf8.
  expect(low.bin[0]).toBeLessThan(high.bin[0] as number)

  // А в тексте первые шесть бит дают цифру 61 (`9`) против 62 (`-`), и в ASCII
  // `-` (0x2D) меньше `9` (0x39) — знак переворачивается.
  expect(low.str).toBe('9AAAAAAAAAA')
  expect(high.str).toBe('-AAAAAAAAAA')
  expect(low.str < high.str).toBe(false)

  // Тот же самый боевой `compare`, те же два пира, одно время — разные победители.
  expect(Math.sign(compare(at(hex(low.bin)), at(hex(high.bin))))).toBe(-1)
  expect(Math.sign(compare(at(low.str), at(high.str)))).toBe(+1)
})

test('hex preserves byte order across the whole range', () => {
  // Кодировка годится в арбитры ровно тогда, когда сравнение её строк совпадает
  // с сравнением байт. Для hex это проверяется исчерпывающе по одному байту.
  for (let a = 0; a < 256; a++) {
    for (let b = 0; b < 256; b++) {
      const byBytes = Math.sign(a - b)
      const left = a.toString(16).padStart(2, '0')
      const right = b.toString(16).padStart(2, '0')
      const byText = left === right ? 0 : left < right ? -1 : 1
      expect(byText).toBe(byBytes)
    }
  }
})

test('base64url does not preserve byte order — visible on a single byte', () => {
  // Зеркало предыдущего теста: ищем первую пару, на которой кодировка врёт.
  // Если её не окажется, значит алфавит сменили — и ADR-015 надо пересмотреть.
  const broken: [number, number][] = []
  for (let a = 0; a < 256 && broken.length === 0; a++) {
    for (let b = a + 1; b < 256; b++) {
      const left = Link.peer(new Uint8Array([a, 0, 0, 0, 0, 0, 0, 0])).str
      const right = Link.peer(new Uint8Array([b, 0, 0, 0, 0, 0, 0, 0])).str
      if (!(left < right)) {
        broken.push([a, b])
        break
      }
    }
  }
  expect(broken).toHaveLength(1)
})
