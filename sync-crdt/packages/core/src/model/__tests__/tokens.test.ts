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

describe('tokens: the baza corpus verbatim', () => {
  test('empty string', () => {
    // baza: `null`. Один сентинел на API — пустая выдача.
    expect(tokenize('')).toEqual([])
  })

  test('newlines', () => {
    expect(tokenize('\n\r\n')).toEqual(['\n', '\r\n'])
  })

  test('numbers', () => {
    expect(tokenize('123')).toEqual(['123'])
  })

  test('emoji', () => {
    expect(tokenize('😀😁')).toEqual(['😀', '😁'])
  })

  test('emoji with a tone modifier', () => {
    expect(tokenize('👩🏿👩🏿')).toEqual(['👩🏿', '👩🏿'])
  })

  test('a compound emoji via ZWJ is ONE token', () => {
    // Семья из четырёх кодовых точек обязана быть неделимой: разрежь её
    // слиянием пополам — и получится не человек.
    expect(tokenize('👩🏿‍🤝‍🧑🏿👩🏿‍🤝‍🧑🏿')).toEqual(['👩🏿‍🤝‍🧑🏿', '👩🏿‍🤝‍🧑🏿'])
  })

  test('a word with a double space', () => {
    expect(tokenize('foo1  bar2')).toEqual(['foo1', ' ', ' bar2'])
  })

  test('a word with diacritics', () => {
    expect(tokenize('Е́е́')).toEqual(['Е́е́'])
  })

  test('a word with punctuation', () => {
    expect(tokenize('foo--bar')).toEqual(['foo', '--', 'bar'])
  })

  test('CamelCase is a word boundary', () => {
    expect(tokenize('Foo1BAR2')).toEqual(['Foo1', 'BAR2'])
  })
})

describe('tokens: invariant 1 — a leading space belongs to the next token', () => {
  test('a space does not become a separate unit', () => {
    // Отдельный пробел был бы лишней точкой конфликта: два пира, вставляющие
    // соседние слова, правили бы общий разделитель.
    expect(tokenize('foo bar')).toEqual(['foo', ' bar'])
    expect(tokenize('foo lol bar')).toEqual(['foo', ' lol', ' bar'])
    expect(tokenize('foo  BarBar')).toEqual(['foo', ' ', ' Bar', 'Bar'])
  })
})

describe('tokens: invariant 2 — totality', () => {
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

  test('characters the baza tokenizer lost arrive whole', () => {
    for (const text of LOST) expect(tokenize(text).join('')).toBe(text)
  })

  test('joining tokens equals the source string — on anything', () => {
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

  test('no token is empty: an empty match would loop the parse', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), text => {
        for (const word of tokenize(text)) expect(word.length).toBeGreaterThan(0)
      }),
      { numRuns: 1000 },
    )
  })
})

describe('paragraphs', () => {
  test('a newline belongs to ITS OWN paragraph', () => {
    expect(splitParagraphs('a\nb')).toEqual(['a\n', 'b'])
    expect(splitParagraphs('a\n')).toEqual(['a\n'])
    expect(splitParagraphs('a\n\nb')).toEqual(['a\n', '\n', 'b'])
    expect(splitParagraphs('')).toEqual([])
  })

  test('joining paragraphs equals the source string', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), text => {
        expect(splitParagraphs(text).join('')).toBe(text)
      }),
      { numRuns: 2000 },
    )
  })

  test('text whose only `\\n` is at the end reads as one paragraph', () => {
    expect(single('abc')).toBe(true)
    expect(single('abc\n')).toBe(true)
    expect(single('a\nb')).toBe(false)
    expect(single('')).toBe(false)
  })
})

describe('a long word is cut to the unit ceiling', () => {
  test('a 200-character word splits apart, and the join is preserved', () => {
    const word = 'z'.repeat(200)
    const cut = fitTokens([word])
    expect(cut.length).toBeGreaterThan(1)
    expect(cut.join('')).toBe(word)
    for (const piece of cut) expect(utf8Len(piece)).toBeLessThanOrEqual(60)
  })

  test('short words come back as THE SAME array — no allocation', () => {
    const words = tokenize('обычная строка без длинных слов')
    expect(fitTokens(words)).toBe(words)
  })

  test('a surrogate pair is not cut: a lone surrogate would crash the codec', () => {
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

  test('utf8Len matches TextEncoder', () => {
    const encoder = new TextEncoder()
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), text => {
        expect(utf8Len(text)).toBe(encoder.encode(text).length)
      }),
      { numRuns: 2000 },
    )
  })
})
