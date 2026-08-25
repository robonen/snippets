import { createHash } from 'node:crypto'
import fc from 'fast-check'
import { describe, expect, expectTypeOf, test } from 'vitest'
import { LINK_ALPHABET, LINK_BYTES, Link } from '../link'
import { linkGolden as golden } from './golden'

// ── Оснастка ─────────────────────────────────────────────────────────────────

function bytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

function hex(bin: Uint8Array): string {
  let out = ''
  for (const b of bin) out += b.toString(16).padStart(2, '0')
  return out
}

/**
 * Независимый оракул текстовой формы: base64url считает Node, а не наш кодек.
 *
 * Свои тесты написаны из тех же предположений, что и код (PRINCIPLES.md), и
 * round-trip сам по себе пропустил бы перепутанный алфавит или сдвиг на бит —
 * он был бы одинаково перепутан в обе стороны. Оракул это ловит.
 */
function oracle(bin: Uint8Array): string {
  if (bin.length === 0) return ''
  const parts: string[] = []
  for (const [from, to] of [[0, 8], [8, 16], [16, 22]] as const) {
    if (bin.length < to) break
    const section = bin.subarray(from, to)
    const zero = section.every(b => b === 0)
    parts.push(zero ? '' : Buffer.from(section).toString('base64url'))
  }
  return parts.join('.')
}

/** Канонические длины: ссылка либо пуста, либо лорд, либо ленд, либо пешка. */
const binArb = fc
  .constantFrom(0, LINK_BYTES.lord, LINK_BYTES.land, LINK_BYTES.pawn)
  .chain(size => fc.uint8Array({ minLength: size, maxLength: size }))

const headArb = fc.uint8Array({ minLength: LINK_BYTES.head, maxLength: LINK_BYTES.head })
const landArb = fc.uint8Array({ minLength: LINK_BYTES.land, maxLength: LINK_BYTES.land })

const RUNS = { numRuns: 10_000 }

const PEER = bytes('0102030405060708')
const AREA = bytes('1112131415161718')
const HEAD = bytes('212223242526')
const ZERO8 = new Uint8Array(8)

// ── Round-trip ───────────────────────────────────────────────────────────────

describe('text ↔ bytes', () => {
  test('bytes → text → bytes (10,000 runs)', () => {
    fc.assert(
      fc.property(binArb, raw => {
        const link = Link.from(raw)
        const back = Link.parse(link.str)
        expect(hex(back.bin)).toBe(hex(link.bin))
        expect(back.str).toBe(link.str)
      }),
      RUNS,
    )
  })

  test('text matches external base64url (10,000 runs)', () => {
    fc.assert(
      fc.property(binArb, raw => {
        const link = Link.from(raw)
        expect(link.str).toBe(oracle(link.bin))
      }),
      RUNS,
    )
  })

  test('canonicalization: trailing zero sections are not stored', () => {
    fc.assert(
      fc.property(binArb, raw => {
        const link = Link.from(raw)
        // Длина канонична и равна длине повторной канонизации — усечение идемпотентно.
        expect([0, 8, 16, 22]).toContain(link.bin.length)
        expect(hex(Link.from(link.bin).bin)).toBe(hex(link.bin))
      }),
      RUNS,
    )
  })

  test('alphabet does not contain the separator', () => {
    expect(LINK_ALPHABET).toHaveLength(64)
    expect(new Set(LINK_ALPHABET).size).toBe(64)
    // Алфавит стандартный, а разделитель вынесен за его пределы — именно так
    // и снимается неоднозначность разбора.
    expect(LINK_ALPHABET).not.toContain('.')
  })
})

// ── Уровни ───────────────────────────────────────────────────────────────────

describe('level parsing', () => {
  const lord = Link.peer(PEER)
  const land = Link.land(lord, AREA)
  const pawn = Link.pawn(land, HEAD)

  test('lengths 8 / 16 / 22 are built', () => {
    expect(lord.bin.length).toBe(8)
    expect(land.bin.length).toBe(16)
    expect(pawn.bin.length).toBe(22)
  })

  test('sections read at their places', () => {
    expect(hex(pawn.peer().bin)).toBe('0102030405060708')
    expect(hex(pawn.area().bin)).toBe('00000000000000001112131415161718')
    expect(hex(pawn.head().bin)).toBe('00000000000000000000000000000000212223242526')
    expect(hex(pawn.land().bin)).toBe('01020304050607081112131415161718')
    expect(hex(pawn.lord().bin)).toBe('0102030405060708')
  })

  test('section text: zero sections omitted', () => {
    expect(lord.str).toBe('AQIDBAUGBwg')
    expect(land.str).toBe('AQIDBAUGBwg.ERITFBUWFxg')
    expect(pawn.str).toBe('AQIDBAUGBwg.ERITFBUWFxg.ISIjJCUm')
    expect(pawn.area().str).toBe('.ERITFBUWFxg')
    expect(pawn.head().str).toBe('..ISIjJCUm')
  })

  test('zero area means the home land of the lord, that is the lord itself', () => {
    const home = Link.land(lord, ZERO8)
    expect(home.equals(lord)).toBe(true)
    expect(home.bin.length).toBe(8)

    const inHome = Link.pawn(home, HEAD)
    expect(inHome.str).toBe('AQIDBAUGBwg..ISIjJCUm')
    expect(inHome.land().equals(lord)).toBe(true)
  })

  test('empty link', () => {
    expect(Link.hole.str).toBe('')
    expect(Link.hole.bin.length).toBe(0)
    expect(Link.parse('').equals(Link.hole)).toBe(true)
    expect(Link.peer(ZERO8).equals(Link.hole)).toBe(true)
    expect(Link.hole.peer().equals(Link.hole)).toBe(true)
    expect(Link.hole.head().equals(Link.hole)).toBe(true)
  })

  test('sections shorter than their level give an empty link', () => {
    expect(lord.area().equals(Link.hole)).toBe(true)
    expect(land.head().equals(Link.hole)).toBe(true)
  })

  test('foreign bytes do not leak inside', () => {
    const raw = bytes('0102030405060708')
    const link = Link.peer(raw)
    raw[0] = 0xff
    expect(link.str).toBe('AQIDBAUGBwg')
  })

  test('sizes outside the contract are rejected', () => {
    expect(() => Link.from(new Uint8Array(7))).toThrow(/Link length 7 B/)
    expect(() => Link.peer(new Uint8Array(6))).toThrow(/peer is 8 B/)
    expect(() => Link.land(lord, new Uint8Array(6))).toThrow(/area is 8 B/)
    expect(() => Link.pawn(land, new Uint8Array(8))).toThrow(/head is 6 B/)
  })

  test('level types', () => {
    expectTypeOf(pawn.peer()).toEqualTypeOf<Link>()
    expectTypeOf(pawn.land()).toEqualTypeOf<Link>()
    expectTypeOf(pawn.xor(lord)).toEqualTypeOf<Uint8Array>()
    expectTypeOf(Link.hash(PEER)).toEqualTypeOf<Promise<Link>>()
  })
})

// ── relate / resolve ─────────────────────────────────────────────────────────

describe('relate / resolve', () => {
  test('relate(resolve(x)) === x for the relative form (10,000 runs)', () => {
    fc.assert(
      fc.property(landArb, headArb, (landBin, headBin) => {
        const base = Link.from(landBin)
        const relative = Link.pawn(Link.hole, headBin)
        const absolute = relative.resolve(base)
        expect(absolute.relate(base).equals(relative)).toBe(true)
      }),
      RUNS,
    )
  })

  test('resolve(relate(y)) === y for a pawn of its own land (10,000 runs)', () => {
    fc.assert(
      fc.property(landArb, headArb, (landBin, headBin) => {
        const base = Link.from(landBin)
        const absolute = Link.pawn(base, headBin)
        expect(absolute.relate(base).resolve(base).equals(absolute)).toBe(true)
      }),
      RUNS,
    )
  })

  test('both operations are idempotent (10,000 runs)', () => {
    fc.assert(
      fc.property(binArb, landArb, (raw, landBin) => {
        const base = Link.from(landBin)
        const link = Link.from(raw)
        const related = link.relate(base)
        const resolved = link.resolve(base)
        expect(related.relate(base).equals(related)).toBe(true)
        expect(resolved.resolve(base).equals(resolved)).toBe(true)
      }),
      RUNS,
    )
  })

  test('the relative form is 6 significant bytes instead of 22', () => {
    const land = Link.land(Link.peer(PEER), AREA)
    const pawn = Link.pawn(land, HEAD)
    expect(pawn.relate(land).str).toBe('..ISIjJCUm')
    expect(pawn.relate(land).str.length).toBeLessThan(pawn.str.length)
  })

  test('a pawn of a foreign land stays absolute', () => {
    const mine = Link.land(Link.peer(PEER), AREA)
    const other = Link.land(Link.peer(bytes('0807060504030201')), AREA)
    const pawn = Link.pawn(mine, HEAD)
    expect(pawn.relate(other).equals(pawn)).toBe(true)
    expect(pawn.resolve(other).equals(pawn)).toBe(true)
  })

  test('non-pawns are not relative', () => {
    const lord = Link.peer(PEER)
    const land = Link.land(lord, AREA)
    expect(lord.relate(land).equals(lord)).toBe(true)
    expect(land.relate(land).equals(land)).toBe(true)
    expect(land.resolve(land).equals(land)).toBe(true)
    expect(Link.hole.resolve(land).equals(Link.hole)).toBe(true)
  })

  test('a pawn of the home land relates to the lord', () => {
    const lord = Link.peer(PEER)
    const pawn = Link.pawn(lord, HEAD)
    expect(pawn.relate(lord).str).toBe('..ISIjJCUm')
    expect(pawn.relate(lord).resolve(lord).equals(pawn)).toBe(true)
  })
})

// ── Ошибки разбора ───────────────────────────────────────────────────────────

describe('invalid strings', () => {
  const cases: ReadonlyArray<readonly [string, string, RegExp]> = [
    ['trailing separator', 'AQIDBAUGBwg.', /trailing section is empty/],
    ['two trailing separators', 'AQIDBAUGBwg.ERITFBUWFxg.', /trailing section is empty/],
    ['separator only', '.', /trailing section is empty/],
    ['extra section', 'AQIDBAUGBwg.ERITFBUWFxg.ISIjJCUm.ISIjJCUm', /4 sections/],
    ['short peer section', 'AQIDBAUGBw', /section peer: 10 characters, expected 11/],
    ['long head section', 'AQIDBAUGBwg.ERITFBUWFxg.ISIjJCUmX', /section head: 9 characters, expected 8/],
    ['character outside the alphabet', 'AQIDBAUGBw+', /character "\+" outside the alphabet/],
    ['slash from plain base64', 'AQIDBAUGBw/', /character "\/" outside the alphabet/],
    ['dot inside a section', 'AQIDBAUGB.g', /section peer: 9 characters/],
    ['non-ASCII', 'AQIDBAUGBwæ', /character "æ" outside the alphabet/],
    ['zero section written explicitly', 'AAAAAAAAAAA', /section peer is zero/],
    ['zero area written explicitly', 'AQIDBAUGBwg.AAAAAAAAAAA', /section area is zero/],
    ['non-zero trailing bits', 'AQIDBAUGBwh', /section peer: trailing bits are not zero/],
  ]

  for (const [note, str, message] of cases) {
    test(note, () => {
      expect(() => Link.parse(str)).toThrow(message)
      // В сообщении обязана быть сама строка: без неё разбор пакета из сети
      // не диагностируется (PRINCIPLES.md, «данные для диагностики»).
      expect(() => Link.parse(str)).toThrow(new RegExp(`Invalid link "${str.replace(/[+/]/g, '\\$&')}"`))
    })
  }

  test('a neighboring valid string parses', () => {
    // 'AAAAAAAAAAE' отличается от нулевой секции одним битом полезной нагрузки.
    expect(hex(Link.parse('AAAAAAAAAAE').bin)).toBe('0000000000000001')
  })
})

// ── Golden-векторы ───────────────────────────────────────────────────────────
//
// Фикстуру читает общий `./golden`: те же векторы гоняются в Chromium
// (`cross-runtime.test.ts`), а туда `node:fs` не едет.

describe('golden vectors', () => {
  test('file is present and covers all levels', () => {
    expect(golden.alphabet).toBe(LINK_ALPHABET)
    expect(golden.separator).toBe('.')
    expect(golden.vectors.length).toBeGreaterThanOrEqual(12)
  })

  for (const vector of golden.vectors) {
    test(`${vector.note}: bytes → text`, () => {
      expect(Link.from(bytes(vector.hex)).str).toBe(vector.str)
    })

    test(`${vector.note}: text → bytes`, () => {
      expect(hex(Link.parse(vector.str).bin)).toBe(vector.hex)
    })
  }
})

// ── xor, равенство, ключ ─────────────────────────────────────────────────────

describe('xor', () => {
  test('xor with itself gives zeros, twice gives the original (10,000 runs)', () => {
    fc.assert(
      fc.property(binArb, binArb, (left, right) => {
        const a = Link.from(left)
        const b = Link.from(right)

        const self = a.xor(a)
        expect(self.every(byte => byte === 0)).toBe(true)

        const mixed = a.xor(b)
        expect(mixed.length).toBe(Math.max(a.bin.length, b.bin.length))

        // Обратимость: подмешали и сняли — получили исходные байты, добитые нулями.
        const back = Link.from(mixed).xor(b)
        expect(hex(back.subarray(0, a.bin.length))).toBe(hex(a.bin))
      }),
      RUNS,
    )
  })

  test('length does not depend on zero-tail truncation', () => {
    const lord = Link.peer(PEER)
    const pawn = Link.pawn(Link.land(lord, AREA), HEAD)
    // Лорд короче пешки — недостающие байты считаются нулями.
    expect(hex(pawn.xor(lord).subarray(8))).toBe(hex(pawn.bin.subarray(8)))
  })
})

describe('equality and key', () => {
  test('equality is by bytes (10,000 runs)', () => {
    fc.assert(
      fc.property(binArb, binArb, (left, right) => {
        const a = Link.from(left)
        const b = Link.from(right)
        expect(a.equals(b)).toBe(hex(a.bin) === hex(b.bin))
        // Ключ карты обязан различать ровно то же, что и равенство.
        expect(a.key() === b.key()).toBe(a.equals(b))
      }),
      RUNS,
    )
  })

  test('underscore is a significant alphabet character, not a separator', () => {
    // Ровно та неоднозначность, из-за которой сменён разделитель: `_` входит в
    // стандартный base64url, и секция вправе с него начинаться. Разбор обязан
    // читать его как данные.
    const withUnderscore = Link.parse('_QIDBAUGBwg')
    expect(withUnderscore.bin).toHaveLength(8)
    expect(withUnderscore.str).toBe('_QIDBAUGBwg')
  })

  test('Map key', () => {
    const land = Link.land(Link.peer(PEER), AREA)
    const map = new Map<string, string>()
    map.set(Link.pawn(land, HEAD).key(), 'значение')
    expect(map.get(Link.parse('AQIDBAUGBwg.ERITFBUWFxg.ISIjJCUm').key())).toBe('значение')
  })

  test('text forms', () => {
    const link = Link.peer(PEER)
    expect(link.toString()).toBe('AQIDBAUGBwg')
    expect(link.toJSON()).toBe('AQIDBAUGBwg')
    expect(JSON.stringify({ link })).toBe('{"link":"AQIDBAUGBwg"}')
    expect(`${link}`).toBe('AQIDBAUGBwg')
  })
})

// ── hash ─────────────────────────────────────────────────────────────────────

describe('hash', () => {
  const data = new TextEncoder().encode('приветствие ленду')

  test('first 8 bytes of SHA-256 — same as node:crypto', async () => {
    const digest = new Uint8Array(createHash('sha256').update(data).digest())
    const link = await Link.hash(data)
    expect(hex(link.bin)).toBe(hex(digest.subarray(0, 8)))
    expect(link.bin.length).toBe(8)
  })

  test('size is chosen by level', async () => {
    const digest = new Uint8Array(createHash('sha256').update(data).digest())
    expect(hex((await Link.hash(data, 16)).bin)).toBe(hex(digest.subarray(0, 16)))
    expect(hex((await Link.hash(data, 22)).bin)).toBe(hex(digest.subarray(0, 22)))
  })

  test('a ready hash needs no promise', () => {
    const digest = new Uint8Array(createHash('sha256').update(data).digest())
    expect(Link.from(digest.subarray(0, 8)).equals(Link.from(digest.subarray(0, 8)))).toBe(true)
  })
})
