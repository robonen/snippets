import fc from 'fast-check'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { VaryError, varyDecode, varyEncode, varyEqual, type Vary } from '../vary'
import { reviveVary as revive, varyGolden as golden } from './golden'

// ── Мелочь для сравнения и разглядывания ─────────────────────────────────────

function hex(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
  return out
}

function bin(text: string): Uint8Array {
  const out = new Uint8Array(text.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(text.slice(i * 2, i * 2 + 2), 16)
  return out
}

/**
 * Тождество round-trip.
 *
 * `-0` и `NaN` разбираются отдельно не из снисходительности: по правилу 3 у них
 * ровно одна запись, поэтому `-0` возвращается нулём, а `NaN` — самим собой,
 * хотя `===` про них говорит обратное.
 */
function same(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    return a === b || (Number.isNaN(a) && Number.isNaN(b))
  }
  if (a === null || b === null) return a === b
  if (a instanceof Uint8Array) {
    if (!(b instanceof Uint8Array) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false
    }
    return true
  }
  if (a instanceof Date) return b instanceof Date && a.getTime() === b.getTime()
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (!same(a[i], b[i])) return false
    }
    return true
  }
  if (typeof a === 'object' && typeof b === 'object') {
    if (b === null || Array.isArray(b) || b instanceof Uint8Array || b instanceof Date) return false
    const left = a as Record<string, unknown>
    const right = b as Record<string, unknown>
    const keys = Object.keys(left)
    if (keys.length !== Object.keys(right).length) return false
    for (const key of keys) {
      if (!Object.hasOwn(right, key)) return false
      if (!same(left[key], right[key])) return false
    }
    return true
  }
  return a === b
}

/** Тот же граф, но у каждого объекта обратный порядок ключей. */
function reorder(value: Vary): Vary {
  if (value === null || typeof value !== 'object') return value
  if (value instanceof Uint8Array || value instanceof Date) return value
  if (Array.isArray(value)) return (value as readonly Vary[]).map(reorder)

  const dict = value as { readonly [key: string]: Vary }
  const out: Record<string, Vary> = {}
  const keys = Object.keys(dict).reverse()
  for (const key of keys) {
    // `out['__proto__'] = …` подменил бы прототип вместо записи поля, и ключ
    // потерялся бы ещё до кодека. Первый прогон этого свойства на 20 000
    // значениях поймал именно эту дырку — в помощнике, а не в кодеке.
    Object.defineProperty(out, key, { value: reorder(dict[key] as Vary), writable: true, enumerable: true, configurable: true })
  }
  return out
}

// ── Генераторы ───────────────────────────────────────────────────────────────

const leaf: fc.Arbitrary<Vary> = fc.oneof(
  fc.constant(null),
  fc.boolean(),
  fc.integer(),
  fc.maxSafeInteger(),
  fc.double(),
  fc.bigInt(),
  fc.string(),
  // Астральные символы обязаны быть в наборе: только на них порядок байтов
  // UTF-8 расходится с порядком код-юнитов JS, а от него зависит правило 4.
  fc.string({ unit: 'grapheme' }),
  fc.uint8Array(),
  fc.date({ noInvalidDate: true }),
)

const anyVary = fc.letrec<{ node: Vary }>((tie) => ({
  node: fc.oneof(
    { maxDepth: 3, depthSize: 'small', withCrossShrink: true },
    leaf,
    fc.array(tie('node'), { maxLength: 6 }),
    fc.dictionary(fc.string(), tie('node'), { maxKeys: 6 }),
  ),
})).node

// ── 1. Round-trip ────────────────────────────────────────────────────────────

describe('round-trip', () => {
  // 10⁵ прогонов — DoD стадии S2 (docs/11-roadmap.md).
  it('decode(encode(x)) ≡ x on 100,000 values', { timeout: 600_000 }, () => {
    fc.assert(
      fc.property(anyVary, (value) => {
        expect(same(varyDecode(varyEncode(value)), value)).toBe(true)
      }),
      { numRuns: 100_000 },
    )
  })

  it('re-encoding gives the same bytes', () => {
    fc.assert(
      fc.property(anyVary, (value) => {
        const once = varyEncode(value)
        expect(hex(varyEncode(varyDecode(once)))).toBe(hex(once))
      }),
      { numRuns: 20_000 },
    )
  })
})

// ── 2. Каноничность ──────────────────────────────────────────────────────────

describe('canonicity', () => {
  it('object key order does not affect the bytes', () => {
    fc.assert(
      fc.property(anyVary, (value) => {
        expect(hex(varyEncode(reorder(value)))).toBe(hex(varyEncode(value)))
      }),
      { numRuns: 20_000 },
    )
  })

  it('keys sort by UTF-8 bytes, not by JS code units', () => {
    // U+E000 → EE 80 80, U+10000 → F0 90 80 80. По код-юнитам суррогат D800
    // меньше E000, по байтам — наоборот. Порядок обязан быть байтовым, иначе
    // две реализации с «очевидной» сортировкой строк дадут разные хэши.
    const bytes = varyEncode({ '\u{10000}': 1, '\uE000': 2 })
    expect(hex(bytes)).toBe(hex(varyEncode({ '\uE000': 2, '\u{10000}': 1 })))
    expect(hex(bytes)).toBe('c283ee80802284f090808021')
    expect('\uE000' < '\u{10000}').toBe(false)
  })

  it('1 and 1.0 are the same bytes', () => {
    expect(hex(varyEncode(1))).toBe(hex(varyEncode(1.0)))
    expect(hex(varyEncode(1.0))).toBe('21')
  })

  it('-0 encodes as 0', () => {
    expect(hex(varyEncode(-0))).toBe(hex(varyEncode(0)))
    expect(Object.is(varyDecode(varyEncode(-0)), 0)).toBe(true)
  })

  it('NaN has a single encoding', () => {
    expect(hex(varyEncode(Number.NaN))).toBe('037ff8000000000000')
  })

  it('strings do not undergo NFC normalization', () => {
    // «й» составной (U+0439) и разложенный (U+0438 U+0306) — разные строки, и
    // текстовый CRDT считает их разными. Нормализация склеила бы их в одну, и
    // текстовый CRDT потерял бы позиции символов.
    const composed = '\u0439'
    const decomposed = '\u0438\u0306'
    expect(decomposed.normalize('NFC')).toBe(composed)
    expect(hex(varyEncode(composed))).toBe('82d0b9')
    expect(hex(varyEncode(decomposed))).toBe('84d0b8cc86')
    expect(varyDecode(varyEncode(decomposed))).toBe(decomposed)
  })

  it('lengths are written with the minimal number of bytes', () => {
    expect(hex(varyEncode(30))).toBe('3e')
    expect(hex(varyEncode(31))).toBe('3f00')
    expect(hex(varyEncode('x'.repeat(30)))).toBe(`9e${'78'.repeat(30)}`)
    expect(hex(varyEncode('x'.repeat(31)))).toBe(`9f00${'78'.repeat(31)}`)
  })
})

// ── 3. Границы ───────────────────────────────────────────────────────────────

describe('boundaries', () => {
  it('empty string, array, object, and buffer', () => {
    expect(hex(varyEncode(''))).toBe('80')
    expect(hex(varyEncode([]))).toBe('a0')
    expect(hex(varyEncode({}))).toBe('c0')
    expect(hex(varyEncode(new Uint8Array(0)))).toBe('60')

    expect(varyDecode(bin('80'))).toBe('')
    expect(varyDecode(bin('a0'))).toEqual([])
    expect(varyDecode(bin('c0'))).toEqual({})
    expect(varyDecode(bin('60'))).toEqual(new Uint8Array(0))
  })

  it('very long string and buffer', () => {
    const text = 'ы'.repeat(100_000)
    expect(varyDecode(varyEncode(text))).toBe(text)

    const blob = new Uint8Array(1 << 17)
    for (let i = 0; i < blob.length; i++) blob[i] = i & 0xff
    expect(same(varyDecode(varyEncode(blob)), blob)).toBe(true)
  })

  it('a buffer window inside a foreign buffer is copied whole and does not drag neighbors', () => {
    const whole = Uint8Array.from([9, 9, 1, 2, 3, 9, 9])
    const window = whole.subarray(2, 5)
    expect(hex(varyEncode(window))).toBe('63010203')

    // Разбор из окна: `DataView` обязан считать смещение, иначе прочитает соседей.
    const framed = new Uint8Array(10)
    framed.set(bin('63010203'), 3)
    expect(same(varyDecode(framed.subarray(3, 7)), Uint8Array.from([1, 2, 3]))).toBe(true)
  })

  it('deep nesting holds up to 512 levels', () => {
    let deep: Vary = 1
    for (let i = 0; i < 500; i++) deep = [deep]

    let taken = varyDecode(varyEncode(deep))
    for (let i = 0; i < 500; i++) taken = (taken as readonly Vary[])[0] as Vary
    expect(taken).toBe(1)
  })

  it('deeper than 512 is a refusal, not a stack overflow', () => {
    let deep: Vary = 1
    for (let i = 0; i < 600; i++) deep = [deep]
    expect(() => varyEncode(deep)).toThrow(VaryError)
    expect(() => varyEncode(deep)).toThrow(/nesting deeper than 512/)
  })

  it('integers up to the safe boundary and floats beyond it', () => {
    expect(hex(varyEncode(Number.MAX_SAFE_INTEGER))).toBe('3fe0ffffffffffff0f')
    expect(hex(varyEncode(Number.MIN_SAFE_INTEGER))).toBe('5fdfffffffffffff0f')
    expect(varyDecode(varyEncode(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER)
    expect(varyDecode(varyEncode(Number.MIN_SAFE_INTEGER))).toBe(Number.MIN_SAFE_INTEGER)

    // 2⁵³ целое, но уже небезопасное: double за этой границей не различает
    // соседние целые, поэтому оно уходит в вещественный тег.
    const overflow = 2 ** 53
    expect(hex(varyEncode(overflow)).slice(0, 2)).toBe('03')
    expect(varyDecode(varyEncode(overflow))).toBe(overflow)
  })

  it('large bigints', () => {
    for (const value of [0n, 1n, -1n, 255n, 256n, -256n, 2n ** 64n, -(2n ** 64n) - 1n, 2n ** 4096n - 1n]) {
      expect(varyDecode(varyEncode(value))).toBe(value)
    }
    expect(hex(varyEncode(2n ** 4096n - 1n))).toBe(`e28004${'ff'.repeat(512)}`)
  })

  it('bigint and number do not get confused', () => {
    expect(varyDecode(varyEncode(1n))).toBe(1n)
    expect(varyDecode(varyEncode(1))).toBe(1)
    expect(hex(varyEncode(1n))).not.toBe(hex(varyEncode(1)))
  })

  it('all float special values', () => {
    for (const value of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.MIN_VALUE,
      -Number.MIN_VALUE,
      Number.MAX_VALUE,
      -Number.MAX_VALUE,
      Number.EPSILON,
      Math.PI,
      5e-324,
      2.2250738585072014e-308,
    ]) {
      expect(same(varyDecode(varyEncode(value)), value)).toBe(true)
    }
  })

  it('Date range edges', () => {
    for (const ms of [0, 1, -1, 8.64e15, -8.64e15]) {
      const date = new Date(ms)
      expect(varyDecode(varyEncode(date))).toEqual(date)
    }
  })

  it('__proto__ key stays a field and does not swap the prototype', () => {
    const source: Record<string, Vary> = {}
    Object.defineProperty(source, '__proto__', { value: 1, enumerable: true, writable: true, configurable: true })

    const taken = varyDecode(varyEncode(source)) as Record<string, Vary>
    expect(Object.keys(taken)).toEqual(['__proto__'])
    expect(Object.getOwnPropertyDescriptor(taken, '__proto__')?.value).toBe(1)
    expect(Object.getPrototypeOf(taken)).toBe(Object.prototype)
  })
})

// ── 4. Отказы на входе ───────────────────────────────────────────────────────

describe('unsupported input', () => {
  const bad: Array<[string, unknown, RegExp]> = [
    ['undefined', undefined, /type undefined/],
    ['function', () => 1, /type function/],
    ['symbol', Symbol('x'), /type symbol/],
    ['Map', new Map(), /kind Map/],
    ['Set', new Set(), /kind Set/],
    ['RegExp', /x/, /kind RegExp/],
    ['Int32Array', new Int32Array([1]), /kind Int32Array/],
    ['ArrayBuffer', new ArrayBuffer(4), /kind ArrayBuffer/],
    ['class instance', new (class Point {})(), /kind Point/],
    ['Invalid Date', new Date(Number.NaN), /Invalid Date/],
    ['lone surrogate', '\uD800', /lone surrogate/],
    ['trailing surrogate', 'a\uDC00', /lone surrogate/],
  ]

  for (const [name, value, message] of bad) {
    it(`${name} is refused`, () => {
      expect(() => varyEncode(value as Vary)).toThrow(VaryError)
      expect(() => varyEncode(value as Vary)).toThrow(message)
    })
  }

  it('undefined inside an array is refused', () => {
    expect(() => varyEncode([1, undefined, 3] as unknown as Vary)).toThrow(/array must be dense/)
  })

  it('a hole in an array is refused', () => {
    // eslint-disable-next-line no-sparse-arrays
    const holey = [1, , 3] as unknown as Vary
    expect(() => varyEncode(holey)).toThrow(/array must be dense/)
  })

  it('undefined in an object field is refused', () => {
    expect(() => varyEncode({ a: undefined } as unknown as Vary)).toThrow(/absence is expressed with null/)
  })

  it('the message contains the path to the bad node', () => {
    const value = { ok: 1, deep: [0, { bad: () => 1 }] } as unknown as Vary
    try {
      varyEncode(value)
      expect.unreachable('the codec must have refused')
    } catch (error) {
      expect(error).toBeInstanceOf(VaryError)
      expect((error as VaryError).at).toBe('$.deep[1].bad')
      expect((error as VaryError).message).toContain('$.deep[1].bad')
    }
  })
})

// ── 5. Строгость разбора ─────────────────────────────────────────────────────

describe('parsing rejects non-canonical input', () => {
  const bad: Array<[string, string, RegExp]> = [
    ['non-minimal varint', '3f8000', /not minimal-length/],
    ['varint wider than 53 bits', '3fffffffffffffffffff7f', /wider than 53 bits/],
    ['unknown tag', '04', /is unknown/],
    ['unknown extension', 'e7', /extension #7/],
    ['tail after the value', '2020', /1 B left after the value/],
    ['truncated length', '63', /need 3 more B/],
    ['truncated body', '6301', /need 3 more B/],
    ['truncated float', '033ff8', /need 8 more B/],
    ['1.0 in the float tag', '033ff0000000000000', /safe integer/],
    ['-0 in the float tag', '038000000000000000', /-0 must be encoded/],
    ['0 in the float tag', '030000000000000000', /safe integer/],
    ['signaling NaN', '037ff0000000000001', /NaN is not canonical/],
    ['NaN with garbage in the mantissa', '037ff8000000000001', /NaN is not canonical/],
    ['dictionary keys out of order', 'c2816221816122', /strictly ascending/],
    ['duplicate dictionary keys', 'c2816121816122', /strictly ascending/],
    ['dictionary key is not a string', 'c12020', /dictionary key must be a string/],
    ['leading zero in bigint', 'e2020001', /leading zero byte/],
    ['minus zero in bigint', 'e300', /no negative zero/],
    ['malformed UTF-8', '81ff', /malformed UTF-8/],
    ['truncated UTF-8 sequence', '82d0', /need 2 more B/],
    ['date out of range', 'e0ffffffffffffff0f', /outside the Date range/],
    ['epoch with a negative sign', 'e100', /positive sign/],
    ['integer below MIN_SAFE_INTEGER', '5fe0ffffffffffff0f', /cannot be represented as a number/],
    ['empty input', '', /need 1 more B/],
  ]

  for (const [name, bytes, message] of bad) {
    it(name, () => {
      expect(() => varyDecode(bin(bytes))).toThrow(VaryError)
      expect(() => varyDecode(bin(bytes))).toThrow(message)
    })
  }

  it('short and extended argument forms do not overlap', () => {
    // Расширенная форма всегда прибавляет 31, поэтому значения 0…30 в ней
    // непредставимы — второй записи у них попросту нет, проверять нечего.
    expect(varyDecode(bin('3f00'))).toBe(31)
    expect(varyDecode(bin('3e'))).toBe(30)
  })

  it('the parse message points at the byte', () => {
    try {
      // Список из двух: целое 0 в байте 1, а в байте 2 — тег, которого нет.
      varyDecode(bin('a22004'))
      expect.unreachable('the codec must have refused')
    } catch (error) {
      expect((error as VaryError).at).toBe('byte 2')
    }
  })
})

// ── 6. Golden-векторы ────────────────────────────────────────────────────────
//
// Фикстуру и её разборщик даёт общий `./golden`: те же векторы гоняются в
// Chromium (`cross-runtime.test.ts`), а туда `node:fs` не едет.

describe(`golden vectors ${golden.format}`, () => {
  it('fixture is not empty', () => {
    expect(golden.vectors.length).toBeGreaterThan(30)
  })

  for (const vector of golden.vectors) {
    it(vector.name, () => {
      const value = revive(vector.node)
      expect(hex(varyEncode(value))).toBe(vector.hex)
      expect(same(varyDecode(bin(vector.hex)), value)).toBe(true)
    })
  }
})

// ── 7. varyEqual ─────────────────────────────────────────────────────────────

describe('varyEqual', () => {
  it('equality is computed by bytes, not by references', () => {
    expect(varyEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
    expect(varyEqual(1, 1.0)).toBe(true)
    expect(varyEqual(-0, 0)).toBe(true)
    expect(varyEqual(Number.NaN, Number.NaN)).toBe(true)
    expect(varyEqual(1, 1n)).toBe(false)
    expect(varyEqual([1, 2], [2, 1])).toBe(false)
    expect(varyEqual(new Uint8Array([1]), new Uint8Array([1]))).toBe(true)
    expect(varyEqual(new Uint8Array([1]), new Uint8Array([1, 0]))).toBe(false)
    expect(varyEqual('', new Uint8Array(0))).toBe(false)
  })

  it('consistent with encoding on arbitrary values', () => {
    fc.assert(
      fc.property(anyVary, anyVary, (a, b) => {
        expect(varyEqual(a, b)).toBe(hex(varyEncode(a)) === hex(varyEncode(b)))
      }),
      { numRuns: 5_000 },
    )
  })

  it('refuses on an unsupported value instead of lying', () => {
    expect(() => varyEqual(undefined as unknown as Vary, undefined as unknown as Vary)).toThrow(VaryError)
  })
})

// ── 8. Типы ──────────────────────────────────────────────────────────────────

describe('types', () => {
  it('varyDecode returns Vary, varyEncode takes Vary', () => {
    expectTypeOf(varyDecode).returns.toEqualTypeOf<Vary>()
    expectTypeOf(varyEncode).parameter(0).toEqualTypeOf<Vary>()
    expectTypeOf(varyEncode).returns.toEqualTypeOf<Uint8Array>()
    expectTypeOf(varyEqual).returns.toEqualTypeOf<boolean>()
  })

  it('undefined does not sneak into Vary', () => {
    expectTypeOf<undefined>().not.toMatchTypeOf<Vary>()
    expectTypeOf<Map<string, number>>().not.toMatchTypeOf<Vary>()
  })
})
