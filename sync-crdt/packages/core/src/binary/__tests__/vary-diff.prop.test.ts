// Перекрёстная сверка кодека `Vary` со второй, независимой реализацией.
//
// `vary.test.ts` проверяет кодек им же самим: `varyDecode(varyEncode(x))`. Такая
// пара сойдётся и при неверно прочитанной раскладке — ошибка окажется общей у
// обеих сторон. Golden-векторы чуть лучше, но их выводил тот же человек из того
// же понимания формата. Здесь разбор делает `vary-reference.ts`, написанный по
// ОПИСАНИЮ формата, и расхождение прочтений становится красным тестом.
//
// Помощники (сравнение, перестановка ключей, генераторы) намеренно написаны
// заново, а не импортированы из `vary.test.ts`: общий помощник — это общая
// ошибка, ровно то, от чего сверка и защищает.

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { varyDecode, varyEncode, type Vary } from '../vary'
import { referenceDecode, VaryMismatch, type RefVary } from './vary-reference'
import { varyGolden as golden } from './golden'

// ── Сравнение и разглядывание ────────────────────────────────────────────────

function hex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

function unhex(text: string): Uint8Array {
  const out = new Uint8Array(text.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(text.slice(i * 2, i * 2 + 2), 16)
  return out
}

/**
 * Тождество значений с поправкой на каноничность: `-0` возвращается нулём
 * (правило 3), `NaN` равен сам себе, порядок ключей объекта не значим.
 */
function alike(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' || typeof b === 'number') {
    if (typeof a !== 'number' || typeof b !== 'number') return false
    if (Number.isNaN(a) && Number.isNaN(b)) return true
    // `Object.is` здесь не годится: `-0` кодируется нулём осознанно.
    return a === b
  }
  if (typeof a === 'bigint' || typeof b === 'bigint') return a === b
  if (a === null || b === null) return a === b
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
  }
  if (a instanceof Uint8Array || b instanceof Uint8Array) {
    if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array) || a.length !== b.length) return false
    return a.every((byte, i) => byte === b[i])
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, i) => alike(item, b[i]))
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const left = a as Record<string, unknown>
    const right = b as Record<string, unknown>
    const keys = Object.keys(left)
    if (keys.length !== Object.keys(right).length) return false
    return keys.every((key) => Object.hasOwn(right, key) && alike(left[key], right[key]))
  }
  return a === b
}

/** Перечитать значение с ключами в другом порядке — структурно то же самое. */
function shuffleKeys(node: Vary, pick: (n: number) => number): Vary {
  if (node === null || typeof node !== 'object') return node
  if (node instanceof Uint8Array || node instanceof Date) return node
  if (Array.isArray(node)) return (node as readonly Vary[]).map((item) => shuffleKeys(item, pick))

  const dict = node as { readonly [key: string]: Vary }
  const keys = Object.keys(dict)
  // Тасовка Фишера — Йетса на детерминированном источнике: свойству нужна
  // произвольная перестановка, а не только развёрнутая.
  for (let i = keys.length - 1; i > 0; i--) {
    const j = pick(i + 1)
    const tmp = keys[i] as string
    keys[i] = keys[j] as string
    keys[j] = tmp
  }

  const out: Record<string, Vary> = {}
  for (const key of keys) {
    // `out[key] = …` на ключе `__proto__` подменил бы прототип, и ключ пропал бы
    // ещё до кодека — свойство краснело бы не на кодеке, а на помощнике.
    Object.defineProperty(out, key, {
      value: shuffleKeys(dict[key] as Vary, pick),
      writable: true,
      enumerable: true,
      configurable: true,
    })
  }
  return out
}

// ── Генераторы ───────────────────────────────────────────────────────────────

/**
 * Ключи, на которых порядок байт UTF-8 расходится с порядком код-юнитов JS.
 *
 * Астральный символ в UTF-16 начинается с суррогата 0xD800…0xDBFF, а он МЕНЬШЕ
 * любого символа из области 0xE000…0xFFFF. В UTF-8 всё наоборот: четырёхбайтовая
 * последовательность начинается с 0xF0, трёхбайтовая для U+FF00 — с 0xEF.
 * Без таких ключей `sort()` без компаратора выглядел бы правильным.
 */
const trickyKey = fc.constantFrom('', 'a', 'A', 'z', '__proto__', 'ключ', '＀', '😀', '𝄞', '', 'ab', 'á')

const anyKey = fc.oneof({ weight: 3, arbitrary: trickyKey }, { weight: 1, arbitrary: fc.string({ maxLength: 8 }) })

const refLeaf: fc.Arbitrary<Vary> = fc.oneof(
  fc.constant(null),
  fc.boolean(),
  fc.integer(),
  fc.maxSafeInteger(),
  fc.double(),
  fc.bigInt(),
  fc.bigInt({ min: -(2n ** 300n), max: 2n ** 300n }),
  fc.string(),
  fc.string({ unit: 'grapheme' }),
  fc.uint8Array({ maxLength: 40 }),
  fc.date({ noInvalidDate: true }),
  fc.constantFrom<Vary>(-0, 0, 1, -1, 30, 31, 32, -31, -32, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.MIN_VALUE, 2 ** 53, 1e300, 0n, -1n),
)

const anyValue = fc.letrec<{ node: Vary }>((tie) => ({
  node: fc.oneof(
    { maxDepth: 3, depthSize: 'small', withCrossShrink: true },
    refLeaf,
    fc.array(tie('node'), { maxLength: 6 }),
    fc.dictionary(anyKey, tie('node'), { maxKeys: 6 }),
  ),
})).node

/** Объекты покрупнее: правило 4 живёт именно на словарях, их надо больше. */
const dictHeavy = fc.letrec<{ node: Vary }>((tie) => ({
  node: fc.oneof(
    { maxDepth: 3, depthSize: 'small' },
    refLeaf,
    fc.dictionary(anyKey, tie('node'), { minKeys: 2, maxKeys: 8 }),
    fc.array(tie('node'), { maxLength: 4 }),
  ),
})).node

// ── 1. Разбор второй реализацией ─────────────────────────────────────────────

describe('сверка с независимым разбором', () => {
  it('referenceDecode(varyEncode(x)) ≡ x на 25 000 значениях', { timeout: 300_000 }, () => {
    fc.assert(
      fc.property(anyValue, (input) => {
        const bytes = varyEncode(input)
        const back = referenceDecode(bytes)
        expect(alike(back, input)).toBe(true)
      }),
      { numRuns: 25_000 },
    )
  })

  it('на словарях с трудными ключами — отдельные 20 000 прогонов', { timeout: 300_000 }, () => {
    fc.assert(
      fc.property(dictHeavy, (input) => {
        expect(alike(referenceDecode(varyEncode(input)), input)).toBe(true)
      }),
      { numRuns: 20_000 },
    )
  })

  it('разбор не оставляет хвоста и не читает за буфер', () => {
    fc.assert(
      fc.property(anyValue, (input) => {
        const bytes = varyEncode(input)
        // Лишний байт обязан быть замечен: длина значения — часть каноничности.
        const longer = new Uint8Array(bytes.length + 1)
        longer.set(bytes)
        expect(() => referenceDecode(longer)).toThrow(VaryMismatch)
        if (bytes.length > 1) {
          expect(() => referenceDecode(bytes.subarray(0, bytes.length - 1))).toThrow(VaryMismatch)
        }
      }),
      { numRuns: 2_000 },
    )
  })
})

// ── 2. Каноничность как свойство ─────────────────────────────────────────────

describe('каноничность проверяется независимо', () => {
  it('перестановка ключей на любой глубине не меняет ни байта', () => {
    fc.assert(
      fc.property(dictHeavy, fc.integer({ min: 0, max: 2 ** 31 - 1 }), (input, seed) => {
        let state = seed >>> 0
        const pick = (n: number): number => {
          state = (Math.imul(state, 1103515245) + 12345) >>> 0
          return state % n
        }
        const twin = shuffleKeys(input, pick)
        expect(hex(varyEncode(twin))).toBe(hex(varyEncode(input)))
        // Не только байты: обе стороны обязаны и разбираться в то же значение.
        expect(alike(referenceDecode(varyEncode(twin)), input)).toBe(true)
      }),
      { numRuns: 20_000 },
    )
  })

  it('ключи возрастают по байтам UTF-8, а не по код-юнитам JS', () => {
    fc.assert(
      fc.property(fc.uniqueArray(trickyKey, { minLength: 2, maxLength: 8 }), (keys) => {
        const dict: Record<string, Vary> = {}
        for (const key of keys) Object.defineProperty(dict, key, { value: null, writable: true, enumerable: true, configurable: true })
        // Референс отвергает любой порядок, кроме строго возрастающего по байтам:
        // если кодек отсортирует по код-юнитам, на паре '＀' / '😀' покраснеет.
        expect(() => referenceDecode(varyEncode(dict))).not.toThrow()
      }),
      { numRuns: 5_000 },
    )
  })

  it('структурно равные значения дают одни байты (-0, 1.0, вложенность)', () => {
    expect(hex(varyEncode(-0))).toBe(hex(varyEncode(0)))
    expect(hex(varyEncode(1.0))).toBe(hex(varyEncode(1)))
    expect(hex(varyEncode([-0, 1.0]))).toBe(hex(varyEncode([0, 1])))
    expect(hex(varyEncode({ a: { b: [-0] } }))).toBe(hex(varyEncode({ a: { b: [0] } })))
    expect(hex(varyEncode({ b: 1, a: 2 }))).toBe(hex(varyEncode({ a: 2, b: 1 })))
  })

  it('целое, влезающее в безопасный диапазон, никогда не пишется вещественным', () => {
    fc.assert(
      fc.property(fc.maxSafeInteger(), (n) => {
        const bytes = varyEncode(n)
        const major = (bytes[0] as number) >> 5
        // major 1 — UINT, 2 — NINT. Вещественная ветка (major 0, код 3) для
        // безопасного целого — нарушение правила 2, и референс её отвергает.
        expect(major === 1 || major === 2).toBe(true)
        expect(referenceDecode(bytes)).toBe(n)
      }),
      { numRuns: 5_000 },
    )
  })

  it('вещественным пишется только то, что целым не выразить', () => {
    for (const n of [2 ** 53, -(2 ** 53), 1e300, 0.5, Number.MIN_VALUE, Number.POSITIVE_INFINITY]) {
      const bytes = varyEncode(n)
      expect(bytes[0]).toBe(0x03)
      expect(referenceDecode(bytes)).toBe(n)
    }
    expect(hex(varyEncode(Number.NaN))).toBe('037ff8000000000000')
  })
})

// ── 3. Чувствительность самой сверки ─────────────────────────────────────────
//
// Тест, который не умеет краснеть, ничего не проверяет. Пункт 4 задания требовал
// внести правку в кодек и убедиться, что сверка её ловит; правка откачена, но
// здесь остаются рукотворные байты — то, что сломанный кодек и написал бы.

describe('референс ловит неканоничные байты', () => {
  const broken: Array<[string, string]> = [
    // Пара ключей '😀' / '＀': по код-юнитам JS суррогат 0xD83D меньше 0xFF00,
    // по байтам UTF-8 всё наоборот (0xF0 > 0xEF). Сортировка через голый
    // `sort()` написала бы ровно эти байты.
    ['ключи не отсортированы (порядок по код-юнитам JS)', 'c284f09f98800083efbc8000'],
    ['ключи повторяются', 'c2816100816100'],
    ['LEB128 не минимален', '3f8000'],
    ['-0 в вещественной ветке', '038000000000000000'],
    ['неканоничный NaN', '037ff8000000000001'],
    ['безопасное целое в вещественной ветке', '033ff0000000000000'],
    ['ведущий нуль в модуле bigint', 'e2020001'],
    ['ноль записан отрицательным bigint', 'e300'],
    ['ноль записан отрицательной датой', 'e100'],
    ['хвост после значения', '2020'],
    ['overlong-последовательность UTF-8', '82c0af'],
    ['суррогат в UTF-8', '83eda080'],
    ['ключ словаря не TEXT', 'c12000'],
    ['зарезервированное расширение', 'e400'],
  ]

  for (const [name, bytes] of broken) {
    it(name, () => {
      expect(() => referenceDecode(unhex(bytes))).toThrow(VaryMismatch)
    })
  }

  it('а канонично записанное — принимает', () => {
    expect(referenceDecode(unhex('c2816100816200'))).toEqual({ a: null, b: null })
    expect(referenceDecode(unhex('3f00'))).toBe(31)
  })
})

// ── 4. Golden-векторы через вторую реализацию ────────────────────────────────
//
// Сама фикстура берётся из общего `./golden` (данные — это данные, и в Chromium
// их всё равно везёт импорт, а не `node:fs`), а вот разбор её узлов написан
// здесь заново: `reviveVary` из `./golden` — это тот же помощник, которым
// пользуется `vary.test.ts`, и общая ошибка в нём была бы невидима обеим
// сторонам сверки. Ровно от этого набор и защищает.

interface GoldenNode {
  k: string
  v?: unknown
  n?: number
}

/** Свой разбор фикстуры: схема узлов описана в самой фикстуре, полем `kinds`. */
function revive(node: GoldenNode): Vary {
  switch (node.k) {
    case 'null': return null
    case 'bool': return node.v as boolean
    case 'int':
    case 'float': return node.v as number
    case 'big': return BigInt(node.v as string)
    case 'str': return node.v as string
    case 'strx': return (node.v as string).repeat(node.n as number)
    case 'bin': return unhex(node.v as string)
    case 'binx': return unhex((node.v as string).repeat(node.n as number))
    case 'date': return new Date(node.v as number)
    case 'arr': return (node.v as GoldenNode[]).map(revive)
    case 'map': {
      const out: Record<string, Vary> = {}
      for (const [key, child] of node.v as Array<[string, GoldenNode]>) {
        Object.defineProperty(out, key, { value: revive(child), writable: true, enumerable: true, configurable: true })
      }
      return out
    }
    case 'special': {
      const table: Record<string, Vary> = {
        maxSafe: Number.MAX_SAFE_INTEGER,
        minSafe: Number.MIN_SAFE_INTEGER,
        negZero: -0,
        nan: Number.NaN,
        inf: Number.POSITIVE_INFINITY,
        ninf: Number.NEGATIVE_INFINITY,
        minValue: Number.MIN_VALUE,
      }
      const value = table[node.v as string]
      if (value === undefined) throw new Error(`неизвестное спецзначение ${String(node.v)}`)
      return value
    }
    default: throw new Error(`неизвестный вид узла ${node.k}`)
  }
}

describe(`golden-векторы ${golden.format} через независимый разбор`, () => {
  for (const vector of golden.vectors) {
    it(vector.name, () => {
      // Байты из фикстуры читает вторая реализация: если раскладка в шапке
      // `vary.ts` разошлась с тем, что пишет код, вектор не разберётся.
      expect(alike(referenceDecode(unhex(vector.hex)), revive(vector.node))).toBe(true)
      // И обратно: кодек на том же значении обязан выдать те же байты.
      expect(hex(varyEncode(revive(vector.node)))).toBe(vector.hex)
    })
  }
})

// ── 5. Разбор кодека и независимый разбор согласны между собой ───────────────

describe('оба разбора видят одно значение', () => {
  it('varyDecode и referenceDecode не расходятся', () => {
    fc.assert(
      fc.property(anyValue, (input) => {
        const bytes = varyEncode(input)
        const mine: RefVary = referenceDecode(bytes)
        const theirs = varyDecode(bytes)
        expect(alike(mine, theirs)).toBe(true)
      }),
      { numRuns: 10_000 },
    )
  })
})
