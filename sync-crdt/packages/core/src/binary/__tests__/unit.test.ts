import fc from 'fast-check'
import { describe, expect, expectTypeOf, test } from 'vitest'
import { compare as compareSand } from '../../land/lww'
import { ROOT, type Sand } from '../../land/sand'
import { Link } from '../link'
import { type Vary, varyEncode } from '../vary'
import { makeUnit, unitGolden as golden } from './golden'
import {
  type AnyUnit,
  GIFT_AT,
  GiftUnit,
  PASS_AT,
  PassUnit,
  SAND_AT,
  SEAL_AT,
  SandUnit,
  SealUnit,
  SHOT_BYTES,
  UNIT_AT,
  UNIT_BYTES,
  UNIT_KIND,
  Unit,
  type UnitKind,
  UnitError,
  parseUnit,
  shotKey,
  unitLength,
} from '../unit'

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

const PEER = bytes('a0a1a2a3a4a5a6a7')
const SELF = bytes('010203040506')
const HEAD = bytes('0b0c0d0e0f10')
const LEAD = bytes('111213141516')

const peer = Link.peer(PEER)
const self = Link.pawn(Link.hole, SELF)
const head = Link.pawn(Link.hole, HEAD)
const lead = Link.pawn(Link.hole, LEAD)

const RUNS = { numRuns: 10_000 }

/** Санд «по умолчанию»: поля перекрываются по месту. */
function sand(over: Partial<Parameters<typeof SandUnit.make>[0]> = {}): SandUnit {
  return SandUnit.make({ peer, time: 1, tick: 0, self, head, lead, value: 'hi', ...over })
}

// ── Раскладка ────────────────────────────────────────────────────────────────

describe('раскладка', () => {
  test('офсеты совпадают с таблицей спецификации (docs/03 §2)', () => {
    expect(UNIT_AT).toEqual({ kind: 0, meta: 1, time: 2, tick: 6, peer: 8, body: 16 })
    expect(SAND_AT).toEqual({ self: 16, head: 22, lead: 28, size: 34, shot: 36, payload: 48 })
    expect(GIFT_AT).toEqual({ mate: 16, rank: 24, code: 32 })
    expect(SEAL_AT).toEqual({ hashes: 16 })
    expect(PASS_AT).toEqual({ key: 16 })
    expect(UNIT_KIND).toEqual({ sand: 1, gift: 2, seal: 3, pass: 4 })
    expect(SHOT_BYTES).toBe(12)
  })

  test('каждое поле санда читается со своего офсета из собранных руками байт', () => {
    // Байты выписаны здесь, а не получены фабрикой: иначе тест проверял бы
    // согласие кода с самим собой, а не с таблицей офсетов.
    const bin = new Uint8Array(56)
    bin[0] = UNIT_KIND.sand
    bin[1] = 0b10_000011 // tag = vals, inlineSize = 3
    bin.set(bytes('01020304'), 2) // time, BE
    bin.set(bytes('0506'), 6) // tick, BE
    bin.set(PEER, 8)
    bin.set(SELF, 16)
    bin.set(HEAD, 22)
    bin.set(LEAD, 28)
    bin.set(varyEncode('hi'), 48)

    const unit = parseUnit(bin)
    expect(unit.kind()).toBe('sand')
    // Сужение типа идёт через `instanceof`: `kind()` — метод, а по возврату
    // метода TypeScript union не сужает.
    if (!(unit instanceof SandUnit)) return

    expect(unit.time()).toBe(0x01020304)
    expect(unit.tick()).toBe(0x0506)
    expect(hex(unit.peer().bin)).toBe(hex(PEER))
    expect(hex(unit.self().bin.subarray(16))).toBe(hex(SELF))
    expect(hex(unit.head().bin.subarray(16))).toBe(hex(HEAD))
    expect(hex(unit.lead().bin.subarray(16))).toBe(hex(LEAD))
    expect(unit.tag()).toBe('vals')
    expect(unit.size()).toBe(3)
    expect(unit.big()).toBe(false)
    expect(unit.value()).toBe('hi')
  })

  test('time и tick лежат в big-endian', () => {
    const unit = sand({ time: 0x01020304, tick: 0x0506 })
    expect(hex(unit.bin.subarray(UNIT_AT.time, UNIT_AT.time + 4))).toBe('01020304')
    expect(hex(unit.bin.subarray(UNIT_AT.tick, UNIT_AT.tick + 2))).toBe('0506')
  })

  test('сдвиг одного байта меняет ровно одно поле', () => {
    const base = sand({ time: 0x01020304, tick: 0x0506 })

    const shifted = base.bin.slice()
    shifted[UNIT_AT.time] = 0xff
    const other = parseUnit(shifted)
    expect(other.time()).toBe(0xff020304)
    expect(other.tick()).toBe(0x0506)
    expect(hex(other.peer().bin)).toBe(hex(PEER))
  })

  test('длины видов выровнены на 8 байт', () => {
    expect(SandUnit.lengthOf(0)).toBe(48)
    expect(SandUnit.lengthOf(3)).toBe(56)
    expect(SandUnit.lengthOf(UNIT_BYTES.inlineMax)).toBe(112)
    expect(SandUnit.lengthOfBig()).toBe(48)
    expect(GiftUnit.lengthOf()).toBe(48)
    expect(SealUnit.lengthOf(0)).toBe(80)
    expect(SealUnit.lengthOf(1)).toBe(96) // 16 + 12 → выравнивание до 32, плюс 64
    expect(SealUnit.lengthOf(2)).toBe(104)
    expect(PassUnit.lengthOf('ed25519')).toBe(48)
    expect(PassUnit.lengthOf('p256')).toBe(88)

    for (const unit of [sand(), GiftUnit.make(giftFields()), SealUnit.make(sealFields()), PassUnit.make(passFields())]) {
      expect(unit.bin.length % 8).toBe(0)
    }
  })

  test('inline-санд оставляет байты 34…48 нулевыми — там место sizeBig и shot', () => {
    // Это не украшение теста, а зафиксированная цена раскладки: 14 байт на
    // каждый санд со значением внутри. См. отчёт по S2.
    const unit = sand()
    expect(hex(unit.bin.subarray(SAND_AT.size, SAND_AT.payload))).toBe('00'.repeat(14))
  })
})

// ── Иммутабельность ──────────────────────────────────────────────────────────

describe('иммутабельность', () => {
  test('юнит заморожен: присваивание в поле бросает', () => {
    const unit = sand()
    expect(Object.isFrozen(unit)).toBe(true)
    expect(() => {
      ;(unit as unknown as { bin: unknown }).bin = new Uint8Array(0)
    }).toThrow(TypeError)
    expect(() => {
      ;(unit as unknown as { extra: number }).extra = 1
    }).toThrow(TypeError)
  })

  test('сеттеров нет: у аксессоров нулевая арность', () => {
    // В baza каждый аксессор принимал `next` и писал в буфер. Здесь запись
    // невозможна по сигнатуре, а не по договорённости.
    const unit = sand()
    for (const name of ['time', 'tick', 'peer', 'self', 'head', 'lead', 'tag', 'size', 'value'] as const) {
      expect((unit[name] as () => unknown).length, name).toBe(0)
    }
  })

  test('фабрика копирует входные байты: правка источника юнита не меняет', () => {
    const shot = bytes('0102030405060708090a0b0c')
    const unit = SandUnit.makeBig({ peer, time: 1, tick: 0, self, head, lead, size: 100, shot })
    shot.fill(0xff)
    expect(hex(unit.shot())).toBe('0102030405060708090a0b0c')

    const sign = new Uint8Array(64).fill(1)
    const seal = SealUnit.make({ peer, time: 1, tick: 0, hashes: [], sign })
    sign.fill(9)
    expect(hex(seal.sign())).toBe('01'.repeat(64))
  })

  test('аксессоры отдают копии: правка результата юнита не меняет', () => {
    const unit = sand()
    const first = unit.bytes()
    first.fill(0xff)
    expect(hex(unit.bytes())).toBe(hex(varyEncode('hi')))

    const gift = GiftUnit.make(giftFields())
    gift.code().fill(0)
    expect(gift.coded()).toBe(true)
  })

  test('кэш ссылки переживает заморозку и отдаёт тот же объект', () => {
    // Ленивый разбор живёт в приватных полях: `Object.freeze` до них не достаёт.
    const unit = sand()
    expect(unit.self()).toBe(unit.self())
    expect(unit.peer()).toBe(unit.peer())
    expect(unit.value()).toBe(unit.value())
  })
})

// ── Порядок ──────────────────────────────────────────────────────────────────

/**
 * Пиры подобраны под ветвления сравнения:
 * - `f4…` и `f8…` дают в base64url символы `9` и `-`, которые в ASCII идут в
 *   обратном порядке — ловушка для сравнения по тексту ссылки;
 * - `f4…`/`ff…` против `00…` заводят старшее слово за 2³¹ — ловушка для
 *   знакового сравнения;
 * - четвёрка `0000 0000 …` различается только младшим словом — иначе вторая
 *   половина пира не проверялась бы вовсе.
 */
const PEERS = [
  bytes('0000000000000001'),
  bytes('0000000000000002'),
  bytes('00000000ffffffff'),
  bytes('0000000080000000'),
  bytes('f400000000000001'),
  bytes('f800000000000001'),
  bytes('a0a1a2a3a4a5a6a7'),
  bytes('ffffffffffffffff'),
]

const stampArb = fc.record({
  peer: fc.constantFrom(...PEERS),
  time: fc.integer({ min: 0, max: 3 }),
  tick: fc.integer({ min: 0, max: 3 }),
})

const wideStampArb = fc.record({
  peer: fc.uint8Array({ minLength: 8, maxLength: 8 }).map((raw) => {
    // Нулевой пир — это `Link.hole`, а у юнита автор обязателен.
    const own = raw.slice()
    if (own.every(b => b === 0)) own[7] = 1
    return own
  }),
  time: fc.integer({ min: 0, max: 0xffffffff }),
  tick: fc.integer({ min: 0, max: 0xffff }),
})

interface Stamp { peer: Uint8Array, time: number, tick: number }

function unitOf(stamp: Stamp): SandUnit {
  return SandUnit.make({
    peer: Link.peer(stamp.peer),
    time: stamp.time,
    tick: stamp.tick,
    self,
    head,
    lead,
    value: 1,
  })
}

/** Тот же юнит в виде объекта слоя ленда. `peer` — hex: он сохраняет порядок байт. */
function sandOf(stamp: Stamp): Sand {
  return {
    self: hex(SELF),
    head: hex(HEAD),
    lead: hex(LEAD),
    peer: hex(stamp.peer),
    time: stamp.time,
    tick: stamp.tick,
    value: 1,
  }
}

const sign = (n: number): number => (n < 0 ? -1 : n > 0 ? 1 : 0)

describe('compare', () => {
  test('порядок time ↓, peer ↑, tick ↓ (10 000 прогонов)', () => {
    fc.assert(
      fc.property(stampArb, stampArb, (left, right) => {
        const got = sign(Unit.compare(unitOf(left), unitOf(right)))

        // Оракул пишется от определения порядка, а не от кода: сравнение пиров
        // идёт по байтам через hex, который биективен и сохраняет порядок.
        let want = 0
        if (left.time !== right.time) want = right.time > left.time ? 1 : -1
        else if (hex(left.peer) !== hex(right.peer)) want = hex(left.peer) < hex(right.peer) ? -1 : 1
        else want = sign(right.tick - left.tick)

        expect(got).toBe(want)
      }),
      RUNS,
    )
  })

  test('совпадает с compare из land/lww на тех же входах (10 000 прогонов)', () => {
    fc.assert(
      fc.property(stampArb, stampArb, (left, right) => {
        expect(sign(Unit.compare(unitOf(left), unitOf(right)))).toBe(sign(compareSand(sandOf(left), sandOf(right))))
      }),
      RUNS,
    )
  })

  test('на широком диапазоне тоже совпадает с land/lww (10 000 прогонов)', () => {
    fc.assert(
      fc.property(wideStampArb, wideStampArb, (left, right) => {
        expect(sign(Unit.compare(unitOf(left), unitOf(right)))).toBe(sign(compareSand(sandOf(left), sandOf(right))))
      }),
      RUNS,
    )
  })

  test('строгий полный порядок: ноль только при полном совпадении меток', () => {
    fc.assert(
      fc.property(stampArb, stampArb, (left, right) => {
        const same = left.time === right.time && left.tick === right.tick && hex(left.peer) === hex(right.peer)
        expect(Unit.compare(unitOf(left), unitOf(right)) === 0).toBe(same)
      }),
      RUNS,
    )
  })

  test('антисимметричность и транзитивность сортировки', () => {
    fc.assert(
      fc.property(fc.array(stampArb, { minLength: 2, maxLength: 12 }), (stamps) => {
        const units = stamps.map(unitOf)
        for (const a of units) {
          for (const b of units) {
            // Сумма, а не `-sign`: `Object.is(-0, 0)` ложно, и сравнение знаков
            // спотыкалось бы на равных юнитах.
            expect(sign(Unit.compare(a, b)) + sign(Unit.compare(b, a))).toBe(0)
          }
        }
        const sorted = units.slice().sort(Unit.compare)
        for (let i = 1; i < sorted.length; i++) {
          expect(Unit.compare(sorted[i - 1], sorted[i])).toBeLessThanOrEqual(0)
        }
      }),
      { numRuns: 1000 },
    )
  })

  test('арбитраж по пиру: старшее слово беззнаковое, младшее тоже решает', () => {
    // Пир читается двумя словами; оба места легко испортить. Знаковое сравнение
    // старшего слова перевернуло бы порядок на пирах с байтом ≥ 0x80, а забытое
    // младшее слово сделало бы половину пиров неразличимыми.
    const cmp = (left: string, right: string): number =>
      sign(Unit.compare(
        unitOf({ peer: bytes(left), time: 1, tick: 0 }),
        unitOf({ peer: bytes(right), time: 1, tick: 0 }),
      ))

    expect(cmp('0000000000000001', '0000000000000002')).toBe(-1)
    expect(cmp('00000000ffffffff', '0000000100000000')).toBe(-1)
    expect(cmp('7fffffffffffffff', '8000000000000000')).toBe(-1)
    expect(cmp('ffffffffffffffff', '0000000000000001')).toBe(1)
    expect(cmp('a0a1a2a3a4a5a6a7', 'a0a1a2a3a4a5a6a7')).toBe(0)
  })

  test('порядок не зависит от вида юнита', () => {
    const older = GiftUnit.make({ ...giftFields(), time: 1 })
    const newer = SealUnit.make({ ...sealFields(), time: 2 })
    expect(Unit.compare(newer, older)).toBeLessThan(0)
  })

  test('отсутствующий юнит уходит в конец', () => {
    const unit = sand()
    expect(Unit.compare(undefined, undefined)).toBe(0)
    expect(Unit.compare(unit, undefined)).toBeLessThan(0)
    expect(Unit.compare(undefined, unit)).toBeGreaterThan(0)
  })

  test('обещание спецификации про memcmp 14 байт НЕ выполняется', () => {
    // §2 обещает: «поля лежат в этом порядке и в big-endian, поэтому сравнение
    // сводится к memcmp 14 байт». Ниже — контрпример на каждое из трёх
    // расхождений. Тест держит обещание опровергнутым: если кто-нибудь заменит
    // пополевое сравнение на memcmp, тест покраснеет.
    const memcmp = (a: Unit, b: Unit): number => {
      for (let i = UNIT_AT.time; i < UNIT_AT.body; i++) {
        const x = a.bin[i] as number
        const y = b.bin[i] as number
        if (x !== y) return x < y ? -1 : 1
      }
      return 0
    }

    const p1 = Link.peer(bytes('0000000000000001'))
    const p2 = Link.peer(bytes('0000000000000002'))
    const at = (time: number, tick: number, who: Link): SandUnit =>
      SandUnit.make({ peer: who, time, tick, self, head, lead, value: 1 })

    // 1. time идёт по убыванию, а memcmp — по возрастанию.
    const younger = at(2, 0, p1)
    const older = at(1, 0, p1)
    expect(Unit.compare(younger, older)).toBeLessThan(0)
    expect(memcmp(younger, older)).toBeGreaterThan(0)

    // 2. tick лежит перед peer, а по приоритету идёт после него.
    const lateTickSmallPeer = at(1, 5, p1)
    const earlyTickBigPeer = at(1, 0, p2)
    expect(Unit.compare(lateTickSmallPeer, earlyTickBigPeer)).toBeLessThan(0) // решает peer ↑
    expect(memcmp(lateTickSmallPeer, earlyTickBigPeer)).toBeGreaterThan(0) // решил tick

    // 3. Направления смешаны (↓ ↑ ↓), поэтому и «memcmp наоборот» не спасает.
    // На парах 1 и 2 обратный memcmp случайно совпадает с нужным порядком —
    // обе решаются полями, которые идут по убыванию:
    expect(sign(-memcmp(younger, older))).toBe(sign(Unit.compare(younger, older)))
    expect(sign(-memcmp(lateTickSmallPeer, earlyTickBigPeer))).toBe(
      sign(Unit.compare(lateTickSmallPeer, earlyTickBigPeer)),
    )
    // …но стоит решению перейти к peer — единственному полю, идущему по
    // возрастанию, — и знак становится противоположным. Прямой memcmp неверен
    // из-за пунктов 1–2, обратный — из-за этого. Ни один не выражает ↓↑↓.
    const smallPeer = at(1, 0, p1)
    const bigPeer = at(1, 0, p2)
    expect(sign(Unit.compare(smallPeer, bigPeer))).toBe(-1)
    expect(sign(memcmp(smallPeer, bigPeer))).toBe(-1) // прямой совпал
    expect(sign(-memcmp(smallPeer, bigPeer))).toBe(1) // обратный — против
  })

  test('арбитр по пиру идёт по байтам, а не по тексту ссылки', () => {
    // base64url ставит цифры ПОСЛЕ букв и `-`, поэтому текстовый порядок ссылок
    // не совпадает с байтовым. Слою ленда, когда он переедет на бинарный юнит,
    // это меняет исход конкурентных правок — расхождение задокументировано в
    // отчёте S2, а тест сторожит сам факт.
    // Первые 6 бит: 0xf4 → цифра 61 (`9`), 0xf8 → цифра 62 (`-`). По алфавиту
    // base64url 62 больше 61, а по ASCII `-` (0x2D) меньше `9` (0x39).
    const low = Link.peer(bytes('f400000000000001'))
    const high = Link.peer(bytes('f800000000000001'))
    expect(hex(low.bin) < hex(high.bin)).toBe(true)
    expect(low.str < high.str).toBe(false)

    const a = SandUnit.make({ peer: low, time: 1, tick: 0, self, head, lead, value: 1 })
    const b = SandUnit.make({ peer: high, time: 1, tick: 0, self, head, lead, value: 1 })
    expect(Unit.compare(a, b)).toBeLessThan(0)
  })
})

// ── Round-trip ───────────────────────────────────────────────────────────────

const valueArb = fc.oneof(
  fc.constant(null),
  fc.boolean(),
  fc.integer({ min: -1000, max: 1000 }),
  fc.string({ maxLength: 20 }),
  fc.array(fc.integer({ min: 0, max: 100 }), { maxLength: 5 }),
)

const idArb = fc.uint8Array({ minLength: 6, maxLength: 6 })

describe('round-trip', () => {
  test('поля собранного санда читаются обратно (10 000 прогонов)', () => {
    fc.assert(
      fc.property(
        wideStampArb,
        idArb,
        idArb,
        idArb,
        fc.constantFrom('term', 'solo', 'vals', 'keys' as const),
        valueArb,
        (stamp, selfId, headId, leadId, tag, value) => {
          const fields = {
            peer: Link.peer(stamp.peer),
            time: stamp.time,
            tick: stamp.tick,
            self: Link.pawn(Link.hole, selfId),
            head: Link.pawn(Link.hole, headId),
            lead: Link.pawn(Link.hole, leadId),
            tag,
            value,
          } as const

          const built = SandUnit.make(fields)
          const back = parseUnit(built.bin)
          expect(back.kind()).toBe('sand')
          if (!(back instanceof SandUnit)) return

          expect(back.time()).toBe(stamp.time)
          expect(back.tick()).toBe(stamp.tick)
          expect(hex(back.peer().bin)).toBe(hex(stamp.peer))
          expect(hex(back.bin.subarray(SAND_AT.self, SAND_AT.self + 6))).toBe(hex(selfId))
          expect(hex(back.bin.subarray(SAND_AT.head, SAND_AT.head + 6))).toBe(hex(headId))
          expect(hex(back.bin.subarray(SAND_AT.lead, SAND_AT.lead + 6))).toBe(hex(leadId))
          expect(back.tag()).toBe(tag)
          expect(back.value()).toStrictEqual(value)
          expect(hex(back.bin)).toBe(hex(built.bin))
        },
      ),
      RUNS,
    )
  })

  test('нулевой id читается как ROOT слоя ленда', () => {
    const unit = sand({ head: Link.hole, lead: Link.hole })
    expect(unit.head().str).toBe(ROOT)
    expect(unit.lead().str).toBe(ROOT)
    expect(unit.self().str).not.toBe(ROOT)
  })

  test('gift, seal и pass читаются обратно', () => {
    const gift = GiftUnit.make(giftFields())
    const giftBack = parseUnit(gift.bin)
    expect(giftBack.kind()).toBe('gift')
    if (giftBack instanceof GiftUnit) {
      expect(hex(giftBack.mate().bin)).toBe('b0b1b2b3b4b5b6b7')
      expect(giftBack.tier()).toBe(3)
      expect(giftBack.rate()).toBe(8)
      expect(giftBack.rank()).toBe(0x38)
      expect(giftBack.coded()).toBe(true)
    }

    const seal = SealUnit.make(sealFields())
    const sealBack = parseUnit(seal.bin)
    expect(sealBack.kind()).toBe('seal')
    if (sealBack instanceof SealUnit) {
      expect(sealBack.count()).toBe(2)
      expect(sealBack.wide()).toBe(true)
      expect(sealBack.hashes().map(hex)).toEqual(['0102030405060708090a0b0c', '101112131415161718191a1b'])
      expect(hex(sealBack.sign())).toBe('5a'.repeat(64))
      expect(sealBack.sens().length).toBe(seal.bin.length - 64)
    }

    const pass = PassUnit.make(passFields())
    const passBack = parseUnit(pass.bin)
    expect(passBack.kind()).toBe('pass')
    if (passBack instanceof PassUnit) {
      expect(passBack.algo()).toBe('ed25519')
      expect(hex(passBack.key())).toBe('c0'.repeat(32))
    }
  })

  test('пустая ссылка на месте mate означает «всем»', () => {
    const gift = GiftUnit.make({ ...giftFields(), mate: Link.hole })
    expect(gift.mate().str).toBe('')
    expect(gift.path()).toBe('gift:')
  })
})

// ── Значение ─────────────────────────────────────────────────────────────────

describe('значение', () => {
  test('надгробие — это один байт vary-null', () => {
    expect(hex(varyEncode(null))).toBe('00')
    const grave = sand({ value: null })
    expect(grave.dead()).toBe(true)
    expect(grave.size()).toBe(1)
    expect(grave.value()).toBeNull()
    expect(sand({ value: 'hi' }).dead()).toBe(false)
    // Строка 'N' в baza означала надгробие; у нас это обычное значение.
    expect(sand({ value: 'N' }).dead()).toBe(false)
    expect(sand({ value: 0 }).dead()).toBe(false)
  })

  test('значение до 62 байт лежит внутри юнита', () => {
    const text = 'x'.repeat(60) // vary: тег(1) + varint(1) + 60 байт = 62
    const unit = sand({ value: text })
    expect(varyEncode(text).length).toBe(UNIT_BYTES.inlineMax)
    expect(unit.big()).toBe(false)
    expect(unit.size()).toBe(UNIT_BYTES.inlineMax)
    expect(unit.value()).toBe(text)
    expect(unit.bin.length).toBe(112)
    expect(() => unit.shot()).toThrow(UnitError)
  })

  test('значение длиннее 62 байт требует ball', () => {
    const text = 'x'.repeat(61)
    expect(varyEncode(text).length).toBe(63)
    expect(() => sand({ value: text })).toThrow(UnitError)
  })

  test('makeAuto уносит длинное значение в ball и кладёт в юнит хэш', async () => {
    const text = 'y'.repeat(1000)
    const { unit, ball } = await SandUnit.makeAuto({ peer, time: 1, tick: 0, self, head, lead, value: text })

    expect(ball).not.toBeNull()
    if (ball === null) return

    expect(unit.big()).toBe(true)
    expect(unit.size()).toBe(ball.length)
    expect(unit.bin.length).toBe(48)
    expect(() => unit.value()).toThrow(UnitError)
    expect(() => unit.bytes()).toThrow(UnitError)

    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', ball))
    expect(hex(unit.shot())).toBe(hex(digest.slice(0, SHOT_BYTES)))
    expect(unit.dead()).toBe(false)
  })

  test('makeAuto оставляет короткое значение внутри', async () => {
    const { unit, ball } = await SandUnit.makeAuto({ peer, time: 1, tick: 0, self, head, lead, value: 'hi' })
    expect(ball).toBeNull()
    expect(unit.big()).toBe(false)
    expect(unit.value()).toBe('hi')
  })

  test('пустое значение представимо: inlineSize = 0 — это не маркер', () => {
    // В baza `size()` у пустого санда возвращала 2¹⁶: маркером выносного
    // значения там был 0. У нас маркер — 63, и ноль остаётся нулём.
    const bin = new Uint8Array(48)
    bin[0] = UNIT_KIND.sand
    bin[1] = 0
    bin.set(PEER, UNIT_AT.peer)
    const unit = parseUnit(bin)
    expect(unit.kind()).toBe('sand')
    // Сужение типа идёт через `instanceof`: `kind()` — метод, а по возврату
    // метода TypeScript union не сужает.
    if (!(unit instanceof SandUnit)) return
    expect(unit.size()).toBe(0)
    expect(unit.big()).toBe(false)
    expect(unit.bytes().length).toBe(0)
  })
})

// ── Диспетчер ────────────────────────────────────────────────────────────────

describe('parseUnit', () => {
  test('разбирает все четыре вида по первому байту', () => {
    const cases: Array<[number, string]> = [
      [UNIT_KIND.sand, 'sand'],
      [UNIT_KIND.gift, 'gift'],
      [UNIT_KIND.seal, 'seal'],
      [UNIT_KIND.pass, 'pass'],
    ]
    const units = [sand(), GiftUnit.make(giftFields()), SealUnit.make(sealFields()), PassUnit.make(passFields())]

    for (let i = 0; i < units.length; i++) {
      const [code, name] = cases[i] as [number, string]
      const unit = units[i] as AnyUnit
      expect(unit.bin[0]).toBe(code)
      expect(parseUnit(unit.bin).kind()).toBe(name)
      expect(unitLength(unit.bin)).toBe(unit.bin.length)
    }
  })

  test('не копирует байты — юнит остаётся окном в буфер пачки', () => {
    const built = sand()
    const arena = new Uint8Array(built.bin.length + 16)
    arena.set(built.bin, 8)
    const window = arena.subarray(8, 8 + built.bin.length)
    const unit = parseUnit(window)
    expect(unit.bin.buffer).toBe(arena.buffer)
  })

  test('неизвестный вид, обрезанный заголовок и не та длина отвергаются', () => {
    expect(() => parseUnit(new Uint8Array(48))).toThrow(UnitError) // kind = 0, свободный слот
    expect(() => parseUnit(new Uint8Array(8))).toThrow(UnitError)
    const short = sand().bin.slice(0, 40)
    expect(() => parseUnit(short)).toThrow(UnitError)
  })

  test('выносное значение короче потолка inline отвергается', () => {
    // Иначе у одного значения было бы два представления и два разных хэша.
    const unit = SandUnit.makeBig({ peer, time: 1, tick: 0, self, head, lead, size: 100, shot: new Uint8Array(12) })
    const broken = unit.bin.slice()
    broken[SAND_AT.size] = 0
    broken[SAND_AT.size + 1] = 10
    expect(() => parseUnit(broken)).toThrow(UnitError)
  })

  test('wrap проверяет вид: чужие байты не притворятся сандом', () => {
    const gift = GiftUnit.make(giftFields())
    expect(() => SandUnit.wrap(gift.bin)).toThrow(UnitError)
  })

  test('фабрики отвергают ссылку не того уровня', () => {
    const absolute = Link.pawn(Link.land(peer, new Uint8Array(8).fill(1)), SELF)
    expect(() => sand({ self: absolute })).toThrow(UnitError)
    expect(() => sand({ peer: Link.hole })).toThrow(UnitError)
    expect(() => sand({ time: -1 })).toThrow(UnitError)
    expect(() => sand({ tick: 0x10000 })).toThrow(UnitError)
  })

  test('тип сужается по kind()', () => {
    const unit: AnyUnit = parseUnit(sand().bin)
    if (unit instanceof SandUnit) {
      expectTypeOf(unit).toEqualTypeOf<SandUnit>()
      expectTypeOf(unit.value()).toEqualTypeOf<Vary>()
    }
    expectTypeOf(unit.kind()).toEqualTypeOf<UnitKind>()
    expectTypeOf(Unit.compare).parameters.toEqualTypeOf<[Unit | undefined, Unit | undefined]>()
  })
})

// ── Хэш и путь ───────────────────────────────────────────────────────────────

describe('хэш и путь', () => {
  test('хэш — первые 12 байт SHA-256 от всего буфера', async () => {
    const unit = sand()
    const want = new Uint8Array(await crypto.subtle.digest('SHA-256', unit.bin)).slice(0, SHOT_BYTES)
    expect(hex(await unit.hash())).toBe(hex(want))
    expect(shotKey(await unit.hash())).toBe(hex(want))
  })

  test('хэш отдаётся копией: правка результата кэш не портит', async () => {
    const unit = sand()
    const first = await unit.hash()
    first.fill(0)
    const second = await unit.hash()
    expect(hex(second)).not.toBe('00'.repeat(SHOT_BYTES))
  })

  test('путь: sand:head/peer/self', () => {
    expect(sand().path()).toBe(`sand:${head.str}/${peer.str}/${self.str}`)
    expect(sand({ head: Link.hole }).path()).toBe(`sand:/${peer.str}/${self.str}`)
  })

  test('путь печати опирается на peer/time.tick, а не на хэш', () => {
    const seal = SealUnit.make(sealFields())
    expect(seal.path()).toBe(`seal:${peer.str}/${seal.time()}.${seal.tick()}`)
  })

  test('паспорт проверяет, что объявленный peer выведен из ключа', async () => {
    const key = new Uint8Array(32).fill(0xc0)
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', key))
    const honest = PassUnit.make({ peer: Link.peer(digest.slice(0, 8)), time: 1, tick: 0, algo: 'ed25519', key })
    expect(await honest.verify()).toBe(true)

    const liar = PassUnit.make({ peer, time: 1, tick: 0, algo: 'ed25519', key })
    expect(await liar.verify()).toBe(false)
  })
})

// ── Golden ───────────────────────────────────────────────────────────────────
//
// Фикстуру и сборку юнита из её полей даёт общий `./golden`: те же векторы
// гоняются в Chromium (`cross-runtime.test.ts`), а туда `node:fs` не едет.

describe('golden', () => {
  test('эталонные байты разбираются в объявленные поля', () => {
    for (const vector of golden.vectors) {
      const unit = parseUnit(bytes(vector.hex))
      const at = `${vector.kind}: ${vector.note}`

      expect(unit.kind(), at).toBe(vector.kind)
      expect(unit.path(), at).toBe(vector.path)
      expect(unit.time(), at).toBe(vector.fields.time)
      expect(unit.tick(), at).toBe(vector.fields.tick)
      expect(hex(unit.peer().bin), at).toBe(vector.fields.peer)

      if (unit instanceof SandUnit) {
        expect(hex(unit.bin.subarray(SAND_AT.self, SAND_AT.self + 6)), at).toBe(vector.fields.self)
        expect(hex(unit.bin.subarray(SAND_AT.head, SAND_AT.head + 6)), at).toBe(vector.fields.head)
        expect(hex(unit.bin.subarray(SAND_AT.lead, SAND_AT.lead + 6)), at).toBe(vector.fields.lead)
        expect(unit.tag(), at).toBe(vector.fields.tag)
        expect(unit.size(), at).toBe(vector.fields.size)
        expect(unit.big(), at).toBe(vector.fields.big)
        expect(unit.dead(), at).toBe(vector.fields.dead)
        if (unit.big()) expect(hex(unit.shot()), at).toBe(vector.fields.shot)
        else expect(unit.value(), at).toStrictEqual(vector.fields.value)
      }
      if (unit instanceof GiftUnit) {
        expect(hex(unit.mate().bin), at).toBe(vector.fields.mate)
        expect(unit.tier(), at).toBe(vector.fields.tier)
        expect(unit.rate(), at).toBe(vector.fields.rate)
        expect(hex(unit.code()), at).toBe(vector.fields.code)
        expect(unit.coded(), at).toBe(vector.fields.coded)
      }
      if (unit instanceof SealUnit) {
        expect(unit.count(), at).toBe(vector.fields.count)
        expect(unit.wide(), at).toBe(vector.fields.wide)
        expect(unit.hashes().map(hex), at).toEqual(vector.fields.hashes)
        expect(hex(unit.sign()), at).toBe(vector.fields.sign)
      }
      if (unit instanceof PassUnit) {
        expect(unit.algo(), at).toBe(vector.fields.algo)
        expect(hex(unit.key()), at).toBe(vector.fields.key)
      }
    }
  })

  test('фабрики собирают ровно эталонные байты', () => {
    for (const vector of golden.vectors) {
      expect(hex(makeUnit(vector.kind, vector.fields).bin), vector.note).toBe(vector.hex)
    }
  })
})

// ── Наборы полей для видов, кроме санда ──────────────────────────────────────

function giftFields(): Parameters<typeof GiftUnit.make>[0] {
  return {
    peer,
    time: 0x01020304,
    tick: 1,
    mate: Link.peer(bytes('b0b1b2b3b4b5b6b7')),
    tier: 0b0011,
    rate: 8,
    code: bytes('00112233445566778899aabbccddeeff'),
  }
}

function sealFields(): Parameters<typeof SealUnit.make>[0] {
  return {
    peer,
    time: 0x01020304,
    tick: 2,
    hashes: [bytes('0102030405060708090a0b0c'), bytes('101112131415161718191a1b')],
    sign: new Uint8Array(64).fill(0x5a),
    wide: true,
  }
}

function passFields(): Parameters<typeof PassUnit.make>[0] {
  return { peer, time: 0x01020304, tick: 3, algo: 'ed25519', key: new Uint8Array(32).fill(0xc0) }
}
