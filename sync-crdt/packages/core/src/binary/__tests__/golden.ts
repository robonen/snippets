// Общий читатель эталонных фикстур.
//
// ПОЧЕМУ импортом, а не `readFileSync`: те же векторы обязаны прогоняться в
// Chromium (DoD S2), а в браузере `node:fs` нет. Импорт JSON понимают обе среды
// одинаково — и оба прогона читают буквально один файл, а не две его копии.
//
// Здесь же живут разборщики фикстур (`reviveVary`, `makeUnit`): до этого модуля
// каждая копия лежала в своём тесте, и третья копия появилась бы в
// `cross-runtime.test.ts`.
import { GiftUnit, PassUnit, SandUnit, SealUnit, type PassAlgo, type SandTag, type Unit } from '../unit'
import { Link } from '../link'
import type { Vary } from '../vary'

import linkJson from './fixtures/link.golden.json'
import varyJson from './fixtures/vary.golden.json'
import unitJson from './fixtures/unit.golden.json'
import packJson from './fixtures/pack.golden.json'
import crossJson from './fixtures/cross-runtime.golden.json'

// ── Байты ↔ шестнадцатеричный текст ──────────────────────────────────────────

/** Байты в hex. Сравнение строк вместо `toEqual` на массивах — читаемый диф при расхождении. */
export function hex(bin: Uint8Array): string {
  let out = ''
  for (const byte of bin) out += byte.toString(16).padStart(2, '0')
  return out
}

/** Hex в байты. Длина обязана быть чётной — иначе вектор в фикстуре опечатан. */
export function unhex(text: string): Uint8Array {
  if (text.length % 2 !== 0) throw new Error(`odd hex length: "${text}"`)
  const out = new Uint8Array(text.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(text.slice(i * 2, i * 2 + 2), 16)
  return out
}

// ── Формы фикстур ────────────────────────────────────────────────────────────

export interface LinkGolden {
  readonly alphabet: string
  readonly separator: string
  readonly vectors: ReadonlyArray<{ readonly note: string, readonly hex: string, readonly str: string }>
}

/** Узел фикстуры Vary. Схема видов описана в самой фикстуре, полем `kinds`. */
export interface VaryNode {
  readonly k: string
  readonly v?: unknown
  readonly n?: number
}

export interface VaryGolden {
  readonly format: string
  readonly vectors: ReadonlyArray<{ readonly name: string, readonly node: VaryNode, readonly hex: string }>
}

export interface UnitGolden {
  readonly vectors: ReadonlyArray<{
    readonly note: string
    readonly kind: string
    readonly hex: string
    readonly path: string
    readonly fields: Record<string, unknown>
  }>
}

export interface PackGolden {
  readonly vectors: ReadonlyArray<{
    readonly note: string
    readonly hex: string
    readonly bytes: number
    readonly lands: ReadonlyArray<{
      readonly land: string
      readonly faces: ReadonlyArray<{ readonly peer: string, readonly time: number, readonly tick: number, readonly summ: number }>
      readonly units: readonly string[]
      readonly balls: readonly string[]
    }>
  }>
}

export interface CrossGolden {
  readonly note: string
  readonly strings: ReadonlyArray<{
    readonly name: string
    readonly str: string
    readonly utf8: string
    readonly vary: string
    readonly sha256: string
  }>
  readonly dicts: ReadonlyArray<{
    readonly name: string
    readonly pairs: ReadonlyArray<readonly [string, string]>
    readonly order: readonly string[]
    readonly vary: string
  }>
  /** Одинокие суррогаты: коды UTF-16, а не строка — см. шапку прибора. */
  readonly rejects: ReadonlyArray<{ readonly name: string, readonly units: readonly number[] }>
}

// `as unknown as` — потому что из JSON TypeScript выводит литеральные типы полей
// и сузить их до объявленных интерфейсов прямым приведением не даёт.
export const linkGolden = linkJson as unknown as LinkGolden
export const varyGolden = varyJson as unknown as VaryGolden
export const unitGolden = unitJson as unknown as UnitGolden
export const packGolden = packJson as unknown as PackGolden
export const crossGolden = crossJson as unknown as CrossGolden

// ── Vary: узел фикстуры → значение ───────────────────────────────────────────

/**
 * Спецзначения записаны именем, а не числом: `NaN` и `Infinity` в JSON не
 * представимы вовсе, а `-0` не отличим от `0`.
 */
const SPECIAL: Record<string, number> = {
  nan: Number.NaN,
  inf: Number.POSITIVE_INFINITY,
  ninf: Number.NEGATIVE_INFINITY,
  negZero: -0,
  maxSafe: Number.MAX_SAFE_INTEGER,
  minSafe: Number.MIN_SAFE_INTEGER,
  minValue: Number.MIN_VALUE,
}

export function reviveVary(node: VaryNode): Vary {
  switch (node.k) {
    case 'null':
      return null
    case 'bool':
      return node.v as boolean
    case 'int':
    case 'float':
      return node.v as number
    case 'str':
      return node.v as string
    case 'big':
      return BigInt(node.v as string)
    case 'strx':
      return (node.v as string).repeat(node.n as number)
    case 'bin':
      return unhex(node.v as string)
    case 'binx':
      return unhex((node.v as string).repeat(node.n as number))
    case 'date':
      return new Date(node.v as number)
    case 'arr':
      return (node.v as VaryNode[]).map(reviveVary)
    case 'map': {
      // В фикстуре пары, а не объект: порядок ключей там намеренно не
      // отсортирован — на нём и проверяется правило каноничности №4.
      const out: Record<string, Vary> = {}
      for (const [key, child] of node.v as Array<[string, VaryNode]>) out[key] = reviveVary(child)
      return out
    }
    case 'special': {
      const value = SPECIAL[node.v as string]
      if (value === undefined) throw new Error(`unknown special value "${String(node.v)}" in fixture`)
      return value
    }
    default:
      throw new Error(`unknown node kind "${node.k}" in fixture`)
  }
}

// ── Unit: поля фикстуры → готовый юнит ───────────────────────────────────────

/**
 * Сборка юнита ровно из тех полей, что записаны в фикстуре.
 *
 * Ссылки собираются через `Link.pawn(Link.hole, …)`: в фикстуре записаны только
 * шестибайтовые локальные части (`self`, `head`, `lead`), а лорд и ленд в
 * раскладке юнита не хранятся вовсе — их даёт заголовок пачки.
 */
export function makeUnit(kind: string, fields: Record<string, unknown>): Unit {
  const stamp = {
    peer: Link.peer(unhex(fields.peer as string)),
    time: fields.time as number,
    tick: fields.tick as number,
  }

  switch (kind) {
    case 'sand': {
      const links = {
        self: Link.pawn(Link.hole, unhex(fields.self as string)),
        head: Link.pawn(Link.hole, unhex(fields.head as string)),
        lead: Link.pawn(Link.hole, unhex(fields.lead as string)),
      }
      return fields.big === true
        ? SandUnit.makeBig({
            ...stamp,
            ...links,
            tag: fields.tag as SandTag,
            size: fields.size as number,
            shot: unhex(fields.shot as string),
          })
        : SandUnit.make({
            ...stamp,
            ...links,
            tag: fields.tag as SandTag,
            value: fields.value as Vary,
          })
    }
    case 'gift':
      return GiftUnit.make({
        ...stamp,
        mate: Link.peer(unhex(fields.mate as string)),
        tier: fields.tier as number,
        rate: fields.rate as number,
        code: unhex(fields.code as string),
      })
    case 'seal':
      return SealUnit.make({
        ...stamp,
        hashes: (fields.hashes as string[]).map(unhex),
        sign: unhex(fields.sign as string),
        wide: fields.wide as boolean,
      })
    case 'pass':
      return PassUnit.make({
        ...stamp,
        algo: fields.algo as PassAlgo,
        key: unhex(fields.key as string),
      })
    default:
      throw new Error(`unknown unit kind "${kind}" in fixture`)
  }
}
