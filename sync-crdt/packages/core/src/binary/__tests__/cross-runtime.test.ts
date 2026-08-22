// Один и тот же набор гоняется в Node (`pnpm test`) и в Chromium
// (`pnpm test:browser`) — последний пункт DoD стадии S2: «одинаковые хэши и
// одинаковые байты в Node и в Chromium» (docs/11-roadmap.md).
//
// ПОЧЕМУ это отдельный файл, а не пара проверок внутри существующих: формат —
// публичный контракт (ADR-005), и разойтись движки могут ровно в трёх местах —
// UTF-8 на суррогатных парах, порядок ключей словаря и WebCrypto. Всё это здесь
// и проверяется, а остальные наборы остаются node-only и быстрыми.
//
// ПОЧЕМУ ни одного `node:`-импорта: файл обязан собираться под браузер. Оракул
// (Buffer, node:crypto) отработал заранее — его результат лежит в
// `fixtures/cross-runtime.golden.json`, см. `cross-runtime.oracle.mjs`.
import { describe, expect, test } from 'vitest'
import { Link, type LinkBytes } from '../link'
import { SAND_AT, SandUnit, parseUnit } from '../unit'
import { VaryError, varyDecode, varyEncode, varyEqual } from '../vary'
import { packDecode, packEncode } from '../pack'
import {
  crossGolden,
  hex,
  linkGolden,
  makeUnit,
  packGolden,
  reviveVary,
  unhex,
  unitGolden,
  varyGolden,
} from './golden'

/**
 * Где мы сейчас. Нужно не тесту, а отчёту: без этой строки два прогона в логе
 * неразличимы, и «прогнали в обеих средах» проверить нечем.
 */
const RUNTIME = (globalThis as { window?: unknown }).window === undefined ? 'node' : 'browser'

describe(`среда: ${RUNTIME}`, () => {
  test('WebCrypto на месте — без него Link.hash не работает вовсе', () => {
    expect(typeof crypto.subtle.digest).toBe('function')
  })
})

// ── Golden-векторы: те же байты в обеих средах ───────────────────────────────

describe('link: байты ↔ текст', () => {
  test('фикстура непуста', () => {
    expect(linkGolden.vectors.length).toBeGreaterThanOrEqual(12)
  })

  for (const vector of linkGolden.vectors) {
    test(vector.note, () => {
      expect(Link.from(unhex(vector.hex)).str).toBe(vector.str)
      expect(hex(Link.parse(vector.str).bin)).toBe(vector.hex)
    })
  }
})

describe('vary: значение → байты', () => {
  test('фикстура непуста', () => {
    expect(varyGolden.vectors.length).toBeGreaterThan(30)
  })

  for (const vector of varyGolden.vectors) {
    test(vector.name, () => {
      const value = reviveVary(vector.node)
      expect(hex(varyEncode(value))).toBe(vector.hex)
      // Равенство по байтам, а не по ссылкам: `-0`, `NaN` и `Uint8Array`
      // сравнивать через `toEqual` нельзя.
      expect(varyEqual(varyDecode(unhex(vector.hex)), value)).toBe(true)
    })
  }
})

describe('unit: поля → байты', () => {
  test('фикстура непуста', () => {
    expect(unitGolden.vectors.length).toBeGreaterThanOrEqual(4)
  })

  for (const vector of unitGolden.vectors) {
    test(`${vector.kind}: ${vector.note}`, () => {
      const unit = parseUnit(unhex(vector.hex))
      expect(unit.kind()).toBe(vector.kind)
      expect(unit.path()).toBe(vector.path)
      // Фабрика собирает ровно те же байты — это и есть контракт записи.
      expect(hex(makeUnit(vector.kind, vector.fields).bin)).toBe(vector.hex)
    })
  }
})

describe('pack: контейнер', () => {
  test('фикстура непуста', () => {
    expect(packGolden.vectors.length).toBeGreaterThanOrEqual(6)
  })

  for (const vector of packGolden.vectors) {
    test(vector.note, () => {
      const parts = packDecode(unhex(vector.hex))
      expect(parts.map(([land]) => land.str)).toEqual(vector.lands.map(land => land.land))
      expect(hex(packEncode(parts))).toBe(vector.hex)
    })
  }
})

// ── Link.hash: один вход — один хэш ──────────────────────────────────────────

const SIZES: readonly LinkBytes[] = [8, 16, 22]

describe('Link.hash', () => {
  for (const item of crossGolden.strings) {
    test(`${item.name}: SHA-256 совпадает с эталоном node:crypto`, async () => {
      const data = unhex(item.utf8)
      for (const size of SIZES) {
        const link = await Link.hash(data, size)
        expect(hex(link.bin)).toBe(trimZeroTail(item.sha256.slice(0, size * 2)))
      }
    })
  }

  test('вид со смещением хэшируется по своему окну, а не по всему буферу', async () => {
    // Ловушка обеих сред сразу: `crypto.subtle.digest` обязан уважать
    // `byteOffset`/`byteLength`. Юниты и баллы в `packDecode` — именно такие
    // окна в чужой буфер, и хэш от них считается на каждой сверке.
    const item = crossGolden.strings[2]
    expect(item).toBeDefined()
    if (item === undefined) return

    const data = unhex(item.utf8)
    const padded = new Uint8Array(data.length + 8)
    padded.set(data, 5)
    const window = padded.subarray(5, 5 + data.length)

    expect(hex((await Link.hash(window)).bin)).toBe(hex((await Link.hash(data)).bin))
    expect(hex((await Link.hash(window)).bin)).toBe(trimZeroTail(item.sha256.slice(0, 16)))
  })

  test('хэш пустого входа', async () => {
    // Известная константа SHA-256 от пустой строки — её движки не считают,
    // а берут из общего для всех определения алгоритма.
    const link = await Link.hash(new Uint8Array(0))
    expect(hex(link.bin)).toBe('e3b0c44298fc1c14')
  })
})

/**
 * `Link` не хранит хвостовые нулевые секции (биекция байт и текста), поэтому
 * эталонный префикс дайджеста надо усечь тем же правилом — иначе тест сравнивал
 * бы восемь нулевых байт с пустой ссылкой.
 */
function trimZeroTail(prefix: string): string {
  const sections = [prefix.slice(0, 16), prefix.slice(16, 32), prefix.slice(32, 44)]
  let end = sections.length
  while (end > 0 && /^0*$/.test(sections[end - 1] as string)) end -= 1
  return sections.slice(0, end).join('')
}

// ── Текст: UTF-8, суррогатные пары, эмодзи ───────────────────────────────────

describe('строки вне ASCII', () => {
  for (const item of crossGolden.strings) {
    test(`${item.name}: те же байты`, () => {
      const encoded = varyEncode(item.str)
      expect(hex(encoded)).toBe(item.vary)

      // И обратно — строго `===`: любая нормализация (NFC/NFD) по дороге
      // вернула бы «такую же на вид» строку с другими байтами.
      expect(varyDecode(encoded)).toBe(item.str)
    })
  }

  test('NFD и NFC — разные значения, а не одно', () => {
    const nfd = crossGolden.strings.find(item => item.name.includes('(NFD)'))
    const nfc = crossGolden.strings.find(item => item.name.includes('(NFC)'))
    expect(nfd).toBeDefined()
    expect(nfc).toBeDefined()
    expect(nfd?.vary).not.toBe(nfc?.vary)
    expect(varyEqual(nfd?.str ?? '', nfc?.str ?? '')).toBe(false)
  })

  for (const item of crossGolden.rejects) {
    test(`${item.name}: отвергается обеими средами`, () => {
      // `TextEncoder` здесь молча подставил бы U+FFFD. Отказ — единственный
      // ответ, при котором байты в двух средах не разъезжаются незаметно.
      const broken = String.fromCharCode(...item.units)
      expect(() => varyEncode(broken)).toThrow(VaryError)
      expect(() => varyEncode({ [broken]: 1 })).toThrow(VaryError)
    })
  }
})

describe('словари с ключами вне ASCII', () => {
  for (const item of crossGolden.dicts) {
    test(`${item.name}: порядок ключей по байтам UTF-8`, () => {
      const value: Record<string, string> = {}
      // Пары кладутся в порядке фикстуры (он намеренно не отсортирован), а
      // числоподобные ключи движок ещё и переставит по-своему при перечислении.
      // Кодек обязан привести и то и другое к одному порядку.
      for (const [key, text] of item.pairs) value[key] = text

      expect(hex(varyEncode(value))).toBe(item.vary)
      // Разбор → сборка обязаны дать те же байты: порядок ключей после
      // round-trip задан форматом, а не порядком перечисления свойств.
      expect(hex(varyEncode(varyDecode(unhex(item.vary))))).toBe(item.vary)
    })
  }
})

describe('юнит со значением вне ASCII', () => {
  const peer = Link.peer(unhex('a0a1a2a3a4a5a6a7'))
  const self = Link.pawn(Link.hole, unhex('010203040506'))

  for (const item of crossGolden.strings) {
    const payload = item.vary.length / 2
    // Inline-значение санда обязано уложиться в 62 байта (docs/03 §2); длинные
    // строки уезжают в ball и здесь не про них.
    if (payload > 62) continue

    test(`${item.name}: значение лежит в санде теми же байтами`, () => {
      const unit = SandUnit.make({
        peer,
        time: 0x01020304,
        tick: 1,
        self,
        head: Link.hole,
        lead: Link.hole,
        value: item.str,
      })

      expect(unit.size()).toBe(payload)
      expect(hex(unit.bin.subarray(SAND_AT.payload, SAND_AT.payload + payload))).toBe(item.vary)
      const back = parseUnit(unit.bin)
      expect(back instanceof SandUnit).toBe(true)
      if (back instanceof SandUnit) expect(back.value()).toBe(item.str)
    })
  }
})
