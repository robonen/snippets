// v8:hot — аксессоры офсетов и `Unit.compare` числятся горячими в PRINCIPLES.md
// (раздел `@sync/core/binary`). Правила горячего пути действуют на весь файл:
// все поля объявлены в конструкторе базового класса, виды юнитов не добавляют
// своих полей (правило 1: «один шейп на узел графа… то же для видов юнитов»),
// константы живут в модульной области, массивы плотные.
//
// ─── Раскладка ───────────────────────────────────────────────────────────────
//
// Общая часть — 16 байт у всех четырёх видов
// ([docs/03 §2](../../../../docs/03-binary-format.md#2-unit--юнит)):
//
//   off  len  поле
//   0     1   kind    1=sand 2=gift 3=seal 4=pass
//   1     1   meta    sand: tag(2 бита) | inlineSize(6 бит) · seal: wide(1) | count(4)
//   2     4   time    BE, секунды эпохи
//   6     2   tick    BE, шаг внутри секунды
//   8     8   peer    первые 8 байт SHA-256 публичного ключа (ADR-007)
//
// Sand — данные:
//
//   16    6   self · 22 6 head · 28 6 lead   (локальные id внутри ленда)
//   34    2   sizeBig    если inlineSize == 63
//   36   12   shot       SHA-256[0..12) от ball — если big
//   48    …   payload    inline, ≤ 62 байта, длина юнита выровнена до 8
//
// Gift — права: 16 8 mate · 24 1 rank · 32 16 code, всего 48.
// Seal — подпись: 16 … hashes (count × 12) · хвост 64 байта sign.
// Pass — публичный ключ: 16 … key (см. {@link PassUnit}).
//
// Юнит **иммутабелен**: конструкторы приватные, наружу торчат только статические
// фабрики, а сам объект заморожен. Кэши лежат в `#`-полях — `Object.freeze` их не
// трогает, потому что приватные поля не являются свойствами объекта.
//
// ─── Почему не DataView ──────────────────────────────────────────────────────
//
// Спецификация говорит «поля читаются по офсетам через `DataView`». Мы читаем
// big-endian вручную, из тех же байт и с теми же офсетами. Причина в замере
// (`bench/unit.mjs`, раздел «DataView против ручного big-endian»):
//
//   `DataView.getUint32(2, false)`   2.8 нс   против 4.3 нс у ручного чтения
//   создание вида на юнит           58.6 нс   и +48 Б к каждому юниту
//   создание вида на чтение         53.6 нс
//
// То есть вид окупается только с двадцатого чтения одного и того же юнита, а
// платится он на каждом разобранном юните пачки — включая те, которые дальше
// LWW-свёртки не проживут. Смысл спецификации («поля не копируются в JS-объект»)
// ручное чтение выполняет полностью, а лишнего объекта на юнит не заводит.

import { align8, readU16, readU32, writeU16, writeU32 } from './bytes'
import { Link } from './link'
import { shotInto } from './sha256'
import { type Vary, varyDecode, varyEncode } from './vary'

/**
 * Отказ кодека юнита: чужие байты не той длины, поле не того уровня, значение,
 * которое не влезло. Всё это — исключительные ситуации, а не значения
 * (PRINCIPLES.md, раздел «Ошибки»).
 *
 * `at` — место: `sand[34]`, `поле lead`, `юнит 47 Б`.
 */
export class UnitError extends Error {
  readonly reason: string
  readonly at: string

  constructor(reason: string, at: string) {
    super(at === '' ? reason : `${reason} — ${at}`)
    this.name = 'UnitError'
    this.reason = reason
    this.at = at
  }
}

// ── Константы формата ────────────────────────────────────────────────────────

/** Вид юнита. Код лежит в байте 0 и по нему же работает {@link parseUnit}. */
export type UnitKind = 'sand' | 'gift' | 'seal' | 'pass'

/**
 * Подсказка, как читать вложенные юниты: само значение · регистр · список ·
 * словарь ([docs/03 §2](../../../../docs/03-binary-format.md#sand--данные)).
 */
export type SandTag = 'term' | 'solo' | 'vals' | 'keys'

/** Алгоритм подписи, зафиксированный в `meta` паспорта ([docs/07 §2](../../../../docs/07-crypto-rights.md)). */
export type PassAlgo = 'ed25519' | 'p256'

const KIND_SAND = 1
const KIND_GIFT = 2
const KIND_SEAL = 3
const KIND_PASS = 4

/** Код вида → имя. Плотный массив, индекс 0 — свободный слот арены (docs/03 §3). */
const KIND_NAME: readonly string[] = ['', 'sand', 'gift', 'seal', 'pass']

/**
 * Таблицы подсказки в обе стороны. Экспортируются, потому что слой ленда пишет
 * байты санда прямо в арену, минуя {@link SandUnit.make} (объектная обёртка над
 * идентификатором стоит 147.9 нс на ссылку, ADR-016), — и обязан кодировать
 * `tag` теми же двумя битами, а не своей копией таблицы.
 */
export const SAND_TAG_NAME: readonly SandTag[] = ['term', 'solo', 'vals', 'keys']
export const SAND_TAG_CODE: Readonly<Record<SandTag, number>> = { term: 0, solo: 1, vals: 2, keys: 3 }

const ALGO_NAME: readonly PassAlgo[] = ['ed25519', 'p256']
/** Длина сырого ключа по алгоритму: Ed25519 — 32 Б, ECDSA P-256 — несжатая точка 0x04‖X‖Y. */
const ALGO_KEY: readonly number[] = [32, 65]

/** Офсеты общей части. Экспортируются: тест раскладки обязан читать те же числа, что и код. */
export const UNIT_AT = {
  kind: 0,
  meta: 1,
  time: 2,
  tick: 6,
  peer: 8,
  /** Конец общей части — начало части, своей у каждого вида. */
  body: 16,
} as const

export const SAND_AT = {
  self: 16,
  head: 22,
  lead: 28,
  size: 34,
  shot: 36,
  payload: 48,
} as const

export const GIFT_AT = { mate: 16, rank: 24, code: 32 } as const
export const SEAL_AT = { hashes: 16 } as const
export const PASS_AT = { key: 16 } as const

const PEER_BYTES = 8
const HEAD_BYTES = 6
/** Хэш содержимого — 12 байт: столько же кладётся в `Seal` (docs/03 §2). */
export const SHOT_BYTES = 12
const SIGN_BYTES = 64
const CODE_BYTES = 16
const MATE_BYTES = 8
const GIFT_BYTES = 48

/**
 * Максимум inline-значения — 62 байта, а не 63.
 *
 * Спецификация одновременно обещает «payload inline, ≤ 63 байт» и «sizeBig, если
 * inlineSize == 63»: 63 не может быть и длиной, и маркером. Маркером — потому
 * что альтернатива (маркер 0, как в baza) отбирает у формата пустую нагрузку и
 * делает `size()` неоднозначным: в baza `size()` у нулевого санда возвращает
 * 2¹⁶. Мы теряем один байт ёмкости и получаем однозначность.
 */
const INLINE_MAX = 62
const INLINE_BIG = 63

/** Потолок выносного значения: `sizeBig` — два байта. */
const BALL_MAX = 0xffff

/** Надгробие — это `vary`-null, один байт 0x00. Сторожевой тест сверяет константу с кодеком. */
const VARY_NULL = 0x00

const TIME_MAX = 0xffffffff
const TICK_MAX = 0xffff

/** Пустой результат: один на модуль, чтобы не плодить аллокаций (правило 7). */
const NO_BYTES = new Uint8Array(0)

const HEX: string[] = []
for (let i = 0; i < 256; i++) HEX.push(i.toString(16).padStart(2, '0'))

// ── Работа с байтами ─────────────────────────────────────────────────────────
//
// Чтение и запись big-endian переехали в `bytes.ts`: у них появился третий
// читатель (слой ленда), а правило 3 вводит абстракцию ровно по факту третьего
// повторения.

/** Шестнадцатеричный текст: ключ карты для хэшей, которые Link представлять не умеет. */
export function shotKey(shot: Uint8Array): string {
  let out = ''
  for (let i = 0; i < shot.length; i++) out += HEX[shot[i] as number]
  return out
}

/**
 * Локальный id (6 байт) как ссылка вида `..HEAD`.
 *
 * Именно эта форма выходит из {@link Link.relate}, и именно у неё `str` пустой,
 * когда id нулевой, — то есть `head().str` совпадает с сентинелом `ROOT` слоя
 * ленда (`src/land/sand.ts`). Слой порядка переезжает на юнит без правки логики.
 */
function headLink(bin: Uint8Array, at: number): Link {
  return Link.pawn(Link.hole, bin.subarray(at, at + HEAD_BYTES))
}

/** Лорд (8 байт). Нулевые байты канонизируются в {@link Link.hole} — «всем» у `gift.mate`. */
function peerLink(bin: Uint8Array, at: number): Link {
  return Link.peer(bin.subarray(at, at + PEER_BYTES))
}

/** Кладёт локальный id ссылки. Абсолютная пешка отвергается: в юните живёт только `head`. */
function putHead(bin: Uint8Array, at: number, link: Link, field: string): void {
  const src = link.bin
  if (src.length === 0) return

  if (src.length !== 22) {
    throw new UnitError(`${field}: ожидалась пешка (22 Б) или пустая ссылка, а в ней ${src.length} Б`, `поле ${field}`)
  }
  for (let i = 0; i < 16; i++) {
    if (src[i] !== 0) {
      throw new UnitError(
        `${field}: ссылка абсолютная, а юнит хранит только локальный id — позовите relate(land)`,
        `поле ${field}`,
      )
    }
  }
  // Ручной цикл вместо `bin.set(src.subarray(16, 22), at)`: сам `subarray`
  // аллоцирует вид и стоит 35 нс, а вся пара — 40 нс против 8 нс у цикла.
  // На санде таких копий четыре, и сборка подешевела с 400 до 285 нс.
  for (let i = 0; i < HEAD_BYTES; i++) bin[at + i] = src[16 + i] as number
}

/** Кладёт лорда. `hole` разрешён только там, где ноль имеет смысл (`gift.mate` — «всем»). */
function putPeer(bin: Uint8Array, at: number, link: Link, field: string, holed: boolean): void {
  const src = link.bin
  if (src.length === 0) {
    if (holed) return
    throw new UnitError(`${field}: пустая ссылка, а у юнита обязан быть автор`, `поле ${field}`)
  }
  if (src.length < PEER_BYTES) {
    throw new UnitError(`${field}: ожидался лорд (8 Б), а в ссылке ${src.length} Б`, `поле ${field}`)
  }
  for (let i = 0; i < PEER_BYTES; i++) bin[at + i] = src[i] as number
}

function putStamp(bin: Uint8Array, kind: number, stamp: UnitStamp, holedPeer: boolean): void {
  if (!Number.isInteger(stamp.time) || stamp.time < 0 || stamp.time > TIME_MAX) {
    throw new UnitError(`time = ${stamp.time}: ожидалось целое 0…${TIME_MAX}`, 'поле time')
  }
  if (!Number.isInteger(stamp.tick) || stamp.tick < 0 || stamp.tick > TICK_MAX) {
    throw new UnitError(`tick = ${stamp.tick}: ожидалось целое 0…${TICK_MAX}`, 'поле tick')
  }
  bin[UNIT_AT.kind] = kind
  writeU32(bin, UNIT_AT.time, stamp.time)
  writeU16(bin, UNIT_AT.tick, stamp.tick)
  putPeer(bin, UNIT_AT.peer, stamp.peer, 'peer', holedPeer)
}

/**
 * Проверка перед тем, как обернуть чужие байты: вид тот, длина сходится с
 * раскладкой. Общая для всех четырёх видов — иначе проверка размножилась бы по
 * `wrap`'ам и разъехалась.
 */
function checked(bin: Uint8Array, kind: number): void {
  const want = unitLength(bin)
  const got = bin[UNIT_AT.kind] as number
  if (got !== kind) {
    throw new UnitError(`ожидался ${unitKindName(kind)}, а в байте 0 — ${unitKindName(got)}`, `юнит ${bin.length} Б`)
  }
  if (bin.length !== want) {
    throw new UnitError(`${unitKindName(kind)}: ожидалось ${want} Б, пришло ${bin.length}`, `юнит ${bin.length} Б`)
  }
}

// ── Общая часть ──────────────────────────────────────────────────────────────

/** Метка авторства и времени — общая часть всех четырёх видов. */
export interface UnitStamp {
  /** Автор: лорд (8 Б). Он же детерминированный арбитр при равном времени. */
  readonly peer: Link
  /** Секунды эпохи. */
  readonly time: number
  /** Шаг внутри секунды. */
  readonly tick: number
}

/**
 * Вид над байтами юнита ([docs/03 §2](../../../../docs/03-binary-format.md#2-unit--юнит)).
 *
 * Поля читаются по офсетам, а не копируются в объект: хэш считается по точным
 * байтам, на диск и в сокет уходит memcpy, а 100k юнитов остаются 100k буферов
 * без графа объектов для GC.
 *
 * Объект заморожен, сеттеров нет; собрать юнит можно только фабрикой вида.
 *
 * @example
 * ```ts
 * const unit = parseUnit(bytes)
 * if (unit instanceof SandUnit) console.log(unit.value())
 * ```
 */
export abstract class Unit {
  /**
   * Байты юнита. **Окно, а не копия**: `parseUnit` не копирует, потому что
   * буфер пачки и есть арена хранилища (docs/03 §3, docs/06). Запись в это окно
   * — выход за контракт: юнит объявлен иммутабельным, а его хэш кэшируется.
   */
  readonly bin: Uint8Array

  // Кэши. Приватные поля, а не свойства: `Object.freeze` до них не достаёт, и
  // ленивый разбор уживается с иммутабельностью.
  //
  // Слоты ссылок общие на все виды — иначе у каждого вида был бы свой шейп
  // (правило 1). Кто чем пользуется:
  //   sand → A: self · B: head · C: lead
  //   gift → A: mate
  //   seal, pass → не пользуются
  #peer: Link | null
  #slotA: Link | null
  #slotB: Link | null
  #slotC: Link | null
  #shot: Uint8Array | null
  /** `undefined` — ещё не разбирали: сам `Vary` этого значения не принимает. */
  #vary: Vary | undefined

  protected constructor(bin: Uint8Array) {
    this.bin = bin
    this.#peer = null
    this.#slotA = null
    this.#slotB = null
    this.#slotC = null
    this.#shot = null
    this.#vary = undefined
    // Инвариант спецификации: после создания юнит иммутабелен. Присваивание в
    // модуле (а модули строгие) бросает TypeError, а не молчит.
    Object.freeze(this)
  }

  abstract kind(): UnitKind

  /** Ключ в хранилище: `[landId, path]` (docs/06 §2). */
  abstract path(): string

  /** Секунды эпохи. */
  time(): number {
    return readU32(this.bin, UNIT_AT.time)
  }

  /** Шаг внутри секунды: два поста в одну секунду различаются им. */
  tick(): number {
    return readU16(this.bin, UNIT_AT.tick)
  }

  /** Автор юнита. */
  peer(): Link {
    const done = this.#peer
    if (done !== null) return done
    const link = peerLink(this.bin, UNIT_AT.peer)
    this.#peer = link
    return link
  }

  /** Монотонное «время+тик» одним числом — удобно для сравнения фейсов. */
  timeTick(): number {
    return this.time() * 0x10000 + this.tick()
  }

  /**
   * SHA-256[0..12) от всего буфера — идентификатор содержимого, он же элемент
   * списка в `Seal`. Считается один раз, наружу отдаётся копия.
   *
   * ПОЧЕМУ Promise, а не `Link`, как обещает §2 спецификации:
   * 1. Синхронного SHA-256 у платформы нет — `crypto.subtle.digest` асинхронен
   *    везде, где мы живём. Та же причина, что у {@link Link.hash}; своя
   *    реализация SHA-256 ради синхронной подписи — второй источник правды по
   *    хэшу в формате, весь смысл которого в побайтовом хэшировании.
   * 2. `Link` 12 байт представить не может: канонические длины — 0, 8, 16, 22
   *    (docs/03 §1). Втискивать хэш в `Link` пришлось бы либо расширением
   *    канона, либо усечением до 8 байт — а в `Seal` кладутся именно 12.
   *    Поэтому хэш юнита — просто 12 байт; текстовый ключ даёт {@link shotKey}.
   */
  async hash(): Promise<Uint8Array> {
    const done = this.#shot
    if (done !== null) return done.slice()

    const digest = await crypto.subtle.digest('SHA-256', this.bin)
    const shot = new Uint8Array(digest).slice(0, SHOT_BYTES)
    this.#shot = shot
    return shot.slice()
  }

  /**
   * Порядок на таймлайне: `time ↓, peer ↑, tick ↓`
   * ([docs/04 §3](../../../../docs/04-crdt-core.md#3-lww)). Отрицательное — `a`
   * свежее и побеждает по LWW. Отсутствующий юнит уходит в конец.
   *
   * **Обещание спецификации о memcmp не выполняется — и не может.** §2 говорит:
   * «поля лежат в этом порядке и в big-endian, поэтому сравнение сводится к
   * memcmp 14 байт». На нашей раскладке подряд лежат `time(2..6)`, `tick(6..8)`,
   * `peer(8..16)`, и memcmp по ним даёт `time ↑, tick ↑, peer ↑` — расходится с
   * требуемым порядком трижды:
   *   1. `time` нужен по убыванию, memcmp даёт возрастание;
   *   2. `tick` лежит раньше `peer`, а по приоритету идёт позже;
   *   3. направления смешаны (`↓ ↑ ↓`), а memcmp — один лексикографический
   *      порядок в одну сторону. Никакая перестановка полей этого не чинит:
   *      нужно хранить `~time` и `~tick` и переставить `tick` за `peer`.
   * Поэтому сравнение здесь пополевое. Тест `unit.compare` держит контрпример,
   * чтобы обещание не вернулось в код по недосмотру.
   */
  static compare(a: Unit | undefined, b: Unit | undefined): number {
    if (a === undefined) return b === undefined ? 0 : +1
    if (b === undefined) return -1

    const left = a.bin
    const right = b.bin

    // time ↓ — позднее изменение перекрывает раннее.
    const leftTime = readU32(left, UNIT_AT.time)
    const rightTime = readU32(right, UNIT_AT.time)
    if (leftTime !== rightTime) return rightTime - leftTime

    // peer ↑ — детерминированный арбитр, когда два пира записали в одну секунду.
    // Сравнение по БАЙТАМ: текстовая форма ссылки на порядок не годится, потому
    // что base64url ставит цифры после букв, а по байтам они идут до.
    //
    // Восемь байт читаются двумя беззнаковыми словами, а не циклом: у BE-чисел
    // порядок слов совпадает с побайтовым, а цикл на равных пирах (а арбитраж
    // включается как раз при совпадении времени, где пиры часто совпадают тоже)
    // проходил все восемь шагов. Замер на сортировке 1000 юнитов, где ничьи
    // встречаются постоянно: 156.1 → 125.0 мкс.
    const leftHigh = readU32(left, UNIT_AT.peer)
    const rightHigh = readU32(right, UNIT_AT.peer)
    if (leftHigh !== rightHigh) return leftHigh < rightHigh ? -1 : 1

    const leftLow = readU32(left, UNIT_AT.peer + 4)
    const rightLow = readU32(right, UNIT_AT.peer + 4)
    if (leftLow !== rightLow) return leftLow < rightLow ? -1 : 1

    // tick ↓ — внутри секунды у одного пира побеждает более поздняя запись.
    return readU16(right, UNIT_AT.tick) - readU16(left, UNIT_AT.tick)
  }

  /** Диспетчер по байту 0. Не копирует: юнит — окно в буфер пачки. */
  static parse(bin: Uint8Array): AnyUnit {
    return parseUnit(bin)
  }

  toJSON(): string {
    return this.toString()
  }

  toString(): string {
    return `${this.path()} @${this.time()}.${this.tick()}`
  }

  // ── Служебное для видов ────────────────────────────────────────────────────

  /** Ссылка на локальный id из слота кэша. Слоты расписаны в комментарии к полям. */
  protected slot(index: number, at: number): Link {
    if (index === 0) {
      const done = this.#slotA
      if (done !== null) return done
      const link = headLink(this.bin, at)
      this.#slotA = link
      return link
    }
    if (index === 1) {
      const done = this.#slotB
      if (done !== null) return done
      const link = headLink(this.bin, at)
      this.#slotB = link
      return link
    }
    const done = this.#slotC
    if (done !== null) return done
    const link = headLink(this.bin, at)
    this.#slotC = link
    return link
  }

  /** Лорд из слота A — `gift.mate`. */
  protected slotPeer(at: number): Link {
    const done = this.#slotA
    if (done !== null) return done
    const link = peerLink(this.bin, at)
    this.#slotA = link
    return link
  }

  /** Разобранное значение, один раз на юнит. */
  protected varyAt(at: number, size: number): Vary {
    const done = this.#vary
    if (done !== undefined) return done
    const value = varyDecode(this.bin.subarray(at, at + size))
    this.#vary = value
    return value
  }
}

// ── Sand ─────────────────────────────────────────────────────────────────────

/** Поля санда. `value` кодируется {@link varyEncode} и обязан уложиться в 62 байта. */
export interface SandFields extends UnitStamp {
  /** Собственный id: дети ссылаются на него как на `head`, соседи — как на `lead`. */
  readonly self: Link
  /** Родитель. Пустая ссылка — корень ленда. */
  readonly head: Link
  /** Предыдущий сосед. Пустая ссылка — начало списка. */
  readonly lead: Link
  /** Подсказка о вложенных юнитах. По умолчанию `term`. */
  readonly tag?: SandTag
  /** Полезная нагрузка. `null` — надгробие. */
  readonly value: Vary
}

/** Поля санда с выносным значением: сам `ball` лежит отдельно, в юните — его хэш. */
export interface SandBigFields extends UnitStamp {
  readonly self: Link
  readonly head: Link
  readonly lead: Link
  readonly tag?: SandTag
  /** Длина закодированного значения: 63…65535. */
  readonly size: number
  /** SHA-256[0..12) от `ball`. */
  readonly shot: Uint8Array
}

/**
 * Юнит данных. Это **ребро** графа, а не узел
 * ([docs/04 §2](../../../../docs/04-crdt-core.md)): `head` держит вертикаль,
 * `lead` — горизонталь, `self` — то, на что ссылаются дети и следующие соседи.
 *
 * @example
 * ```ts
 * const sand = SandUnit.make({ peer, time: 1, tick: 0, self, head: Link.hole, lead: Link.hole, value: 'hi' })
 * sand.value()      // 'hi'
 * sand.head().str   // '' — корень ленда, тот же сентинел, что и ROOT
 * ```
 */
export class SandUnit extends Unit {
  /** Длина санда с inline-значением в `size` байт. */
  static lengthOf(size: number): number {
    return align8(SAND_AT.payload + size)
  }

  /** Длина санда с выносным значением — фиксированная. */
  static lengthOfBig(): number {
    return SAND_AT.shot + SHOT_BYTES
  }

  /**
   * Оборачивает чужие байты, когда вид известен заранее. Проверяет вид и длину;
   * байты не копирует — юнит остаётся окном в буфер пачки.
   */
  static wrap(bin: Uint8Array): SandUnit {
    checked(bin, KIND_SAND)

    if (((bin[UNIT_AT.meta] as number) & 0b111111) === INLINE_BIG) {
      const size = readU16(bin, SAND_AT.size)
      // Иначе у одного значения нашлось бы два представления: короткое ушло бы
      // в ball вместо inline, и хэши двух одинаковых сандов разошлись бы.
      if (size <= INLINE_MAX) {
        throw new UnitError(
          `выносное значение объявлено в ${size} Б — такое обязано лежать внутри юнита`,
          `sand[${SAND_AT.size}]`,
        )
      }
    }

    return new SandUnit(bin)
  }

  /**
   * Санд со значением внутри юнита.
   *
   * @throws {UnitError} если закодированное значение длиннее 62 байт — тогда
   * нужен {@link SandUnit.makeBig} или {@link SandUnit.makeAuto}.
   */
  static make(fields: SandFields): SandUnit {
    const payload = varyEncode(fields.value)
    if (payload.length > INLINE_MAX) {
      throw new UnitError(
        `значение занимает ${payload.length} Б, а inline влезает ${INLINE_MAX} — нужен makeBig/makeAuto`,
        'поле value',
      )
    }

    const bin = new Uint8Array(SandUnit.lengthOf(payload.length))
    putStamp(bin, KIND_SAND, fields, false)
    bin[UNIT_AT.meta] = (SAND_TAG_CODE[fields.tag ?? 'term'] << 6) | payload.length
    putHead(bin, SAND_AT.self, fields.self, 'self')
    putHead(bin, SAND_AT.head, fields.head, 'head')
    putHead(bin, SAND_AT.lead, fields.lead, 'lead')
    bin.set(payload, SAND_AT.payload)

    return new SandUnit(bin)
  }

  /** Санд с выносным значением: длина и 12-байтовый хэш `ball` приходят готовыми. */
  static makeBig(fields: SandBigFields): SandUnit {
    if (!Number.isInteger(fields.size) || fields.size <= INLINE_MAX || fields.size > BALL_MAX) {
      throw new UnitError(`size = ${fields.size}: у выносного значения ${INLINE_MAX + 1}…${BALL_MAX} Б`, 'поле size')
    }
    if (fields.shot.length !== SHOT_BYTES) {
      throw new UnitError(`shot — ${SHOT_BYTES} Б, пришло ${fields.shot.length}`, 'поле shot')
    }

    const bin = new Uint8Array(SandUnit.lengthOfBig())
    putStamp(bin, KIND_SAND, fields, false)
    bin[UNIT_AT.meta] = (SAND_TAG_CODE[fields.tag ?? 'term'] << 6) | INLINE_BIG
    putHead(bin, SAND_AT.self, fields.self, 'self')
    putHead(bin, SAND_AT.head, fields.head, 'head')
    putHead(bin, SAND_AT.lead, fields.lead, 'lead')
    writeU16(bin, SAND_AT.size, fields.size)
    bin.set(fields.shot, SAND_AT.shot)

    return new SandUnit(bin)
  }

  /**
   * Санд под любое значение: короткое уходит внутрь, длинное — в `ball`, и тогда
   * юнит несёт только его хэш.
   *
   * СТАЛА СИНХРОННОЙ на S5, и это не удобство, а необходимость: `Land.write`
   * синхронен (ADR-002), а без выносного значения он отказывал на 63 байтах —
   * то есть на 32 кириллических буквах. `crypto.subtle.digest` в синхронную
   * запись не встаёт, поэтому `shot` считает свой SHA-256 (`binary/sha256.ts`),
   * сверенный с WebCrypto дифференциальным тестом.
   *
   * `ball === null` означает, что значение уместилось внутри юнита.
   */
  static makeAuto(fields: SandFields): { unit: SandUnit, ball: Uint8Array | null } {
    const payload = varyEncode(fields.value)
    if (payload.length <= INLINE_MAX) return { unit: SandUnit.make(fields), ball: null }
    if (payload.length > BALL_MAX) {
      throw new UnitError(`значение занимает ${payload.length} Б, потолок ball — ${BALL_MAX}`, 'поле value')
    }

    const shot = new Uint8Array(SHOT_BYTES)
    shotInto(shot, 0, payload, 0, payload.length)
    const unit = SandUnit.makeBig({
      peer: fields.peer,
      time: fields.time,
      tick: fields.tick,
      self: fields.self,
      head: fields.head,
      lead: fields.lead,
      tag: fields.tag,
      size: payload.length,
      shot,
    })
    return { unit, ball: payload }
  }

  override kind(): 'sand' {
    return 'sand'
  }

  /** Подсказка о вложенных юнитах: два старших бита `meta`. */
  tag(): SandTag {
    return SAND_TAG_NAME[(this.bin[UNIT_AT.meta] as number) >> 6] as SandTag
  }

  /** Вынесено ли значение в отдельный `ball`. */
  big(): boolean {
    return ((this.bin[UNIT_AT.meta] as number) & 0b111111) === INLINE_BIG
  }

  /** Длина закодированного значения — внутри юнита или в `ball`. */
  size(): number {
    const hint = (this.bin[UNIT_AT.meta] as number) & 0b111111
    return hint === INLINE_BIG ? readU16(this.bin, SAND_AT.size) : hint
  }

  /** Собственный id. */
  self(): Link {
    return this.slot(0, SAND_AT.self)
  }

  /** Родитель. `str === ''` — корень ленда. */
  head(): Link {
    return this.slot(1, SAND_AT.head)
  }

  /** Предыдущий сосед. `str === ''` — начало списка. */
  lead(): Link {
    return this.slot(2, SAND_AT.lead)
  }

  /**
   * Хэш выносного значения (12 Б, копия).
   *
   * @throws {UnitError} у санда со значением внутри — хэша там нет.
   */
  shot(): Uint8Array {
    if (!this.big()) throw new UnitError('у санда со значением внутри shot отсутствует', 'поле shot')
    return this.bin.slice(SAND_AT.shot, SAND_AT.shot + SHOT_BYTES)
  }

  /**
   * Закодированные байты значения (копия).
   *
   * @throws {UnitError} у санда с выносным значением — байты лежат в `ball`.
   */
  bytes(): Uint8Array {
    if (this.big()) throw new UnitError('значение вынесено в ball — читайте его по shot()', 'поле value')
    const size = this.size()
    if (size === 0) return NO_BYTES
    return this.bin.slice(SAND_AT.payload, SAND_AT.payload + size)
  }

  /**
   * Разобранное значение. `null` — надгробие.
   *
   * @throws {UnitError} у санда с выносным значением.
   */
  value(): Vary {
    if (this.big()) throw new UnitError('значение вынесено в ball — разбирайте его varyDecode(ball)', 'поле value')
    return this.varyAt(SAND_AT.payload, this.size())
  }

  /**
   * Надгробие ли: у мёртвого юнита значение выключено, но узел графа остаётся.
   *
   * Проверяются байты, а не разобранное значение: `null` в `vary` — это ровно
   * один байт 0x00, и распознать его дешевле, чем звать декодер.
   */
  dead(): boolean {
    if (this.big()) return false
    return this.size() === 1 && this.bin[SAND_AT.payload] === VARY_NULL
  }

  override path(): string {
    return `sand:${this.head().str}/${this.peer().str}/${this.self().str}`
  }
}

// ── Gift ─────────────────────────────────────────────────────────────────────

export interface GiftFields extends UnitStamp {
  /** Кому выданы права. Пустая ссылка — всем. */
  readonly mate: Link
  /** Уровень доступа: старшие 4 бита ранга (docs/07 §1). */
  readonly tier: number
  /** Сложность записи (PoW): младшие 4 бита ранга. */
  readonly rate: number
  /** Секрет ленда, зашифрованный взаимным ключом. 16 Б или пусто. */
  readonly code?: Uint8Array
}

/** Выдача прав и ключа ленда. */
export class GiftUnit extends Unit {
  static lengthOf(): number {
    return GIFT_BYTES
  }

  /** Оборачивает чужие байты с проверкой вида и длины. */
  static wrap(bin: Uint8Array): GiftUnit {
    checked(bin, KIND_GIFT)
    return new GiftUnit(bin)
  }

  static make(fields: GiftFields): GiftUnit {
    if (!Number.isInteger(fields.tier) || fields.tier < 0 || fields.tier > 0b1111) {
      throw new UnitError(`tier = ${fields.tier}: ожидалось 0…15`, 'поле tier')
    }
    if (!Number.isInteger(fields.rate) || fields.rate < 0 || fields.rate > 0b1111) {
      throw new UnitError(`rate = ${fields.rate}: ожидалось 0…15`, 'поле rate')
    }
    const code = fields.code
    if (code !== undefined && code.length !== CODE_BYTES) {
      throw new UnitError(`code — ${CODE_BYTES} Б, пришло ${code.length}`, 'поле code')
    }

    const bin = new Uint8Array(GIFT_BYTES)
    putStamp(bin, KIND_GIFT, fields, false)
    putPeer(bin, GIFT_AT.mate, fields.mate, 'mate', true)
    bin[GIFT_AT.rank] = (fields.tier << 4) | fields.rate
    if (code !== undefined) bin.set(code, GIFT_AT.code)

    return new GiftUnit(bin)
  }

  override kind(): 'gift' {
    return 'gift'
  }

  /** Кому выданы права. `Link.hole` — всем. */
  mate(): Link {
    return this.slotPeer(GIFT_AT.mate)
  }

  /** Ранг целиком: `tier(4) | rate(4)`. Биты уровня вложенные — сравнение одно. */
  rank(): number {
    return this.bin[GIFT_AT.rank] as number
  }

  tier(): number {
    return (this.bin[GIFT_AT.rank] as number) >> 4
  }

  rate(): number {
    return (this.bin[GIFT_AT.rank] as number) & 0b1111
  }

  /** Секрет ленда (16 Б, копия). Нули означают «секрета нет». */
  code(): Uint8Array {
    return this.bin.slice(GIFT_AT.code, GIFT_AT.code + CODE_BYTES)
  }

  /** Есть ли в подарке секрет ленда. */
  coded(): boolean {
    for (let i = GIFT_AT.code; i < GIFT_AT.code + CODE_BYTES; i++) {
      if (this.bin[i] !== 0) return true
    }
    return false
  }

  override path(): string {
    return `gift:${this.mate().str}`
  }
}

// ── Seal ─────────────────────────────────────────────────────────────────────

export interface SealFields extends UnitStamp {
  /** Хэши подписываемых юнитов, по 12 Б, не больше 15. */
  readonly hashes: readonly Uint8Array[]
  /** Подпись, 64 Б. */
  readonly sign: Uint8Array
  /** Признак широкой пачки (docs/03 §2). */
  readonly wide?: boolean
}

/**
 * Подпись пачки хэшей: одна операция ECDSA на десяток изменений
 * ([docs/07 §3](../../../../docs/07-crypto-rights.md)).
 */
export class SealUnit extends Unit {
  /** Длина печати на `count` хэшей: заголовок и хэши выравниваются, дальше 64 Б подписи. */
  static lengthOf(count: number): number {
    return align8(SEAL_AT.hashes + count * SHOT_BYTES) + SIGN_BYTES
  }

  /** Оборачивает чужие байты с проверкой вида и длины. */
  static wrap(bin: Uint8Array): SealUnit {
    checked(bin, KIND_SEAL)
    return new SealUnit(bin)
  }

  static make(fields: SealFields): SealUnit {
    const count = fields.hashes.length
    if (count > 0b1111) throw new UnitError(`хэшей ${count}, а в meta влезает 15`, 'поле hashes')
    if (fields.sign.length !== SIGN_BYTES) {
      throw new UnitError(`sign — ${SIGN_BYTES} Б, пришло ${fields.sign.length}`, 'поле sign')
    }

    const bin = new Uint8Array(SealUnit.lengthOf(count))
    putStamp(bin, KIND_SEAL, fields, false)
    bin[UNIT_AT.meta] = count | (fields.wide === true ? 0b1000_0000 : 0)

    for (let i = 0; i < count; i++) {
      const shot = fields.hashes[i] as Uint8Array
      if (shot.length !== SHOT_BYTES) {
        throw new UnitError(`хэш #${i} — ${shot.length} Б, ожидалось ${SHOT_BYTES}`, `поле hashes[${i}]`)
      }
      bin.set(shot, SEAL_AT.hashes + i * SHOT_BYTES)
    }
    bin.set(fields.sign, bin.length - SIGN_BYTES)

    return new SealUnit(bin)
  }

  override kind(): 'seal' {
    return 'seal'
  }

  /** Сколько хэшей в пачке. */
  count(): number {
    return (this.bin[UNIT_AT.meta] as number) & 0b1111
  }

  wide(): boolean {
    return ((this.bin[UNIT_AT.meta] as number) & 0b1000_0000) !== 0
  }

  /** Хэш #`index` (12 Б, копия). */
  hashAt(index: number): Uint8Array {
    if (index < 0 || index >= this.count()) {
      throw new UnitError(`хэш #${index}, а их ${this.count()}`, 'поле hashes')
    }
    const at = SEAL_AT.hashes + index * SHOT_BYTES
    return this.bin.slice(at, at + SHOT_BYTES)
  }

  /** Все хэши пачки. Массив плотный и свежий: он уходит наружу. */
  hashes(): Uint8Array[] {
    const out: Uint8Array[] = []
    const count = this.count()
    for (let i = 0; i < count; i++) out.push(this.hashAt(i))
    return out
  }

  /** Подпись (64 Б, копия). */
  sign(): Uint8Array {
    return this.bin.slice(this.bin.length - SIGN_BYTES)
  }

  /**
   * Байты, которые подписаны, — весь юнит без хвостовой подписи.
   *
   * Окно, а не копия: отсюда данные уходят прямо в `crypto.subtle.sign`,
   * который их только читает.
   */
  sens(): Uint8Array {
    return this.bin.subarray(0, this.bin.length - SIGN_BYTES)
  }

  /**
   * Ключ хранилища.
   *
   * ПОЧЕМУ не `seal:lord/hash`, как в baza: хэш у нас асинхронный (см.
   * {@link Unit.hash}), а `path()` зовётся на каждой записи и обязан быть
   * синхронным. Пара `time.tick` у одного пира строго растёт при каждом посте
   * (см. `Replica.post`), поэтому `peer/time.tick` так же уникальна, как хэш, и
   * вдобавок сортируется по времени — печати одного пира ложатся в хранилище
   * подряд.
   */
  override path(): string {
    return `seal:${this.peer().str}/${this.time()}.${this.tick()}`
  }
}

// ── Pass ─────────────────────────────────────────────────────────────────────

export interface PassFields extends UnitStamp {
  readonly algo: PassAlgo
  /** Сырой публичный ключ: 32 Б для Ed25519, 65 Б для несжатой точки P-256. */
  readonly key: Uint8Array
}

/**
 * Публичный ключ пира.
 *
 * ПОЧЕМУ не «сырой ключ фиксированной длины», как обещает §2 спецификации:
 * 1. Диспетчер {@link parseUnit} читает вид из байта 0. У сырого ключа этот байт
 *    — часть ключа: у несжатой точки P-256 там 0x04 (что совпало с кодом
 *    `pass` случайно), а у Ed25519 — произвольный байт. baza выкручивалась
 *    перебором ключей, у которых первый байт равен 0xFF; это PoW ради разбора.
 * 2. §2 [docs/07](../../../../docs/07-crypto-rights.md) требует хранить в первом
 *    байте выбор алгоритма — а он же занят видом.
 * 3. `peer` (SHA-256 ключа) без заголовка считается только асинхронно, и тогда
 *    `path()` паспорта не может быть синхронным, как у остальных видов.
 *
 * Поэтому паспорт носит ту же 16-байтовую общую часть, что и прочие виды, а
 * ключ лежит с офсета 16. Восемь байт `peer` в нём избыточны — и это **не**
 * повод им верить: {@link PassUnit.verify} обязана быть вызвана до того, как
 * паспорт куда-то принят.
 */
export class PassUnit extends Unit {
  static lengthOf(algo: PassAlgo): number {
    return align8(PASS_AT.key + (ALGO_KEY[ALGO_NAME.indexOf(algo)] as number))
  }

  /** Оборачивает чужие байты с проверкой вида, алгоритма и длины. */
  static wrap(bin: Uint8Array): PassUnit {
    checked(bin, KIND_PASS)
    return new PassUnit(bin)
  }

  static make(fields: PassFields): PassUnit {
    const code = ALGO_NAME.indexOf(fields.algo)
    if (code < 0) throw new UnitError(`алгоритм «${fields.algo}» неизвестен`, 'поле algo')

    const want = ALGO_KEY[code] as number
    if (fields.key.length !== want) {
      throw new UnitError(`ключ ${fields.algo} — ${want} Б, пришло ${fields.key.length}`, 'поле key')
    }

    const bin = new Uint8Array(PassUnit.lengthOf(fields.algo))
    putStamp(bin, KIND_PASS, fields, false)
    bin[UNIT_AT.meta] = code
    bin.set(fields.key, PASS_AT.key)

    return new PassUnit(bin)
  }

  override kind(): 'pass' {
    return 'pass'
  }

  algo(): PassAlgo {
    return ALGO_NAME[this.bin[UNIT_AT.meta] as number] as PassAlgo
  }

  /** Сырой публичный ключ (копия). */
  key(): Uint8Array {
    const size = ALGO_KEY[this.bin[UNIT_AT.meta] as number] as number
    return this.bin.slice(PASS_AT.key, PASS_AT.key + size)
  }

  /**
   * Совпадает ли объявленный `peer` с SHA-256[0..8) от ключа.
   *
   * Пока это не проверено, `peer()` паспорта — просто чужое утверждение.
   */
  async verify(): Promise<boolean> {
    const size = ALGO_KEY[this.bin[UNIT_AT.meta] as number] as number
    const digest = await crypto.subtle.digest('SHA-256', this.bin.subarray(PASS_AT.key, PASS_AT.key + size))
    const shot = new Uint8Array(digest)
    for (let i = 0; i < PEER_BYTES; i++) {
      if (shot[i] !== this.bin[UNIT_AT.peer + i]) return false
    }
    return true
  }

  override path(): string {
    return `pass:${this.peer().str}`
  }
}

// ── Дисптечер ────────────────────────────────────────────────────────────────

/**
 * Любой вид юнита.
 *
 * Сужение — через `instanceof`: `kind()` это метод, а по результату вызова
 * TypeScript объединение не сужает. Строка из `kind()` нужна дампам, ключам и
 * сообщениям об ошибке, а не проверкам типа.
 */
export type AnyUnit = SandUnit | GiftUnit | SealUnit | PassUnit

/**
 * Сколько байт занимает юнит, начинающийся в начале `bin`.
 *
 * Нужна пачке, чтобы шагнуть к следующему слоту, не разбирая юнит целиком.
 *
 * @throws {UnitError} на неизвестном виде или обрыве заголовка.
 */
export function unitLength(bin: Uint8Array): number {
  return unitLengthAt(bin, 0)
}

/**
 * То же, но для юнита, лежащего со смещения `at` в чужом буфере.
 *
 * Нужна пачке: без неё шаг к следующему слоту стоил бы лишнего `subarray` на
 * каждый юнит — 35 нс и вид в куче там, где всей работы на два чтения байта
 * (замер приведён в шапке `unit.ts`).
 *
 * @throws {UnitError} на неизвестном виде или обрыве заголовка.
 */
export function unitLengthAt(bin: Uint8Array, at: number): number {
  const rest = bin.length - at
  if (rest < UNIT_AT.body) {
    throw new UnitError(`заголовок юнита — ${UNIT_AT.body} Б, а доступно ${rest}`, `юнит ${rest} Б`)
  }

  const kind = bin[at + UNIT_AT.kind] as number
  const meta = bin[at + UNIT_AT.meta] as number

  if (kind === KIND_SAND) {
    const hint = meta & 0b111111
    return hint === INLINE_BIG ? SandUnit.lengthOfBig() : SandUnit.lengthOf(hint)
  }
  if (kind === KIND_GIFT) return GIFT_BYTES
  if (kind === KIND_SEAL) return SealUnit.lengthOf(meta & 0b1111)
  if (kind === KIND_PASS) {
    const size = ALGO_KEY[meta]
    if (size === undefined) throw new UnitError(`алгоритм №${meta} неизвестен`, `юнит ${rest} Б`)
    return align8(PASS_AT.key + size)
  }

  throw new UnitError(`вид №${kind} неизвестен`, `юнит ${rest} Б`)
}

/**
 * Сколько байт занимает юнит ВМЕСТЕ с приложенным выносным значением.
 *
 * Это соглашение пачки (docs/03 §3): за большим сандом идёт его `ball`, добитый
 * нулями до кратности 8. Арена ленда и образ хранилища кладут юнит так же — в
 * этом и состоит «один формат на провод, диск и память» (ADR-005): значение
 * лежит там же, где его положил бы кодек, и потому пересылка ленда наружу это
 * копия байт, а не сборка.
 *
 * Совпадает с {@link unitLengthAt} у всех, кроме большого санда.
 */
export function unitSpanAt(bin: Uint8Array, at: number): number {
  const size = unitLengthAt(bin, at)
  if (bin[at + UNIT_AT.kind] !== KIND_SAND) return size
  if (((bin[at + UNIT_AT.meta] as number) & 0b111111) !== INLINE_BIG) return size
  return size + align8(readU16(bin, at + SAND_AT.size))
}

/**
 * Ключ юнита в хранилище — байтовый двойник {@link Unit.path}.
 *
 * РАСХОЖДЕНИЕ С docs/06 §2, и оно измерено: спецификация просит ключом `path()`,
 * а тот строит четыре `Link` по 147.9 нс каждая (ADR-016) — 0.6 мс на батч из
 * 1000 юнитов, то есть 2 % бюджета сохранения, потраченные на текст, которого
 * никто не читает. Здесь те же поля берутся прямо из байт: 20 байт `head‖peer‖self`
 * в шестнадцатеричном виде, порядок полей тот же, что в `path()`.
 *
 * Ключ ОБЯЗАН различать версии одного узла от разных пиров и НЕ различать версии
 * одного пира: перезапись значения тем же пиром обязана попасть в тот же слот
 * хранилища, иначе арена растёт по числу правок.
 */
export function unitKeyAt(bin: Uint8Array, at: number): string {
  const kind = bin[at + UNIT_AT.kind] as number

  if (kind === KIND_SAND) {
    let out = 's'
    for (let i = 0; i < HEAD_BYTES; i++) out += HEX[bin[at + SAND_AT.head + i] as number]
    for (let i = 0; i < PEER_BYTES; i++) out += HEX[bin[at + UNIT_AT.peer + i] as number]
    for (let i = 0; i < HEAD_BYTES; i++) out += HEX[bin[at + SAND_AT.self + i] as number]
    return out
  }

  if (kind === KIND_GIFT) {
    let out = 'g'
    for (let i = 0; i < MATE_BYTES; i++) out += HEX[bin[at + GIFT_AT.mate + i] as number]
    return out
  }

  if (kind === KIND_PASS) {
    let out = 'p'
    for (let i = 0; i < PEER_BYTES; i++) out += HEX[bin[at + UNIT_AT.peer + i] as number]
    return out
  }

  if (kind === KIND_SEAL) {
    // Метка `peer/time.tick` уникальна только у СОБСТВЕННЫХ юнитов пира: печать
    // же чеканится на границе провода (S6, `signPack`), и две печати одного
    // пира над РАЗНЫМИ пачками могут совпасть меткой (та же секунда; печать
    // поверх чужих юнитов при поручительстве). Совпавший ключ склеил бы их в
    // один слот, и вторая печать молча пропала бы при ретрансляции — санды под
    // ней стали бы недоказуемыми у третьих устройств. Поэтому в ключ
    // подмешивается XOR-свёртка списка хэшей: синхронный суррогат хэша
    // содержимого (сам `Unit.hash` асинхронен и ключом быть не может).
    let out = 'l'
    for (let i = 0; i < PEER_BYTES; i++) out += HEX[bin[at + UNIT_AT.peer + i] as number]
    const count = (bin[at + UNIT_AT.meta] as number) & 0b1111
    const fold = new Uint8Array(SHOT_BYTES)
    for (let item = 0; item < count; item++) {
      const from = at + SEAL_AT.hashes + item * SHOT_BYTES
      for (let i = 0; i < SHOT_BYTES; i++) fold[i] = (fold[i] as number) ^ (bin[from + i] as number)
    }
    let mix = ''
    for (let i = 0; i < SHOT_BYTES; i++) mix += HEX[fold[i] as number]
    return `${out}/${readU32(bin, at + UNIT_AT.time)}.${readU16(bin, at + UNIT_AT.tick)}/${mix}`
  }

  throw new UnitError(`вид №${kind} неизвестен`, `юнит по офсету ${at}`)
}

/**
 * Разбирает байты в юнит нужного вида.
 *
 * Диспетчеризация однократная (PRINCIPLES.md, правило 4 горячего пути): дальше
 * работают мономорфные методы вида. Байты **не копируются** — юнит остаётся
 * окном в буфер пачки, и в этом весь смысл бинарного формата.
 *
 * @throws {UnitError} если вид неизвестен или длина не сходится с раскладкой.
 *
 * @example
 * ```ts
 * const unit = parseUnit(bytes)
 * if (unit instanceof SandUnit && !unit.dead()) use(unit.value())
 * ```
 */
export function parseUnit(bin: Uint8Array): AnyUnit {
  if (bin.length < UNIT_AT.body) {
    throw new UnitError(`заголовок юнита — ${UNIT_AT.body} Б, а доступно ${bin.length}`, `юнит ${bin.length} Б`)
  }

  const kind = bin[UNIT_AT.kind] as number
  if (kind === KIND_SAND) return SandUnit.wrap(bin)
  if (kind === KIND_GIFT) return GiftUnit.wrap(bin)
  if (kind === KIND_SEAL) return SealUnit.wrap(bin)
  if (kind === KIND_PASS) return PassUnit.wrap(bin)

  throw new UnitError(`вид №${kind} неизвестен`, `юнит ${bin.length} Б`)
}

/** Имя вида по коду из байта 0 — для сообщений об ошибке и дампов. */
export function unitKindName(code: number): string {
  return KIND_NAME[code] ?? `№${code}`
}

/** Коды видов: тест раскладки обязан читать те же числа, что и диспетчер. */
export const UNIT_KIND = {
  sand: KIND_SAND,
  gift: KIND_GIFT,
  seal: KIND_SEAL,
  pass: KIND_PASS,
} as const

/** Размеры, на которые опираются тесты, бенч и будущая пачка. */
export const UNIT_BYTES = {
  head: UNIT_AT.body,
  peer: PEER_BYTES,
  id: HEAD_BYTES,
  shot: SHOT_BYTES,
  sign: SIGN_BYTES,
  code: CODE_BYTES,
  mate: MATE_BYTES,
  gift: GIFT_BYTES,
  inlineMax: INLINE_MAX,
  inlineBig: INLINE_BIG,
  ballMax: BALL_MAX,
} as const
