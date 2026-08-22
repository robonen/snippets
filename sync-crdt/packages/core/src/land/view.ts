// v8:hot — здесь лежат чтение полей санда по офсету и арбитраж LWW, то есть всё,
// на чём стоят `order()` и `applyUnits` из списка горячего в PRINCIPLES.md.
//
// ─── Два уровня, и это не дублирование ───────────────────────────────────────
//
// Функции сверху читают байты БЕЗ объекта: приёму и раскладке вид на юнит не
// нужен, а завести его на каждый принятый юнит стоит +194 Б/юнит (ADR-016,
// независимое воспроизведение долга S2). {@link SandView} внизу — объектоподобный
// вид, который заводится ТОЛЬКО на прочитанный узел.
//
// ─── Почему поля свойствами, а не методами ───────────────────────────────────
//
// Довод измерен, а не эргономический: тесты слоя ленда читают поля напрямую в
// 125 местах, и `self()` ломает все 125, а `self` — ни одного. Разница в цене
// между геттером и методом — 4.54 против 3.62 нс, то есть 4 % от одного чтения
// ленда (68.6 нс) и ноль на фоне всего остального.

import { readU16, readU32 } from '../binary/bytes'
import { SAND_AT, SAND_TAG_NAME, type SandTag, SandUnit, UNIT_AT, unitLengthAt } from '../binary/unit'
import { type Vary, varyDecode } from '../binary/vary'

const KIND_SAND = 1
/** Надгробие — это `vary`-null, ровно один байт 0x00. Декодер для этого не нужен. */
const VARY_NULL = 0x00
const INLINE_BIG = 63
const PEER_BYTES = 8
const ID_BYTES = 6

/** Санд ли это. Права и подписи ленд не разбирает — это работа S6/S7. */
export function isSand(bin: Uint8Array, at: number): boolean {
  return bin[at + UNIT_AT.kind] === KIND_SAND
}

/**
 * Локальный id (6 байт) одним числом: 48 бит представимы в double ТОЧНО.
 *
 * Числом, а не строкой: строку пришлось бы материализовать на каждый lookup —
 * 604 мкс против 1336 мкс на 10 000 вставок (ADR-016). Числом, а не `Link`:
 * `Link.pawn` стоит 147.9 нс, а это чтение — 2.3 нс.
 */
export function id48(bin: Uint8Array, at: number): number {
  return readU16(bin, at) * 0x1_0000_0000 + readU32(bin, at + 2)
}

export function putId48(bin: Uint8Array, at: number, id: number): void {
  const high = Math.floor(id / 0x1_0000_0000)
  const low = id >>> 0
  bin[at] = (high >>> 8) & 0xff
  bin[at + 1] = high & 0xff
  bin[at + 2] = (low >>> 24) & 0xff
  bin[at + 3] = (low >>> 16) & 0xff
  bin[at + 4] = (low >>> 8) & 0xff
  bin[at + 5] = low & 0xff
}

/**
 * Порядок на таймлайне `time ↓, peer ↑, tick ↓` прямо на байтах — та же
 * семантика, что у `Unit.compare`, но по офсету в чужом буфере и без вида на
 * юнит. Отрицательное — `a` свежее и побеждает по LWW.
 *
 * `peer ↑` сравнивается ПО БАЙТАМ (ADR-015), двумя беззнаковыми словами: у
 * big-endian чисел порядок слов совпадает с побайтовым, а цикл на равных пирах
 * проходил бы все восемь шагов — а равные пиры тут норма, арбитраж включается
 * как раз при совпадении времени. Текстовая форма для арбитража негодна: в
 * base64url пиры `0xf4…` и `0xf8…` идут в обратном к байтам порядке.
 *
 * Эквивалентность боевому `Unit.compare` проверяется дифференциальным тестом,
 * а не глазами: это две независимые реализации одного порядка.
 */
export function cmpAt(a: Uint8Array, atA: number, b: Uint8Array, atB: number): number {
  const timeA = readU32(a, atA + UNIT_AT.time)
  const timeB = readU32(b, atB + UNIT_AT.time)
  if (timeA !== timeB) return timeB - timeA

  const highA = readU32(a, atA + UNIT_AT.peer)
  const highB = readU32(b, atB + UNIT_AT.peer)
  if (highA !== highB) return highA < highB ? -1 : 1

  const lowA = readU32(a, atA + UNIT_AT.peer + 4)
  const lowB = readU32(b, atB + UNIT_AT.peer + 4)
  if (lowA !== lowB) return lowA < lowB ? -1 : 1

  return readU16(b, atB + UNIT_AT.tick) - readU16(a, atA + UNIT_AT.tick)
}

/**
 * Совпадают ли юниты побайтово. Повторная доставка того же юнита — самый частый
 * вход `apply`, и отличить её от настоящего расхождения обязано что-то более
 * точное, чем {@link cmpAt}: тот сравнивает только метку.
 */
export function sameBytesAt(a: Uint8Array, atA: number, b: Uint8Array, atB: number): boolean {
  const size = unitLengthAt(a, atA)
  if (size !== unitLengthAt(b, atB)) return false
  for (let i = 0; i < size; i++) {
    if (a[atA + i] !== b[atB + i]) return false
  }
  return true
}

/**
 * Лексикографический порядок двух юнитов по байтам — арбитр последней инстанции.
 *
 * Нужен там, где {@link cmpAt} отдал ноль, а байты разошлись: один пир записал в
 * ту же секунду и тот же тик два разных значения. Оставить прежнего значило бы
 * решить по порядку прихода и развести реплики; байты дают порядок, одинаковый
 * у всех, — тот же канон, что у `peer` в ADR-015.
 *
 * Более короткий юнит идёт раньше при совпавшем префиксе.
 */
export function cmpBytesAt(a: Uint8Array, atA: number, b: Uint8Array, atB: number): number {
  const sizeA = unitLengthAt(a, atA)
  const sizeB = unitLengthAt(b, atB)
  const edge = sizeA < sizeB ? sizeA : sizeB
  for (let i = 0; i < edge; i++) {
    const x = a[atA + i] as number
    const y = b[atB + i] as number
    if (x !== y) return x < y ? -1 : 1
  }
  return sizeA - sizeB
}

/**
 * Надгробие ли. Проверяются байты, а не разобранное значение: `null` в `vary` —
 * это ровно один байт 0x00, и распознать его дешевле, чем звать декодер.
 */
export function deadAt(bin: Uint8Array, at: number): boolean {
  return ((bin[at + UNIT_AT.meta] as number) & 0b111111) === 1
    && bin[at + SAND_AT.payload] === VARY_NULL
}

/**
 * Подсказка о вложенных юнитах прямо из байт, без вида.
 *
 * Нужна перезаписи узла (`remove`, `move`): она собирает НОВЫЙ юнит и обязана
 * перенести `tag` с прежней версии — иначе живой словарь после перемещения
 * объявляется атомом.
 */
export function tagAt(bin: Uint8Array, at: number): SandTag {
  return SAND_TAG_NAME[(bin[at + UNIT_AT.meta] as number) >> 6] as SandTag
}

/**
 * Длина закодированного значения — внутри юнита или в приложенном `ball`.
 *
 * Одно число на оба случая: маркер `inlineSize == 63` уводит длину в поле
 * `sizeBig`, но читается она так же и означает то же самое.
 */
export function sizeAt(bin: Uint8Array, at: number): number {
  const hint = (bin[at + UNIT_AT.meta] as number) & 0b111111
  return hint === INLINE_BIG ? readU16(bin, at + SAND_AT.size) : hint
}

/**
 * Разобранное значение. `null` — надгробие.
 *
 * ОДИН ПУТЬ НА inline И НА `ball`, и это не экономия строк, а свойство раскладки:
 * длина большого санда (`shot` кончается на 48) в точности равна офсету
 * inline-нагрузки (`SAND_AT.payload` = 48). Значит выносное значение начинается
 * ровно там, где начиналось бы короткое, — а хранит его тот же слот арены, как и
 * в пачке (docs/03 §3). Отсюда и чтение одинаковое: `hint` даёт длину, `payload`
 * даёт начало.
 *
 * До S5 эта функция БРОСАЛА на большом санде: значение было негде хранить, и
 * запись длиннее 62 байт отказывала целиком. Слот арены с приложенным `ball`
 * снял и то и другое разом.
 */
export function valueAt(bin: Uint8Array, at: number): Vary {
  const hint = (bin[at + UNIT_AT.meta] as number) & 0b111111
  if (hint === INLINE_BIG) {
    const size = readU16(bin, at + SAND_AT.size)
    return varyDecode(bin.subarray(at + SAND_AT.payload, at + SAND_AT.payload + size))
  }
  if (hint === 1 && bin[at + SAND_AT.payload] === VARY_NULL) return null
  return varyDecode(bin.subarray(at + SAND_AT.payload, at + SAND_AT.payload + hint))
}

// ── Идентификатор узла ───────────────────────────────────────────────────────

declare const NODE: unique symbol

/**
 * Идентификатор узла ВНУТРИ ленда — плотный номер, а не ссылка и не текст.
 *
 * Номер выдаётся при первой встрече идентификатора и дальше живёт как SMI: он
 * ложится в `Int32Array` без бокса, а 48-битный id — нет (`map.get` 20.97 против
 * 6.38 нс, ADR-016). Наружу номера приходят из {@link SandView.self} и из
 * `Land.nodeAt`; сам по себе он не конструируется — тип брендирован именно
 * поэтому.
 */
export type LocalId = number & { readonly [NODE]: 'land.node' }

/** Корень ленда: и «нет родителя» (`head`), и «начало списка» (`lead`). */
export const ROOT = 0 as LocalId

/** То, что виду нужно от ленда: перевод чужого 48-битного id в номер узла. */
export interface Interner {
  nodeAt(id: number): LocalId
}

/**
 * Объектоподобный вид на санд в арене: поля читаются из байт по требованию и
 * кэшируются в собственных слотах.
 *
 * Вид — **окно**, а не копия: `bin` принадлежит арене ленда, писать в него
 * нельзя. Заводится вид только на тот узел, который действительно прочитали;
 * юнит, доехавший до ленда и там оставшийся, объекта не получает никогда.
 *
 * Все слоты объявлены в конструкторе — один шейп на все виды (правило 1
 * горячего пути). Сентинел незаполненного слота — `-1`, потому что `0` это
 * законный номер корня.
 *
 * @example
 * ```ts
 * const view = land.post(ROOT, ROOT, 'привет')
 * view.value            // 'привет'
 * land.order(ROOT)[0]!.self === view.self   // true
 * ```
 */
export class SandView {
  /** Глава арены, в которой лежит юнит. Окно, не копия. */
  readonly bin: Uint8Array
  /** Смещение юнита в главе. */
  readonly at: number
  /** Собственный номер узла: дети ссылаются на него как на `head`, соседи — как на `lead`. */
  readonly self: LocalId

  readonly #nodes: Interner
  #head: number
  #lead: number
  /** `undefined` — ещё не разбирали: сам `Vary` этого значения не принимает. */
  #value: Vary | undefined

  constructor(nodes: Interner, bin: Uint8Array, at: number, self: LocalId) {
    this.#nodes = nodes
    this.bin = bin
    this.at = at
    this.self = self
    this.#head = -1
    this.#lead = -1
    this.#value = undefined
  }

  /** Родитель. {@link ROOT} — корень ленда. */
  get head(): LocalId {
    const done = this.#head
    if (done >= 0) return done as LocalId
    const node = this.#nodes.nodeAt(id48(this.bin, this.at + SAND_AT.head))
    this.#head = node
    return node
  }

  /** Предыдущий сосед. {@link ROOT} — начало списка. */
  get lead(): LocalId {
    const done = this.#lead
    if (done >= 0) return done as LocalId
    const node = this.#nodes.nodeAt(id48(this.bin, this.at + SAND_AT.lead))
    this.#lead = node
    return node
  }

  /** Секунды эпохи. */
  get time(): number {
    return readU32(this.bin, this.at + UNIT_AT.time)
  }

  /** Шаг внутри секунды. */
  get tick(): number {
    return readU16(this.bin, this.at + UNIT_AT.tick)
  }

  /**
   * Автор — восемь байт окном в арену, без копии и без текста.
   *
   * Именно байты, а не строка: арбитраж определён на байтах (ADR-015), а
   * текстовая форма нужна только человеку и потому строится вызывающим.
   */
  get peer(): Uint8Array {
    const from = this.at + UNIT_AT.peer
    return this.bin.subarray(from, from + PEER_BYTES)
  }

  /** Локальный id как шесть байт — граница с форматом и хранилищем. */
  get id(): Uint8Array {
    const from = this.at + SAND_AT.self
    return this.bin.subarray(from, from + ID_BYTES)
  }

  /** Подсказка о вложенных юнитах: два старших бита `meta`. */
  get tag(): SandTag {
    return tagAt(this.bin, this.at)
  }

  /** Разобранное значение. `null` — надгробие. */
  get value(): Vary {
    const done = this.#value
    if (done !== undefined) return done
    const value = valueAt(this.bin, this.at)
    this.#value = value
    return value
  }

  /** Надгробие ли: значение выключено, но узел графа остаётся точкой привязки. */
  get dead(): boolean {
    return deadAt(this.bin, this.at)
  }

  /**
   * Тот же юнит бинарным слоем — то, что уезжает на провод и на диск.
   *
   * Строится по требованию: держать его на каждый узел значило бы платить те
   * самые +194 Б/юнит, ради отказа от которых источником истины и сделаны байты.
   */
  get unit(): SandUnit {
    const size = unitLengthAt(this.bin, this.at)
    return SandUnit.wrap(this.bin.subarray(this.at, this.at + size))
  }

  toString(): string {
    return `sand#${this.self} @${this.time}.${this.tick}`
  }
}
