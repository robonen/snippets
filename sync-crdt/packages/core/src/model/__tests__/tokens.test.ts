// Гейт корректности токенизатора — чистые функции, без ленда и файберов.
//
// Десять примеров из `baza/text/tokens/tokens.test.ts` переносятся ДОСЛОВНО:
// это единственная часть корпуса, где сравнивать нечего, кроме выдачи, и потому
// она годится в эталон как есть. Единственная правка — `''`: у baza там `null`,
// потому что она возвращает результат `String.match` как есть; `null` в роли
// «токенов нет» — это второй сентинел на том же месте, где уже есть пустой
// массив (правило 3 горячего пути), поэтому у нас пустая выдача.

import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { fitTokens, single, splitParagraphs, tokenize, utf8Len } from '../tokens'

describe('токены: корпус baza дословно', () => {
  test('пустая строка', () => {
    // baza: `null`. Один сентинел на API — пустая выдача.
    expect(tokenize('')).toEqual([])
  })

  test('переводы строк', () => {
    expect(tokenize('\n\r\n')).toEqual(['\n', '\r\n'])
  })

  test('числа', () => {
    expect(tokenize('123')).toEqual(['123'])
  })

  test('эмодзи', () => {
    expect(tokenize('😀😁')).toEqual(['😀', '😁'])
  })

  test('эмодзи с модификатором тона', () => {
    expect(tokenize('👩🏿👩🏿')).toEqual(['👩🏿', '👩🏿'])
  })

  test('составное эмодзи через ZWJ — ОДИН токен', () => {
    // Семья из четырёх кодовых точек обязана быть неделимой: разрежь её
    // слиянием пополам — и получится не человек.
    expect(tokenize('👩🏿‍🤝‍🧑🏿👩🏿‍🤝‍🧑🏿')).toEqual(['👩🏿‍🤝‍🧑🏿', '👩🏿‍🤝‍🧑🏿'])
  })

  test('слово с двойным пробелом', () => {
    expect(tokenize('foo1  bar2')).toEqual(['foo1', ' ', ' bar2'])
  })

  test('слово с диакритикой', () => {
    expect(tokenize('Е́е́')).toEqual(['Е́е́'])
  })

  test('слово с пунктуацией', () => {
    expect(tokenize('foo--bar')).toEqual(['foo', '--', 'bar'])
  })

  test('CamelCase — граница слова', () => {
    expect(tokenize('Foo1BAR2')).toEqual(['Foo1', 'BAR2'])
  })
})

describe('токены: инвариант 1 — ведущий пробел принадлежит следующему', () => {
  test('пробел не становится отдельным юнитом', () => {
    // Отдельный пробел был бы лишней точкой конфликта: два пира, вставляющие
    // соседние слова, правили бы общий разделитель.
    expect(tokenize('foo bar')).toEqual(['foo', ' bar'])
    expect(tokenize('foo lol bar')).toEqual(['foo', ' lol', ' bar'])
    expect(tokenize('foo  BarBar')).toEqual(['foo', ' ', ' Bar', 'Bar'])
  })
})

describe('токены: инвариант 2 — тотальность', () => {
  /**
   * ЧЕТЫРЕ ЖИВЫХ КОНТРПРИМЕРА К baza.
   *
   * `String.match` с флагом `g` молча ПЕРЕШАГИВАЕТ позицию, на которой ни одно
   * правило не сошлось: символ исчезает, ошибки нет. На наборе правил baza
   * (`forbid_after(line_end)` плюс узкий класс ведущего пробела `[ \u00a0]`)
   * это ловится на обычном отступе и на любом пробеле, кроме ASCII-пробела и
   * NBSP. Для СЛИВАЕМОГО текста это не косметика: `str()` определён как склейка
   * токенов, значит запись теряла бы символы у автора.
   */
  const LOST = [
    'foo\n  bar',
    '\u2003a',
    '\u00a0\u2003x',
    'a\u2028b',
  ]

  test('символы, которые терял токенизатор baza, доезжают целиком', () => {
    for (const text of LOST) expect(tokenize(text).join('')).toBe(text)
  })

  test('склейка токенов равна исходной строке — на чём угодно', () => {
    // Алфавит намеренно злой: экзотические пробелы, диакритика, суррогатные
    // пары, разделители строк и пунктуация вперемешку.
    const alphabet = fc.constantFrom(
      'a', 'B', '1', ' ', '\n', '\r', '\t', '.', '-', '(', ')',
      '\u00a0', '\u2003', '\u2028', '\u200d', '\u{1f600}', '\u{1f469}\u{1f3ff}\u200d\u{1f91d}\u200d\u{1f9d1}\u{1f3ff}', '\u0415\u0301', '\u0439',
    )
    fc.assert(
      fc.property(fc.array(alphabet, { maxLength: 24 }), parts => {
        const text = parts.join('')
        expect(tokenize(text).join('')).toBe(text)
      }),
      { numRuns: 3000 },
    )
  })

  test('ни один токен не пуст: пустое совпадение зациклило бы разбор', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), text => {
        for (const word of tokenize(text)) expect(word.length).toBeGreaterThan(0)
      }),
      { numRuns: 1000 },
    )
  })
})

describe('абзацы', () => {
  test('перевод строки принадлежит СВОЕМУ абзацу', () => {
    expect(splitParagraphs('a\nb')).toEqual(['a\n', 'b'])
    expect(splitParagraphs('a\n')).toEqual(['a\n'])
    expect(splitParagraphs('a\n\nb')).toEqual(['a\n', '\n', 'b'])
    expect(splitParagraphs('')).toEqual([])
  })

  test('склейка абзацев равна исходной строке', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), text => {
        expect(splitParagraphs(text).join('')).toBe(text)
      }),
      { numRuns: 2000 },
    )
  })

  test('одним абзацем читается то, у чего `\\n` только в конце', () => {
    expect(single('abc')).toBe(true)
    expect(single('abc\n')).toBe(true)
    expect(single('a\nb')).toBe(false)
    expect(single('')).toBe(false)
  })
})

describe('длинное слово режется под потолок юнита', () => {
  test('слово в 200 знаков распадается, а склейка сохраняется', () => {
    const word = 'z'.repeat(200)
    const cut = fitTokens([word])
    expect(cut.length).toBeGreaterThan(1)
    expect(cut.join('')).toBe(word)
    for (const piece of cut) expect(utf8Len(piece)).toBeLessThanOrEqual(60)
  })

  test('короткие слова возвращаются ТЕМ ЖЕ массивом — без аллокации', () => {
    const words = tokenize('обычная строка без длинных слов')
    expect(fitTokens(words)).toBe(words)
  })

  test('суррогатная пара не разрезается: одинокий суррогат уронил бы кодек', () => {
    // 40 эмодзи по 4 байта — 160 байт, то есть три куска при потолке 60.
    const word = '😀'.repeat(40)
    const cut = fitTokens([word])
    expect(cut.join('')).toBe(word)
    for (const piece of cut) {
      expect(utf8Len(piece)).toBeLessThanOrEqual(60)
      // Ни один кусок не начинается и не кончается половинкой пары.
      expect([...piece].join('')).toBe(piece)
      expect(piece.length % 2).toBe(0)
    }
  })

  test('utf8Len совпадает с TextEncoder', () => {
    const encoder = new TextEncoder()
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), text => {
        expect(utf8Len(text)).toBe(encoder.encode(text).length)
      }),
      { numRuns: 2000 },
    )
  })
})
