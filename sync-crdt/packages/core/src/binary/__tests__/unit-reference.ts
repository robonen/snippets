// Независимый разбор байтов юнита — вторая реализация формата.
//
// Golden-векторы фиксируют поведение, но не доказывают правильность: их выписал
// тот же человек, что писал `unit.ts`, из того же понимания раскладки. Здесь
// разбор написан заново по ТАБЛИЦЕ ОФСЕТОВ из `docs/03-binary-format.md` §2 и по
// шапке `../unit.ts` — а не срисован с кода. Совпадение двух независимых
// прочтений одного описания и есть доказательство.
//
// Правила горячего пути тут НЕ действуют намеренно: файл живёт в `__tests__`,
// скорость не важна, и любая оптимизация — это шанс повторить чужую ошибку.
// Поля читаются через `DataView` (ровно как обещает §2: «поля читаются по
// офсетам через `DataView`»), а не ручными сдвигами, как в бою: разный механизм
// чтения big-endian — это и есть смысл сверки. Выравнивание считается через
// `Math.ceil`, а не битовой маской. Значение санда разбирает `referenceDecode`
// из `vary-reference.ts` — тоже прибор, а не боевой кодек.
//
// ─── Прочтение описания ──────────────────────────────────────────────────────
//
// Общая часть, 16 байт у всех четырёх видов:
//
//   0   1  kind    1=sand 2=gift 3=seal 4=pass
//   1   1  meta    sand: tag(2 бита) | inlineSize(6 бит) · seal: wide(1) | count(4)
//                  pass: код алгоритма · gift: не задействован
//   2   4  time    BE
//   6   2  tick    BE
//   8   8  peer
//
// Sand:  16 6 self · 22 6 head · 28 6 lead · 34 2 sizeBig · 36 12 shot · 48 … payload
//        inlineSize == 63 — маркер выносного значения; длина юнита выровнена до 8
// Gift:  16 8 mate · 24 1 rank(tier<<4|rate) · 32 16 code — всего 48
// Seal:  16 … hashes (count × 12) · хвост 64 байта sign, между ними выравнивание
// Pass:  16 … key — 32 Б (Ed25519, meta 0) либо 65 Б (P-256, meta 1)
//
// ─── Строгость ───────────────────────────────────────────────────────────────
//
// Разбор строгий, по той же причине, по которой строг `vary-reference.ts`:
// формат адресуется хэшем от точных байт, поэтому у одного логического юнита
// обязано быть ровно одно байтовое представление. Что проверяется:
//   1. длина юнита ровно та, которую диктует раскладка;
//   2. байты, не занятые ни одним полем (выравнивание, дыра gift[25..32],
//      неиспользованные sizeBig/shot у inline-санда), — нули;
//   3. биты `meta`, не занятые ни одним полем (seal[4..6], весь meta у gift), — нули;
//   4. выносное значение объявлено длиннее inline-потолка (иначе два представления);
//   5. код вида и код алгоритма — из известных.
// Всё, что строже боевого `parseUnit`, помечено ниже словом СТРОЖЕ.

import { referenceDecode, type RefVary } from './vary-reference'

/**
 * Отказ независимого разбора. Отдельный класс, а не `UnitError`: путать, чья это
 * была жалоба — кодека или прибора сверки, — в отчёте о расхождении нельзя.
 */
export class UnitMismatch extends Error {
  readonly at: string

  constructor(reason: string, at: string) {
    super(`${reason} — ${at}`)
    this.name = 'UnitMismatch'
    this.at = at
  }
}

export type RefKind = 'sand' | 'gift' | 'seal' | 'pass'
export type RefTag = 'term' | 'solo' | 'vals' | 'keys'
export type RefAlgo = 'ed25519' | 'p256'

/** Общая часть — та самая, что лежит в первых 16 байтах любого вида. */
export interface RefHead {
  readonly kind: RefKind
  /** Длина юнита по раскладке — она же обязана совпасть с длиной входа. */
  readonly length: number
  readonly meta: number
  readonly time: number
  readonly tick: number
  /** 8 байт автора. Копия, а не окно: прибор ничего не одалживает у входа. */
  readonly peer: Uint8Array
}

export interface RefSand extends RefHead {
  readonly kind: 'sand'
  readonly tag: RefTag
  /** Вынесено ли значение в отдельный `ball`. */
  readonly big: boolean
  /** Длина закодированного значения: внутри юнита или в `ball`. */
  readonly size: number
  readonly self: Uint8Array
  readonly head: Uint8Array
  readonly lead: Uint8Array
  /** 12 байт хэша `ball` — только у выносного значения. */
  readonly shot: Uint8Array | null
  /** Байты значения — только у inline-санда. */
  readonly payload: Uint8Array | null
  /** Разобранное значение — независимым разбором `vary`. */
  readonly value: RefVary | undefined
}

export interface RefGift extends RefHead {
  readonly kind: 'gift'
  readonly mate: Uint8Array
  readonly rank: number
  readonly tier: number
  readonly rate: number
  readonly code: Uint8Array
  readonly coded: boolean
}

export interface RefSeal extends RefHead {
  readonly kind: 'seal'
  readonly count: number
  readonly wide: boolean
  readonly hashes: Uint8Array[]
  readonly sign: Uint8Array
}

export interface RefPass extends RefHead {
  readonly kind: 'pass'
  readonly algo: RefAlgo
  readonly key: Uint8Array
}

export type RefUnit = RefSand | RefGift | RefSeal | RefPass

// ── Числа формата, выписанные из описания ────────────────────────────────────

const REF_HEAD_BYTES = 16
const REF_PEER_BYTES = 8
const REF_ID_BYTES = 6
const REF_SHOT_BYTES = 12
const REF_SIGN_BYTES = 64
const REF_CODE_BYTES = 16
const REF_GIFT_BYTES = 48

/** `inlineSize == 63` — маркер выносного значения, поэтому inline-потолок 62. */
const REF_INLINE_BIG = 63
const REF_INLINE_MAX = 62
/** `sizeBig` — два байта, значит выносное значение не длиннее 65535. */
const REF_BALL_MAX = 65535

const REF_KIND: readonly RefKind[] = ['sand', 'gift', 'seal', 'pass']
const REF_TAG: readonly RefTag[] = ['term', 'solo', 'vals', 'keys']
const REF_ALGO: readonly RefAlgo[] = ['ed25519', 'p256']
/** Длина сырого ключа по алгоритму: Ed25519 — 32 Б, P-256 — несжатая точка 65 Б. */
const REF_ALGO_KEY: readonly number[] = [32, 65]

// ── Чтение байт ──────────────────────────────────────────────────────────────

/** Секции формата выровнены на 8 байт (§3). Считаем делением, а не битовой маской. */
function align(size: number): number {
  return Math.ceil(size / 8) * 8
}

function hex(bin: Uint8Array): string {
  let out = ''
  for (const byte of bin) out += byte.toString(16).padStart(2, '0')
  return out
}

/** Вид на те же байты. Заводится на каждое чтение: прибору дорого — и пусть. */
function view(bin: Uint8Array, at: number, size: number): DataView {
  if (at < 0 || at + size > bin.length) {
    throw new UnitMismatch(`чтение ${size} Б с офсета ${at} выходит за юнит ${bin.length} Б`, `байт ${at}`)
  }
  return new DataView(bin.buffer, bin.byteOffset + at, size)
}

/** Big-endian 32 бита — «поля читаются по офсетам через DataView» (§2). */
function readU32(bin: Uint8Array, at: number): number {
  return view(bin, at, 4).getUint32(0, false)
}

function readU16(bin: Uint8Array, at: number): number {
  return view(bin, at, 2).getUint16(0, false)
}

function readU8(bin: Uint8Array, at: number): number {
  return view(bin, at, 1).getUint8(0)
}

/** Копия куска. Прибор не отдаёт окон: подмена входа не должна менять прочитанное. */
function slice(bin: Uint8Array, at: number, size: number, field: string): Uint8Array {
  if (at + size > bin.length) {
    throw new UnitMismatch(`поле ${field} (${size} Б с ${at}) не помещается в юнит ${bin.length} Б`, `байт ${at}`)
  }
  const out = new Uint8Array(size)
  for (let i = 0; i < size; i++) out[i] = readU8(bin, at + i)
  return out
}

/**
 * СТРОЖЕ боевого: байты, не занятые ни одним полем, обязаны быть нулями.
 *
 * Иначе у одного логического юнита появляется семейство байтовых представлений,
 * а формат адресуется хэшем от точных байт — и `Seal`, и дедупликация в
 * хранилище считают их разными.
 */
function blank(bin: Uint8Array, from: number, to: number, what: string): void {
  for (let at = from; at < to; at++) {
    if (readU8(bin, at) !== 0) {
      throw new UnitMismatch(`${what}: байт ${at} = 0x${readU8(bin, at).toString(16)}, ожидался ноль`, `байт ${at}`)
    }
  }
}

// ── Разбор ───────────────────────────────────────────────────────────────────

/**
 * Разбирает байты юнита по таблице офсетов §2.
 *
 * @throws {UnitMismatch} если раскладка не сходится или байты неканоничны.
 */
export function readUnit(bin: Uint8Array): RefUnit {
  if (bin.length < REF_HEAD_BYTES) {
    throw new UnitMismatch(`общая часть — ${REF_HEAD_BYTES} Б, а доступно ${bin.length}`, `юнит ${bin.length} Б`)
  }

  const code = readU8(bin, 0)
  const kind = REF_KIND[code - 1]
  if (kind === undefined) throw new UnitMismatch(`вид №${code} неизвестен`, 'байт 0')

  if (kind === 'sand') return readSand(bin)
  if (kind === 'gift') return readGift(bin)
  if (kind === 'seal') return readSeal(bin)
  return readPass(bin)
}

/** Общая часть: одна на все четыре вида, читается до всякой развилки. */
function readHead(bin: Uint8Array, kind: RefKind, length: number): RefHead {
  if (bin.length !== length) {
    throw new UnitMismatch(`${kind}: раскладка даёт ${length} Б, пришло ${bin.length}`, `юнит ${bin.length} Б`)
  }
  return {
    kind,
    length,
    meta: readU8(bin, 1),
    time: readU32(bin, 2),
    tick: readU16(bin, 6),
    peer: slice(bin, 8, REF_PEER_BYTES, 'peer'),
  }
}

function readSand(bin: Uint8Array): RefSand {
  const meta = readU8(bin, 1)
  const tag = REF_TAG[meta >> 6] as RefTag
  const inline = meta % 64
  const big = inline === REF_INLINE_BIG

  // Выносной санд обрывается сразу за 12 байтами хэша: payload у него нет.
  const length = big ? 36 + REF_SHOT_BYTES : align(48 + inline)
  const head = readHead(bin, 'sand', length)

  const self = slice(bin, 16, REF_ID_BYTES, 'self')
  const parent = slice(bin, 22, REF_ID_BYTES, 'head')
  const lead = slice(bin, 28, REF_ID_BYTES, 'lead')

  if (big) {
    const size = readU16(bin, 34)
    if (size <= REF_INLINE_MAX || size > REF_BALL_MAX) {
      throw new UnitMismatch(
        `выносное значение объявлено в ${size} Б, а выносится только ${REF_INLINE_MAX + 1}…${REF_BALL_MAX}`,
        'байт 34',
      )
    }
    return {
      ...head,
      kind: 'sand',
      tag,
      big,
      size,
      self,
      head: parent,
      lead,
      shot: slice(bin, 36, REF_SHOT_BYTES, 'shot'),
      payload: null,
      value: undefined,
    }
  }

  // СТРОЖЕ боевого: у inline-санда поля sizeBig и shot не существуют — §2
  // объявляет payload только с офсета 48, значит 34…48 обязаны быть нулями.
  blank(bin, 34, 48, 'sand: sizeBig и shot у значения внутри юнита')
  const payload = slice(bin, 48, inline, 'payload')
  // СТРОЖЕ боевого: хвост выравнивания — тоже часть хэшируемых байт.
  blank(bin, 48 + inline, length, 'sand: выравнивание после payload')

  if (inline === 0) {
    throw new UnitMismatch('значение пустое, а у vary нет нулевого представления', 'байт 1')
  }

  return {
    ...head,
    kind: 'sand',
    tag,
    big,
    size: inline,
    self,
    head: parent,
    lead,
    shot: null,
    payload,
    value: referenceDecode(payload),
  }
}

function readGift(bin: Uint8Array): RefGift {
  const head = readHead(bin, 'gift', REF_GIFT_BYTES)
  // СТРОЖЕ боевого: §2 не отводит подарку байта meta — значит он ноль.
  blank(bin, 1, 2, 'gift: meta не задействован')
  const rank = readU8(bin, 24)
  // СТРОЖЕ боевого: между rank(24) и code(32) семь байт ничьи.
  blank(bin, 25, 32, 'gift: дыра выравнивания между rank и code')
  const code = slice(bin, 32, REF_CODE_BYTES, 'code')

  let coded = false
  for (const byte of code) {
    if (byte !== 0) coded = true
  }

  return {
    ...head,
    kind: 'gift',
    mate: slice(bin, 16, REF_PEER_BYTES, 'mate'),
    rank,
    tier: rank >> 4,
    rate: rank % 16,
    code,
    coded,
  }
}

function readSeal(bin: Uint8Array): RefSeal {
  const meta = readU8(bin, 1)
  const count = meta % 16
  const wide = meta >= 128
  // СТРОЖЕ боевого: §2 отводит meta печати только count(4) и wide(1).
  if (meta % 128 >= 16) {
    throw new UnitMismatch(`seal: биты 4…6 meta не заняты ни count, ни wide, а meta = 0x${meta.toString(16)}`, 'байт 1')
  }

  const tail = 16 + count * REF_SHOT_BYTES
  const length = align(tail) + REF_SIGN_BYTES
  const head = readHead(bin, 'seal', length)

  const hashes: Uint8Array[] = []
  for (let i = 0; i < count; i++) hashes.push(slice(bin, 16 + i * REF_SHOT_BYTES, REF_SHOT_BYTES, `hashes[${i}]`))
  // СТРОЖЕ боевого: выравнивание между хэшами и подписью.
  blank(bin, tail, align(tail), 'seal: выравнивание перед sign')

  return {
    ...head,
    kind: 'seal',
    count,
    wide,
    hashes,
    sign: slice(bin, length - REF_SIGN_BYTES, REF_SIGN_BYTES, 'sign'),
  }
}

function readPass(bin: Uint8Array): RefPass {
  const meta = readU8(bin, 1)
  const algo = REF_ALGO[meta]
  const size = REF_ALGO_KEY[meta]
  if (algo === undefined || size === undefined) {
    throw new UnitMismatch(`pass: алгоритм №${meta} неизвестен`, 'байт 1')
  }

  const length = align(16 + size)
  const head = readHead(bin, 'pass', length)
  const key = slice(bin, 16, size, 'key')
  // СТРОЖЕ боевого: хвост выравнивания за ключом.
  blank(bin, 16 + size, length, 'pass: выравнивание после key')

  return { ...head, kind: 'pass', algo, key }
}

// ── Порядок ──────────────────────────────────────────────────────────────────

/**
 * Порядок LWW по ПОЛЯМ, а не по байтам: `time ↓, peer ↑, tick ↓`
 * ([docs/04 §3](../../../../docs/04-crdt-core.md#3-lww), та же формулировка в §2
 * `docs/03`). Отрицательное — `a` свежее.
 *
 * Это независимый оракул порядка: он не знает ни офсетов, ни того, что поля
 * лежат рядом. Всё, что нужно, уже вынуто {@link readUnit}.
 */
export function refCompare(a: RefUnit, b: RefUnit): number {
  if (a.time !== b.time) return a.time > b.time ? -1 : +1

  for (let i = 0; i < REF_PEER_BYTES; i++) {
    const left = a.peer[i] as number
    const right = b.peer[i] as number
    if (left !== right) return left < right ? -1 : +1
  }

  if (a.tick !== b.tick) return a.tick > b.tick ? -1 : +1
  return 0
}

/**
 * Обещание §2 буквально: «поля лежат в этом порядке и в big-endian, поэтому
 * сравнение сводится к `memcmp` 14 байт без разбора структуры».
 *
 * Реализовано ровно так, как обещано: побайтовое сравнение диапазона
 * `time(2..6) tick(6..8) peer(8..16)` без всякого знания о полях. Если обещание
 * верно, эта функция обязана совпадать с {@link refCompare} по знаку.
 */
export function memcmpCompare(a: Uint8Array, b: Uint8Array): number {
  for (let at = 2; at < REF_HEAD_BYTES; at++) {
    const left = a[at] as number
    const right = b[at] as number
    if (left !== right) return left < right ? -1 : +1
  }
  return 0
}

/** Текст для отчёта о расхождении: 16 байт общей части в hex. */
export function refStamp(bin: Uint8Array): string {
  return hex(bin.subarray(0, REF_HEAD_BYTES))
}

/** Шестнадцатеричный вид куска — им сверяются поля и печатаются контрпримеры. */
export function refHex(bin: Uint8Array): string {
  return hex(bin)
}
