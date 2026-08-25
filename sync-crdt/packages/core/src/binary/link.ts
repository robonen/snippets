// v8:hot — Link лежит в каждом юните, в каждом ключе индекса и в каждом ребре графа.
//
// Правила горячего пути (PRINCIPLES.md, правило 2): все поля объявлены в
// конструкторе, таблицы алфавита — в модульной области, массивы плотные.

/**
 * Байт на секцию ([docs/03 §1](../../../../docs/03-binary-format.md#1-link--идентификатор),
 * [ADR-007](../../../../docs/00-decisions.md#adr-007--peer--8-байт-land--16-байт)).
 *
 * Это публичный контракт с первого релиза: смена любого числа ломает и данные на
 * диске, и сеть между версиями.
 */
const PEER_BYTES = 8
const AREA_BYTES = 8
const HEAD_BYTES = 6

/** Уровни: `lord` = peer, `land` = peer+area, `pawn` = peer+area+head. */
const LORD_BYTES = PEER_BYTES
const LAND_BYTES = PEER_BYTES + AREA_BYTES
const PAWN_BYTES = LAND_BYTES + HEAD_BYTES

const PEER_AT = 0
const AREA_AT = PEER_BYTES
const HEAD_AT = LAND_BYTES

/** Символов в секции: 4 символа на каждые 3 байта, с округлением вверх. */
const PEER_CHARS = chars(PEER_BYTES)
const AREA_CHARS = chars(AREA_BYTES)
const HEAD_CHARS = chars(HEAD_BYTES)

function chars(size: number): number {
  return Math.ceil((size * 4) / 3)
}

// Алфавит — СТАНДАРТНЫЙ base64url (RFC 4648 §5), разделитель секций — точка.
//
// Первая редакция спецификации (docs/03 §1) требовала base64url и разделитель `_`
// одновременно, но `_` — это 63-й символ самого base64url, и разбор становился
// принципиально неоднозначным: `_AAAAAAAAAA` читается и как «peer опущен», и как
// «peer начинается с `_`». Фиксированные длины секций этого не спасают.
//
// Развилку можно было закрыть двумя способами: подменить 63-й символ (так делает
// baza — там алфавит с `æ`) или сменить разделитель. Выбран второй.
//
// Причина в характере отказа. С подменённым алфавитом любой стандартный декодер —
// `atob`, `Buffer.from(s, 'base64url')`, консоль браузера — МОЛЧА выдаёт не те
// байты. В формате, весь смысл которого в побайтовом хэшировании, тихая порча
// хуже громкой поломки. Со сменой разделителя стандартные инструменты продолжают
// работать посекционно, а `.` не входит в алфавит и остаётся unreserved по
// RFC 3986, то есть ссылка по-прежнему кладётся в URL без экранирования.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/** Массив символов, а не индексация строки: под `noUncheckedIndexedAccess` она даёт `string | undefined`. */
const CHARS: readonly string[] = ALPHABET.split('')

/** Обратная таблица: код символа → цифра, `-1` для всего постороннего. */
const CODES = (() => {
  const table = new Int8Array(128).fill(-1)
  for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET.charCodeAt(i)] = i
  return table
})()

const SEPARATOR = '.'

/** Один экземпляр на модуль: пустая ссылка не носит собственных байт. */
const EMPTY = new Uint8Array(0)

function fail(str: string, why: string): never {
  throw new SyntaxError(`Invalid link "${str}": ${why}`)
}

/** Все ли байты секции нулевые. */
function zeroes(bin: Uint8Array, at: number, size: number): boolean {
  for (let i = at; i < at + size; i++) {
    if (bin[i] !== 0) return false
  }
  return true
}

/**
 * Каноническая копия: хвостовые нулевые секции отбрасываются.
 *
 * ПОЧЕМУ отбрасываются, а не хранятся: текст обязан быть биекцией байтам, а в
 * тексте нулевые секции опускаются (docs/03 §1). Без усечения `land(peer, 0)` и
 * `peer` дали бы одну строку на два разных `bin`. Усечение заодно выражает
 * инвариант спецификации «нули в `area` = домашний ленд лорда»: домашний ленд и
 * есть сам лорд, одним значением.
 *
 * Ведущие нули не трогаются — на них держится относительная форма `__HEAD`.
 */
function tighten(bin: Uint8Array): Uint8Array {
  const len = bin.length
  if (len !== 0 && len !== LORD_BYTES && len !== LAND_BYTES && len !== PAWN_BYTES) {
    throw new RangeError(
      `Link length ${len} B: allowed are 0, ${LORD_BYTES}, ${LAND_BYTES}, ${PAWN_BYTES}`,
    )
  }

  let end = len
  if (end === PAWN_BYTES && zeroes(bin, HEAD_AT, HEAD_BYTES)) end = LAND_BYTES
  if (end === LAND_BYTES && zeroes(bin, AREA_AT, AREA_BYTES)) end = LORD_BYTES
  if (end === LORD_BYTES && zeroes(bin, PEER_AT, PEER_BYTES)) end = 0

  return end === 0 ? EMPTY : bin.slice(0, end)
}

function encodeSection(bin: Uint8Array, at: number, size: number): string {
  let out = ''
  let i = at
  const end = at + size

  while (end - i >= 3) {
    const a = bin[i]!
    const b = bin[i + 1]!
    const c = bin[i + 2]!
    out += CHARS[a >> 2]! + CHARS[((a & 0b11) << 4) | (b >> 4)]!
      + CHARS[((b & 0b1111) << 2) | (c >> 6)]! + CHARS[c & 0b111111]!
    i += 3
  }

  const rest = end - i
  if (rest === 2) {
    const a = bin[i]!
    const b = bin[i + 1]!
    out += CHARS[a >> 2]! + CHARS[((a & 0b11) << 4) | (b >> 4)]! + CHARS[(b & 0b1111) << 2]!
  } else if (rest === 1) {
    const a = bin[i]!
    out += CHARS[a >> 2]! + CHARS[(a & 0b11) << 4]!
  }

  return out
}

/** Разбор одной секции на месте. Пустая строка означает нулевую секцию. */
function decodeSection(
  str: string,
  part: string,
  bin: Uint8Array,
  at: number,
  size: number,
  name: string,
): void {
  if (part === '') return

  const width = chars(size)
  if (part.length !== width) {
    fail(str, `section ${name}: ${part.length} characters, expected ${width}`)
  }

  let acc = 0
  let bits = 0
  let out = at

  for (let i = 0; i < part.length; i++) {
    const code = part.charCodeAt(i)
    const digit = code < 128 ? CODES[code]! : -1
    if (digit < 0) fail(str, `section ${name}: character "${part[i]}" outside the alphabet`)

    acc = (acc << 6) | digit
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bin[out++] = (acc >> bits) & 0xff
    }
  }

  // Хвостовые биты последнего символа обязаны быть нулевыми: иначе у одних и тех
  // же байт появляется несколько текстов, и хэш от текста перестаёт быть функцией.
  if (bits > 0 && (acc & ((1 << bits) - 1)) !== 0) {
    fail(str, `section ${name}: trailing bits are not zero`)
  }

  if (zeroes(bin, at, size)) {
    fail(str, `section ${name} is zero — such sections are omitted`)
  }
}

function format(bin: Uint8Array): string {
  const len = bin.length
  if (len === 0) return ''

  let out = zeroes(bin, PEER_AT, PEER_BYTES) ? '' : encodeSection(bin, PEER_AT, PEER_BYTES)
  if (len === LORD_BYTES) return out

  out += SEPARATOR
  if (!zeroes(bin, AREA_AT, AREA_BYTES)) out += encodeSection(bin, AREA_AT, AREA_BYTES)
  if (len === LAND_BYTES) return out

  out += SEPARATOR
  out += encodeSection(bin, HEAD_AT, HEAD_BYTES)
  return out
}

function unformat(str: string): Uint8Array {
  if (str === '') return EMPTY

  const parts = str.split(SEPARATOR)
  const count = parts.length
  if (count > 3) fail(str, `${count} sections, at most 3 allowed`)

  // Хвостовая пустая секция — не «ноль», а невыполненное правило «нулевые
  // секции опускаются вместе с разделителем». Принять её значило бы отдать два
  // текста на один `bin`.
  if (parts[count - 1] === '') fail(str, 'trailing section is empty — omit it along with its separator')

  const size = count === 1 ? LORD_BYTES : count === 2 ? LAND_BYTES : PAWN_BYTES
  const bin = new Uint8Array(size)

  decodeSection(str, parts[0]!, bin, PEER_AT, PEER_BYTES, 'peer')
  if (count > 1) decodeSection(str, parts[1]!, bin, AREA_AT, AREA_BYTES, 'area')
  if (count > 2) decodeSection(str, parts[2]!, bin, HEAD_AT, HEAD_BYTES, 'head')

  return bin
}

/** Сколько первых байт SHA-256 берёт {@link Link.hash} — только канонические длины. */
export type LinkBytes = typeof LORD_BYTES | typeof LAND_BYTES | typeof PAWN_BYTES

/**
 * Вход хэширования.
 *
 * Свой алиас, а не DOM-овский `BufferSource`: `lib.dom` мы не подключаем (ядро
 * собирается и для воркеров, и для Node), а `@types/node` этот тип наружу не
 * выставляет.
 */
export type LinkSource = ArrayBufferView | ArrayBuffer

/**
 * Иммутабельный идентификатор: `peer(8) _ area(8) _ head(6)`
 * ([docs/03 §1](../../../../docs/03-binary-format.md#1-link--идентификатор)).
 *
 * Хранит байты; текст считается один раз по требованию и кэшируется. Байты и
 * текст — биекция: хвостовые нулевые секции не хранятся и не печатаются,
 * ведущие сохраняются (на них держится относительная форма `__HEAD`).
 *
 * @example
 * ```ts
 * const lord = Link.peer(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))
 * const land = Link.land(lord, area)
 * const pawn = Link.pawn(land, head)
 * pawn.relate(land).toString()          // '__…' — 6 байт вместо 22
 * pawn.relate(land).resolve(land).equals(pawn) // true
 * ```
 */
export class Link {
  /** Байты, 0 | 8 | 16 | 22. Только для чтения: мутация разошлась бы с кэшем текста. */
  readonly bin: Uint8Array
  /** Кэш текста. `null` — ещё не считали (единственный сентинел этого поля). */
  #str: string | null

  private constructor(bin: Uint8Array, str: string | null) {
    this.bin = bin
    this.#str = str
  }

  /** Пустая ссылка: ни лорда, ни ленда, ни пешки. */
  static readonly hole = new Link(EMPTY, '')

  /**
   * Ссылка из готовых байт. Длина — 0, 8, 16 или 22; байты копируются.
   *
   * ПОЧЕМУ копируются: иммутабельность — единственное, на чём держится кэш
   * текста и безопасность использования ссылки как ключа карты. Чужой буфер,
   * пришедший из `packDecode`, живёт своей жизнью.
   */
  static from(bin: Uint8Array): Link {
    return new Link(tighten(bin), null)
  }

  /** Лорд из 8 байт хэша публичного ключа. */
  static peer(bin: Uint8Array): Link {
    if (bin.length !== PEER_BYTES) {
      throw new RangeError(`peer is ${PEER_BYTES} B, got ${bin.length}`)
    }
    return new Link(tighten(bin), null)
  }

  /** Ленд лорда: `peer` + 8 байт под-ленда. Нулевой `area` даёт домашний ленд, то есть самого лорда. */
  static land(peer: Link, area: Uint8Array): Link {
    if (area.length !== AREA_BYTES) {
      throw new RangeError(`area is ${AREA_BYTES} B, got ${area.length}`)
    }
    const bin = new Uint8Array(LAND_BYTES)
    bin.set(peer.bin.subarray(0, Math.min(peer.bin.length, LORD_BYTES)))
    bin.set(area, AREA_AT)
    return new Link(tighten(bin), null)
  }

  /** Пешка в ленде: `land` + 6 байт локального id. */
  static pawn(land: Link, head: Uint8Array): Link {
    if (head.length !== HEAD_BYTES) {
      throw new RangeError(`head is ${HEAD_BYTES} B, got ${head.length}`)
    }
    const bin = new Uint8Array(PAWN_BYTES)
    bin.set(land.bin.subarray(0, Math.min(land.bin.length, LAND_BYTES)))
    bin.set(head, HEAD_AT)
    return new Link(tighten(bin), null)
  }

  /** Разбор текста. Бросает `SyntaxError` с указанием секции и причины. */
  static parse(str: string): Link {
    return new Link(unformat(str), str)
  }

  /**
   * Первые `size` байт SHA-256 — идентификатор содержимого.
   *
   * ПОЧЕМУ async: `crypto.subtle.digest` асинхронен на всех платформах, где мы
   * живём (браузер, Node, воркер), и синхронного общего API у WebCrypto нет.
   * Прятать это за собственной реализацией SHA-256 ради синхронной сигнатуры —
   * лишний код в горячем формате и второй источник правды по хэшу. Кому хэш уже
   * посчитан (например, `packDecode` читает его из буфера) — берёт
   * {@link Link.from} от готового среза, без промиса.
   */
  static async hash(data: LinkSource, size: LinkBytes = LORD_BYTES): Promise<Link> {
    const digest = await crypto.subtle.digest('SHA-256', data)
    return new Link(tighten(new Uint8Array(digest, 0, size)), null)
  }

  /** Текст: base64url-секции через `_`, нулевые секции опущены. Считается один раз. */
  get str(): string {
    const cached = this.#str
    if (cached !== null) return cached

    const text = format(this.bin)
    this.#str = text
    return text
  }

  /** Лорд: первые 8 байт. При наших размерах совпадает с {@link Link.lord}. */
  peer(): Link {
    if (this.bin.length === 0) return Link.hole
    return new Link(tighten(this.bin.subarray(0, LORD_BYTES)), null)
  }

  /**
   * Под-ленд как самостоятельная ссылка: `_AREA`.
   *
   * ПОЧЕМУ секция остаётся на своём месте (ведущие нули вместо «просто id»):
   * позиция — часть значения. Так `area()`, `head()` и {@link relate} дают
   * ссылки одного вида, которые складываются {@link xor} и сравниваются между
   * собой без разбора уровня. В baza секции позиции не имели и `area()` от
   * пешки была неотличима от `peer()` другого лорда.
   */
  area(): Link {
    if (this.bin.length < LAND_BYTES) return Link.hole
    // Нулевую секцию отсекаем до сборки: `tighten` иначе скопировал бы буфер
    // второй раз. Замер: `relate` (тот же приём в `head`) 147.9 → 93.6 нс.
    if (zeroes(this.bin, AREA_AT, AREA_BYTES)) return Link.hole

    const bin = new Uint8Array(LAND_BYTES)
    bin.set(this.bin.subarray(AREA_AT, LAND_BYTES), AREA_AT)
    return new Link(bin, null)
  }

  /** Локальный id пешки как относительная ссылка: `__HEAD`. Она же результат {@link relate}. */
  head(): Link {
    if (this.bin.length < PAWN_BYTES) return Link.hole
    if (zeroes(this.bin, HEAD_AT, PAWN_BYTES - HEAD_AT)) return Link.hole

    const bin = new Uint8Array(PAWN_BYTES)
    bin.set(this.bin.subarray(HEAD_AT, PAWN_BYTES), HEAD_AT)
    return new Link(bin, null)
  }

  /** Ленд, которому принадлежит ссылка: первые 16 байт. */
  land(): Link {
    if (this.bin.length <= LAND_BYTES) return this
    return new Link(tighten(this.bin.subarray(0, LAND_BYTES)), null)
  }

  /** Домашний ленд лорда — он же сам лорд: `area` нулевая, значит усечена. */
  lord(): Link {
    return this.peer()
  }

  /**
   * Абсолютная пешка → относительная внутри своего ленда: 22 байта → 6.
   *
   * Ссылка не из этого ленда и ссылка не уровня пешки возвращаются как есть —
   * относительной формы для них не существует.
   */
  relate(base: Link): Link {
    if (this.bin.length !== PAWN_BYTES) return this
    // Сравниваем первые 16 байт с добивкой нулями, а не `land()`: канонические
    // длины у ленда и лорда разные, а лишняя аллокация здесь не нужна.
    if (!sameHead(this.bin, base.bin, LAND_BYTES)) return this
    return this.head()
  }

  /**
   * Относительная пешка (`__HEAD`) → абсолютная в ленде `base`.
   *
   * Уже абсолютная ссылка, ссылка не уровня пешки и пустой `base` возвращаются
   * как есть, поэтому `relate`/`resolve` взаимно обратны на своих формах.
   */
  resolve(base: Link): Link {
    if (this.bin.length !== PAWN_BYTES) return this
    if (!zeroes(this.bin, PEER_AT, LAND_BYTES)) return this
    if (base.bin.length === 0) return this

    const bin = new Uint8Array(PAWN_BYTES)
    bin.set(base.bin.subarray(0, Math.min(base.bin.length, LAND_BYTES)))
    bin.set(this.bin.subarray(HEAD_AT), HEAD_AT)
    // Канонизация не нужна: `head` ненулевой, иначе ссылка была бы пустой.
    return new Link(bin, null)
  }

  /**
   * Побайтовый XOR — подмешивание идентификатора в подпись.
   *
   * Короткий операнд дополняется нулями до длинного: нули — нейтральный элемент,
   * и это ровно та же добивка, которой канонизация отбрасывает хвост. Значит
   * `xor` не зависит от того, усечена ссылка или нет.
   */
  xor(other: Link | Uint8Array): Uint8Array {
    const right = other instanceof Link ? other.bin : other
    const out = new Uint8Array(Math.max(this.bin.length, right.length))
    out.set(this.bin)
    for (let i = 0; i < right.length; i++) out[i] = out[i]! ^ right[i]!
    return out
  }

  /** Равенство по байтам. Канонические длины делают его равенством значений. */
  equals(other: Link): boolean {
    if (other === this) return true
    const left = this.bin
    const right = other.bin
    if (left.length !== right.length) return false
    for (let i = 0; i < left.length; i++) {
      if (left[i] !== right[i]) return false
    }
    return true
  }

  /** Ключ для `Map`/`Set`: тот же текст. Байты ключом быть не могут — у них ссылочное равенство. */
  key(): string {
    return this.str
  }

  toString(): string {
    return this.str
  }

  toJSON(): string {
    return this.str
  }
}

/** Совпадают ли первые `size` байт двух ссылок с добивкой нулями. */
function sameHead(left: Uint8Array, right: Uint8Array, size: number): boolean {
  for (let i = 0; i < size; i++) {
    if ((left[i] ?? 0) !== (right[i] ?? 0)) return false
  }
  return true
}

/** Размеры секций — для тестов, бенчей и кодека юнита. */
export const LINK_BYTES = {
  peer: PEER_BYTES,
  area: AREA_BYTES,
  head: HEAD_BYTES,
  lord: LORD_BYTES,
  land: LAND_BYTES,
  pawn: PAWN_BYTES,
} as const

/** Длины секций в символах — для тестов и разбора чужих строк. */
export const LINK_CHARS = {
  peer: PEER_CHARS,
  area: AREA_CHARS,
  head: HEAD_CHARS,
} as const

/** Алфавит текстовой формы. Экспортируется, чтобы тесты сверяли его с внешним кодеком. */
export const LINK_ALPHABET = ALPHABET
