// v8:hot — `packDecode` числится горячим в PRINCIPLES.md (раздел `@sync/core/binary`):
// через него проходит каждый принятый по сети пакет и каждая загрузка ленда с
// диска. Правила горячего пути действуют на весь файл: константы в модульной
// области, массивы плотные, `try/catch` — на границе функции, а не внутри цикла.
//
// ─── Раскладка (docs/03 §3) ──────────────────────────────────────────────────
//
//   ┌ Land-заголовок ── 24 Б ──────────────────────────┐
//   │ off  len  поле                                   │
//   │ 0     4   "LAND"     метка секции                │
//   │ 4    16   landId     peer(8) + area(8)           │
//   │ 20    2   faceCount  BE                          │
//   │ 22    2   pad        зарезервировано, нули       │
//   ├ Faces ── 24 Б × faceCount ───────────────────────┤
//   │ 0     8   peer                                   │
//   │ 8     2   tick  BE                               │
//   │ 10    4   time  BE                               │
//   │ 14    4   summ  BE                               │
//   │ 18    6   pad        зарезервировано, нули       │
//   ├ Units ───────────────────────────────────────────┤
//   │ unit … [ball …] × M                              │
//   └──────────────────────────────────────────────────┘
//     дальше может идти следующий Land-заголовок
//
// `time` и `summ` лежат по офсетам 10 и 14 — не кратным четырём. Это не опечатка
// диаграммы спецификации, а её буквальное прочтение; чтение всё равно ручное,
// побайтовое (см. «Почему не DataView» в `unit.ts`), поэтому выравнивание внутри
// фейса ни на что не влияет, а менять раскладку — ломать формат (ADR-005).
//
// ─── Почему один формат на провод и на диск ──────────────────────────────────
//
// Все секции кратны 8 байтам: заголовок 24, фейс 24, длина любого юнита кратна 8
// по построению (`unit.ts`), ball добивается нулями до кратности. Благодаря
// этому файл хранилища — валидный `Pack` и одновременно арена аллокатора
// (docs/06 §4): удалённый юнит зануляется, слот с `kind = 0` парсер пропускает,
// а `opts.pool` получает его границы. То есть загрузка файла восстанавливает и
// данные, и состояние аллокатора — отдельный индекс свободных мест не нужен.
//
// Наполнение пакета — это его смысл (docs/03 §3):
//
//   Faces   Units   Смысл
//   ✓       ✗       «вот моё состояние» — начало синхронизации
//   ✗       ✓       дельта
//   ✓       ✓       дельта + подтверждение состояния
//   ✗       ✗       «забудь этот ленд» — отписка
//
// Последняя строка — причина, по которой пустой `PackPart` НЕ отбрасывается при
// кодировании: 24 байта заголовка без фейсов и юнитов это не «ничего», а
// сообщение. В baza `make` на такой вход падал (`Empty Pack`) — там отписка
// проходила другим путём.
//
// ─── Расхождения с оригиналом (baza/pack/pack.ts) ────────────────────────────
//
// 1. `ball` обязателен. В baza `length()` считает размер по `sand.ball()`, а
//    `make()` пишет по `sand.size()`. Если у большого санда `ball` не загружен,
//    первый даёт 0, второй — `align8(size)`: буфер выделяется короче, чем в него
//    пишут, и `set` молча обрезает хвост, а следующий за санд юнит уезжает на
//    место балла. У нас большой санд без балла — ошибка кодирования: в формате
//    нет маркера «балл не приложен», после большого санда парсер ОБЯЗАН прочесть
//    `align8(size)` байт. Отдавать юнит без значения формат пока не умеет — см.
//    отчёт, это пробел спецификации, а не решение кодека.
// 2. `offsets` ключуется юнитом, а не `ArrayBuffer`. Спецификация просит
//    `WeakMap<ArrayBufferLike, number>`, но у нас юнит — окно в буфер пачки, а не
//    копия, и `ArrayBuffer` у всех юнитов пачки ОДИН. Ключ-буфер означал бы либо
//    одну запись на всю пачку (мусор), либо копию каждого юнита (ровно то, от
//    чего бинарный формат уходит). Хранилищу нужно «где лежит этот юнит» —
//    юнит и есть естественный ключ.
// 3. Пустой пакет (ноль лендов) разрешён и даёт ноль байт. baza бросала
//    `Empty Pack`; политика «что осмысленно отправлять» — дело транспорта, а не
//    кодека, и запрет ломал бы тождество `encode(decode(b)) ≡ b` на пустом входе.
//
// ─── Каноничность ────────────────────────────────────────────────────────────
//
// `packEncode(packDecode(b)) ≡ b` побайтово выполняется на КАНОНИЧЕСКОМ пакете:
// один заголовок на ленд, ни одного свободного слота, зарезервированные байты
// нулевые. Иначе тождество и не может выполняться: свободные слоты кодировщик не
// восстанавливает (он не знает, где в арене были дыры), а повторные заголовки
// одного ленда сливаются в одну часть — без слияния арена, куда юниты ленда
// дописывались после чужого заголовка, разбиралась бы на пачку огрызков.
// Нормализация идемпотентна: `encode(decode(x))` уже канонична, и повторный
// прогон её не меняет. Зарезервированные байты проверяются на ноль как раз
// поэтому: молча принять в них мусор значило бы потерять его при первом же
// пересохранении.

import { align8, readU16, readU32, writeU16, writeU32 } from './bytes'
import { Link } from './link'
import {
  type AnyUnit,
  SAND_AT,
  SandUnit,
  UNIT_AT,
  UNIT_BYTES,
  UnitError,
  parseUnit,
  shotKey,
  unitLengthAt,
} from './unit'

/**
 * Отказ кодека пачки: обрыв посреди секции, чужая метка, юнит до заголовка
 * ленда, не приложенный `ball`. Исключительное, а не значение (PRINCIPLES.md,
 * раздел «Ошибки»).
 *
 * `at` — место: `офсет 128`, `ленд AQIDBAUGBwg, фейс #3`. Ошибка разбора юнита
 * приходит в `cause` целиком: `UnitError` знает вид и длину, `PackError` —
 * ленд и офсет, вместе они дают полную координату.
 */
export class PackError extends Error {
  readonly reason: string
  readonly at: string

  constructor(reason: string, at: string, cause?: unknown) {
    super(at === '' ? reason : `${reason} — ${at}`, cause === undefined ? undefined : { cause })
    this.name = 'PackError'
    this.reason = reason
    this.at = at
  }
}

// ── Константы формата ────────────────────────────────────────────────────────

/** Метка секции ленда: `LAND`. Первый байт — он же признак вида слота. */
const MAGIC_L = 0x4c
const MAGIC_A = 0x41
const MAGIC_N = 0x4e
const MAGIC_D = 0x44

/**
 * Код свободного слота (docs/03 §3). Ноль не может оказаться видом юнита:
 * `unit.ts` раздал видам 1…4, а нулевой байт по построению принадлежит
 * зачищенному слоту арены.
 */
const KIND_FREE = 0

/** Санд — единственный вид, за которым может лежать `ball` (docs/03 §2). */
const KIND_SAND = 1
/** `inlineSize == 63` — маркер выноса значения в `ball`. */
const INLINE_BIG = 63

const ALIGN = 8
const HEAD_BYTES = 24
const FACE_BYTES = 24
const LAND_BYTES = 16
const PEER_BYTES = UNIT_BYTES.peer

const FACES_MAX = 0xffff
const TIME_MAX = 0xffffffff
const TICK_MAX = 0xffff
const SUMM_MAX = 0xffffffff

/** Офсеты заголовка ленда. Экспортируются: тест раскладки обязан читать те же числа, что и код. */
export const PACK_AT = {
  magic: 0,
  land: 4,
  faces: 20,
  pad: 22,
  /** Конец заголовка — начало секции фейсов. */
  body: 24,
} as const

/** Офсеты одного фейса, от начала записи. */
export const FACE_AT = {
  peer: 0,
  tick: 8,
  time: 10,
  summ: 14,
  pad: 18,
} as const

/** Размеры секций — для тестов, бенчей и арены хранилища. */
export const PACK_BYTES = {
  head: HEAD_BYTES,
  face: FACE_BYTES,
  magic: 4,
  land: LAND_BYTES,
  align: ALIGN,
} as const

/** Метка `LAND` байтами — тест обязан сверять её с кодом, а не с самим собой. */
export const PACK_MAGIC: readonly number[] = [MAGIC_L, MAGIC_A, MAGIC_N, MAGIC_D]

const HEX: string[] = []
for (let i = 0; i < 256; i++) HEX.push(i.toString(16).padStart(2, '0'))

// ── Работа с байтами ─────────────────────────────────────────────────────────
//
// Обещание из прошлой редакции этой шапки выполнено: те же четыре функции лежали
// копией здесь и копией в `unit.ts`, а «появится третий кодек — выделим». Третий
// читатель появился (слой ленда читает те же офсеты прямо в арене), и чтение с
// записью big-endian переехали в `bytes.ts`.

/** Шестнадцатеричный кусок буфера — для сообщений об ошибке. */
function dump(bin: Uint8Array, at: number, size: number): string {
  let out = ''
  const end = Math.min(at + size, bin.length)
  for (let i = at; i < end; i++) out += HEX[bin[i] as number]
  return out
}

/** Нулевые ли зарезервированные байты. См. раздел «Каноничность» в шапке. */
function zeroes(bin: Uint8Array, at: number, size: number): boolean {
  for (let i = at; i < at + size; i++) {
    if (bin[i] !== 0) return false
  }
  return true
}

// ── Части пакета ─────────────────────────────────────────────────────────────

/**
 * Идентификатор ленда: `peer(8) + area(8)`, ровно 16 байт (docs/03 §1).
 *
 * Отдельного branded-типа пока нет: `Link` уже номинален, а канонизация внутри
 * него гарантирует, что домашний ленд лорда и сам лорд — одно значение.
 */
export type LandId = Link

/**
 * Векторные часы одного пира внутри ленда (docs/08 §1).
 *
 * `time`/`tick` — «докуда я видел этого пира», `summ` — «сколько его юнитов у
 * меня есть». Второе ловит выборочную потерю юнита в середине истории, чего
 * классические векторные часы не умеют.
 */
export interface PackFace {
  /** Чьи часы. Лорд (8 Б) либо {@link Link.hole}. */
  readonly peer: Link
  /** Секунды эпохи. */
  readonly time: number
  /** Шаг внутри секунды. */
  readonly tick: number
  /** Сколько юнитов этого пира есть у отправителя. */
  readonly summ: number
}

/**
 * Содержимое одного ленда в пакете.
 *
 * Все три поля обязательны и заполняются {@link packPart}: один шейп на все
 * части (PRINCIPLES.md, правило 2 горячего пути), а «нет фейсов» и «нет юнитов»
 * — не отсутствие поля, а пустой список, у которого есть смысл (таблица в шапке).
 *
 * ПОЧЕМУ `faces` — список, а не карта по пиру: у кодека нет своего мнения о
 * векторных часах. `FaceMap` со слиянием и монотонностью приедет в S7 (docs/08),
 * и она будет строиться ИЗ этого списка. Список к тому же сохраняет порядок
 * записей, без чего побайтовое тождество кодирования недостижимо.
 *
 * ПОЧЕМУ `balls` отдельно, а не полем юнита: юнит иммутабелен и является окном в
 * чужой буфер — дописать ему `_ball`, как делает baza, нельзя. Ключ — {@link shotKey}
 * от `shot` санда, то есть тот же ключ, которым `ball` лежит в хранилище (docs/06 §3).
 */
export interface PackPart {
  readonly faces: readonly PackFace[]
  readonly units: readonly AnyUnit[]
  /** `shotKey(sand.shot())` → байты выносного значения. */
  readonly balls: ReadonlyMap<string, Uint8Array>
}

/** Пакет как список: один элемент на ленд, порядок кодирования — порядок списка. */
export type PackParts = Array<[LandId, PackPart]>

const NO_FACES: readonly PackFace[] = []
const NO_UNITS: readonly AnyUnit[] = []
const NO_BALLS: ReadonlyMap<string, Uint8Array> = new Map()

/**
 * Часть пакета с заполненными умолчаниями.
 *
 * @example
 * ```ts
 * packEncode([[land, packPart({ units })]])                 // дельта
 * packEncode([[land, packPart({ faces })]])                 // «вот моё состояние»
 * packEncode([[land, packPart()]])                          // «забудь этот ленд»
 * ```
 */
export function packPart(fields: Partial<PackPart> = {}): PackPart {
  return {
    faces: fields.faces ?? NO_FACES,
    units: fields.units ?? NO_UNITS,
    balls: fields.balls ?? NO_BALLS,
  }
}

/**
 * Аллокатор арены хранилища (docs/06 §4). Полный интерфейс приедет вместе с
 * хранилищем; пачке от него нужно ровно одно — принять границы свободного места.
 */
export interface PackPool {
  /**
   * Пометить `[at, at + size)` свободным. `size` кратен 8.
   *
   * Парсер отдаёт свободные слоты ПРОГОНАМИ: подряд идущие зачищенные восьмёрки
   * склеиваются в один вызов. Реализация всё равно обязана склеивать соседей
   * (иначе после удаления санда на 56 байт в пуле останутся семь восьмёрок, и
   * следующий санд в них не поместится), так что склейка на входе — не другая
   * семантика, а сэкономленные вызовы.
   */
  release(at: number, size: number): void
}

/** Дополнительные выходы разбора — то, ради чего формат один на провод и на диск. */
export interface PackOpts {
  /**
   * Куда записать офсет каждого юнита внутри буфера.
   *
   * Ключ — сам юнит, а не его `ArrayBuffer` (см. расхождение №2 в шапке).
   */
  readonly offsets?: WeakMap<AnyUnit, number>
  /** Куда сдать найденные свободные слоты. */
  readonly pool?: PackPool
}

// ── Кодирование ──────────────────────────────────────────────────────────────

function checkLand(land: LandId): void {
  if (land.bin.length > LAND_BYTES) {
    throw new PackError(
      `land is ${LAND_BYTES} B, but the link is ${land.bin.length} B ("${land.str}"): convert the pawn to a land via land()`,
      'land header',
    )
  }
}

function checkFace(face: PackFace, land: LandId, index: number): void {
  const at = `land ${land.str}, face #${index}`

  if (face.peer.bin.length > PEER_BYTES) {
    throw new PackError(`peer is ${PEER_BYTES} B, but the link is ${face.peer.bin.length} B ("${face.peer.str}")`, at)
  }
  if (!Number.isInteger(face.time) || face.time < 0 || face.time > TIME_MAX) {
    throw new PackError(`time = ${face.time}: expected an integer 0…${TIME_MAX}`, at)
  }
  if (!Number.isInteger(face.tick) || face.tick < 0 || face.tick > TICK_MAX) {
    throw new PackError(`tick = ${face.tick}: expected an integer 0…${TICK_MAX}`, at)
  }
  if (!Number.isInteger(face.summ) || face.summ < 0 || face.summ > SUMM_MAX) {
    throw new PackError(`summ = ${face.summ}: expected an integer 0…${SUMM_MAX}`, at)
  }
}

/**
 * Байты выносного значения санда.
 *
 * @throws {PackError} если `ball` не приложен или его длина расходится с
 * объявленной в юните: в формате нет маркера «балла нет», и парсер на той
 * стороне прочтёт ровно `align8(size)` байт независимо от наших намерений.
 */
function ballOf(sand: SandUnit, part: PackPart, land: LandId, index: number): Uint8Array {
  const key = shotKey(sand.shot())
  const ball = part.balls.get(key)
  const at = `land ${land.str}, unit #${index}`

  if (ball === undefined) {
    throw new PackError(
      `sand carries external value ${key} (${sand.size()} B), but no ball is attached — the format cannot reference a ball outside the pack`,
      at,
    )
  }
  if (ball.length !== sand.size()) {
    throw new PackError(`ball ${key}: the unit declared ${sand.size()} B, ${ball.length} attached`, at)
  }

  return ball
}

/**
 * Проход измерения: считает длину, проверяет части и складывает найденные баллы
 * в `found` по порядку записи.
 *
 * ПОЧЕМУ баллы копятся, а не ищутся повторно на проходе записи: ключ балла —
 * {@link shotKey}, то есть строка в 24 символа, которую надо построить, плюс
 * поиск по карте. Два прохода по одному санду делали это дважды: на наборе, где
 * каждый десятый санд большой, кодирование 10 000 юнитов стоило 1.01 мс против
 * 0.21 мс на наборе без баллов. С накоплением — 0.64 мс (замер `bench/pack.mjs`,
 * раздел «фейсы и ball»); остаток разницы — копирование самих 200 КБ значений.
 */
function plan(parts: readonly (readonly [LandId, PackPart])[], found: Uint8Array[]): number {
  let size = 0

  for (const [land, part] of parts) {
    checkLand(land)

    if (part.faces.length > FACES_MAX) {
      throw new PackError(
        `${part.faces.length} faces, but the two header bytes fit ${FACES_MAX}`,
        `land ${land.str}`,
      )
    }
    for (let i = 0; i < part.faces.length; i++) checkFace(part.faces[i] as PackFace, land, i)

    size += HEAD_BYTES + part.faces.length * FACE_BYTES

    let index = 0
    for (const unit of part.units) {
      size += unit.bin.length
      if (unit instanceof SandUnit && unit.big()) {
        const ball = ballOf(unit, part, land, index)
        found.push(ball)
        size += align8(ball.length)
      }
      index += 1
    }
  }

  return size
}

/**
 * Сколько байт займёт пакет. Заодно проверяет части: {@link packEncode} обязан
 * узнать о негодном входе до того, как выделит буфер, а не посреди записи в него.
 *
 * @throws {PackError} на негодном ленде, фейсе или не приложенном `ball`.
 */
export function packLength(parts: readonly (readonly [LandId, PackPart])[]): number {
  return plan(parts, [])
}

/**
 * Собирает пакет из частей. Порядок лендов, фейсов и юнитов сохраняется как есть
 * — байты пакета определяются входом однозначно.
 *
 * @throws {PackError} на ссылке не уровня ленда, переполнении счётчика фейсов,
 * значении фейса вне диапазона и не приложенном `ball`.
 *
 * @example
 * ```ts
 * const bytes = packEncode([[land, packPart({ units: [sand] })]])
 * const [[same, part]] = packDecode(bytes)
 * ```
 */
/**
 * Заголовок ленда без фейсов — 24 байта — прямо в чужой буфер.
 *
 * Нужен тем, кто собирает пачку КОПИЕЙ БАЙТ, минуя {@link packEncode}: ленд
 * отдаёт несохранённое одним `set` на юнит из арены, а хранилище пересобирает
 * образ. Метка секции обязана жить в одном месте — иначе третья копия
 * `"LAND"` разъедется с форматом молча.
 *
 * @throws {PackError} если ссылка не уровня ленда.
 */
export function packHead(bin: Uint8Array, at: number, land: LandId): void {
  checkLand(land)
  bin[at + PACK_AT.magic] = MAGIC_L
  bin[at + PACK_AT.magic + 1] = MAGIC_A
  bin[at + PACK_AT.magic + 2] = MAGIC_N
  bin[at + PACK_AT.magic + 3] = MAGIC_D
  bin.set(land.bin, at + PACK_AT.land)
  writeU16(bin, at + PACK_AT.faces, 0)
}

export function packEncode(parts: Iterable<readonly [LandId, PackPart]>): Uint8Array {
  // Вход — Iterable, а пройти его надо дважды: сначала посчитать длину, потом
  // заполнить. Генератор второго прохода не переживёт.
  const list = [...parts]
  const found: Uint8Array[] = []
  const bin = new Uint8Array(plan(list, found))

  let at = 0
  let ballAt = 0

  for (const [land, part] of list) {
    bin[at + PACK_AT.magic] = MAGIC_L
    bin[at + PACK_AT.magic + 1] = MAGIC_A
    bin[at + PACK_AT.magic + 2] = MAGIC_N
    bin[at + PACK_AT.magic + 3] = MAGIC_D
    bin.set(land.bin, at + PACK_AT.land)
    writeU16(bin, at + PACK_AT.faces, part.faces.length)
    at += HEAD_BYTES

    for (const face of part.faces) {
      bin.set(face.peer.bin, at + FACE_AT.peer)
      writeU16(bin, at + FACE_AT.tick, face.tick)
      writeU32(bin, at + FACE_AT.time, face.time)
      writeU32(bin, at + FACE_AT.summ, face.summ)
      at += FACE_BYTES
    }

    for (const unit of part.units) {
      bin.set(unit.bin, at)
      at += unit.bin.length

      if (unit instanceof SandUnit && unit.big()) {
        // Балл уже найден и проверен на проходе измерения, порядок тот же.
        const ball = found[ballAt] as Uint8Array
        ballAt += 1
        bin.set(ball, at)
        // Хвост до кратности 8 остаётся нулевым — буфер выделен нулями.
        at += align8(ball.length)
      }
    }
  }

  return bin
}

// ── Разбор ───────────────────────────────────────────────────────────────────

/** Что нашёл {@link PackCursor} на очередном шаге. */
export const PACK_STEP = {
  /** Пакет кончился. */
  end: 0,
  /** Заголовок ленда: дальше идут его фейсы и юниты. */
  land: 1,
  /** Юнит; у большого санда сразу за ним лежит его `ball`. */
  unit: 2,
  /** Прогон свободных слотов арены (`kind = 0`). */
  free: 3,
} as const

/**
 * Ленивый разбор: проверяет раскладку и отдаёт ГРАНИЦЫ, не создавая ни одного
 * объекта на юнит.
 *
 * ПОЧЕМУ ОН ПОЯВИЛСЯ. Долг стадии S2, записанный в docs/11: `packDecode` заводил
 * `SandUnit` на КАЖДЫЙ юнит — 192 Б сверх 56 байт самого юнита, то есть 19 МБ
 * объектов на 100 000 юнитов поверх 5.6 МБ байтов. При этом оба главных
 * потребителя вид ВЫБРАСЫВАЮТ: `Land.adopt` забирает офсет, а хранилище копирует
 * байты в свой образ. Курсор даёт им ровно то, что нужно, и ничего сверх.
 *
 * Поля мутируются на каждом шаге — один объект на весь разбор (правило 8
 * горячего пути). Мутировать здесь можно потому, что шаг живёт ровно до
 * следующего вызова {@link PackCursor.next}, и это записано в контракте.
 *
 * @example
 * ```ts
 * const cursor = new PackCursor(file)
 * for (let step = cursor.next(); step !== PACK_STEP.end; step = cursor.next()) {
 *   if (step === PACK_STEP.unit) store(cursor.at, cursor.span)
 * }
 * ```
 */
export class PackCursor {
  readonly bin: Uint8Array
  /** Начало текущего шага. */
  at: number
  /** Байты шага: у юнита — он сам, у заголовка — 24 Б, у прогона — весь прогон. */
  size: number
  /** Байты шага ВМЕСТЕ с приложенным `ball`. Совпадает с `size`, если балла нет. */
  span: number
  /** Вид юнита на шаге {@link PACK_STEP.unit}. */
  kind: number
  /** Сколько фейсов объявил заголовок на шаге {@link PACK_STEP.land}. */
  faces: number
  /** Ленд текущей части. До первого заголовка — {@link Link.hole}. */
  land: LandId

  #next: number
  #seen: boolean

  constructor(bin: Uint8Array) {
    // Все секции кратны 8, значит и весь пакет кратен. Проверка одна на разбор и
    // ловит обрезанный хвост раньше, чем он притворится слотом.
    if (bin.length % ALIGN !== 0) {
      throw new PackError(`pack length ${bin.length} B is not a multiple of ${ALIGN} — the pack is truncated`, '')
    }
    this.bin = bin
    this.at = 0
    this.size = 0
    this.span = 0
    this.kind = 0
    this.faces = 0
    this.land = Link.hole
    this.#next = 0
    this.#seen = false
  }

  /** Шагнуть. Возвращает код шага из {@link PACK_STEP}. */
  next(): number {
    const bin = this.bin
    const end = bin.length
    let at = this.#next
    if (at >= end) return PACK_STEP.end

    const kind = bin[at] as number

    // ── Свободный слот ────────────────────────────────────────────────────────
    // Проверяется только байт вида: остальные семь — дело того, кто зачищал
    // слот, а не парсера. Хранилище пишет нули целиком (docs/06 §4), но
    // реализация, зачищающая один байт заголовка, тоже остаётся читаемой.
    if (kind === KIND_FREE) {
      const from = at
      do {
        at += ALIGN
      } while (at < end && bin[at] === KIND_FREE)
      this.at = from
      this.size = at - from
      this.span = this.size
      this.kind = KIND_FREE
      this.#next = at
      return PACK_STEP.free
    }

    if (kind === MAGIC_L) {
      this.#head(at, end)
      return PACK_STEP.land
    }

    if (!this.#seen) {
      throw new PackError(`unit of kind #${kind} before the first land header — no way to tell whose it is`, `offset ${at}`)
    }

    // ── Юнит ──────────────────────────────────────────────────────────────────
    // `unitLengthAt` знает вид и длину, но не знает, где в пакете он лежит:
    // координату дописываем здесь, а исходный отказ уходит в `cause`.
    let size: number
    try {
      size = unitLengthAt(bin, at)
    } catch (cause) {
      if (cause instanceof UnitError) {
        throw new PackError(cause.message, `land ${this.land.str}, offset ${at}`, cause)
      }
      throw cause
    }

    if (at + size > end) {
      throw new PackError(`the unit declared ${size} B, but only ${end - at} left in the pack`, `land ${this.land.str}, offset ${at}`)
    }

    this.at = at
    this.size = size
    this.kind = kind
    this.span = size

    // Выносное значение лежит сразу за санд ом, добитое нулями до кратности 8.
    if (kind === KIND_SAND && ((bin[at + UNIT_AT.meta] as number) & 0b111111) === INLINE_BIG) {
      const ballAt = at + size
      const ballSize = readU16(bin, at + SAND_AT.size)
      const step = align8(ballSize)
      if (ballAt + step > end) {
        throw new PackError(
          `the sand declared an external value of ${ballSize} B, but only ${end - ballAt} left in the pack`,
          `land ${this.land.str}, offset ${ballAt}`,
        )
      }
      if (!zeroes(bin, ballAt + ballSize, step - ballSize)) {
        throw new PackError(
          `ball padding to a multiple of ${ALIGN} must be zero, got ${dump(bin, ballAt + ballSize, step - ballSize)}`,
          `land ${this.land.str}, offset ${ballAt}`,
        )
      }
      this.span = size + step
    }

    this.#next = at + this.span
    return PACK_STEP.unit
  }

  /** Заголовок ленда: метка, зарезервированные байты, счётчик фейсов. */
  #head(at: number, end: number): void {
    const bin = this.bin

    if (at + HEAD_BYTES > end) {
      throw new PackError(`land header is ${HEAD_BYTES} B, but only ${end - at} left in the pack`, `offset ${at}`)
    }
    if (bin[at + 1] !== MAGIC_A || bin[at + 2] !== MAGIC_N || bin[at + 3] !== MAGIC_D) {
      throw new PackError(`expected the "LAND" marker, got ${dump(bin, at, 4)}`, `offset ${at}`)
    }
    if (!zeroes(bin, at + PACK_AT.pad, PACK_AT.body - PACK_AT.pad)) {
      throw new PackError(
        `header padding (bytes ${PACK_AT.pad}…${PACK_AT.body}) is reserved and must be zero, got ${dump(bin, at + PACK_AT.pad, 2)}`,
        `offset ${at}`,
      )
    }

    const id = Link.from(bin.subarray(at + PACK_AT.land, at + PACK_AT.land + LAND_BYTES))
    const count = readU16(bin, at + PACK_AT.faces)

    if (at + HEAD_BYTES + count * FACE_BYTES > end) {
      throw new PackError(
        `${count} faces declared (${count * FACE_BYTES} B), but only ${end - at - HEAD_BYTES} left in the pack`,
        `land ${id.str}, offset ${at}`,
      )
    }

    for (let i = 0; i < count; i++) {
      const face = at + HEAD_BYTES + i * FACE_BYTES
      if (!zeroes(bin, face + FACE_AT.pad, FACE_BYTES - FACE_AT.pad)) {
        throw new PackError(
          `face padding (bytes ${FACE_AT.pad}…${FACE_BYTES}) is reserved and must be zero, got ${dump(bin, face + FACE_AT.pad, 6)}`,
          `land ${id.str}, face #${i}, offset ${face}`,
        )
      }
    }

    this.at = at
    this.size = HEAD_BYTES
    this.span = HEAD_BYTES + count * FACE_BYTES
    this.kind = MAGIC_L
    this.faces = count
    this.land = id
    this.#seen = true
    this.#next = at + this.span
  }
}

/** Внутренний вид части: те же поля, но массивы растут. Один шейп с {@link PackPart}. */
interface PackDraft {
  faces: PackFace[]
  units: AnyUnit[]
  balls: Map<string, Uint8Array>
}

/**
 * Разбирает пакет.
 *
 * Юниты и баллы — **окна** в переданный буфер, а не копии: в этом весь смысл
 * бинарного формата (docs/03 §2), и на этом же держится арена (docs/06 §4).
 * Значит буфер после разбора править нельзя — юнит объявлен иммутабельным.
 *
 * Свободные слоты (`kind = 0`) пропускаются и, если передан `opts.pool`,
 * сдаются аллокатору прогонами. Повторные заголовки одного ленда сливаются в
 * одну часть — см. раздел «Каноничность» в шапке файла.
 *
 * @throws {PackError} на обрыве секции, чужой метке, юните до заголовка ленда,
 * ненулевых зарезервированных байтах и нераспознанном юните (тот приходит в
 * `cause` как `UnitError`).
 *
 * @example
 * ```ts
 * const offsets = new WeakMap<AnyUnit, number>()
 * const parts = packDecode(file, { offsets, pool })   // + состояние аллокатора
 * ```
 */
export function packDecode(bin: Uint8Array, opts?: PackOpts): PackParts {
  const offsets = opts?.offsets
  const pool = opts?.pool

  const out: PackParts = []
  /** Ленд → его место в `out`: повторный заголовок дописывает существующую часть. */
  const index = new Map<string, number>()
  const cursor = new PackCursor(bin)

  let draft: PackDraft = { faces: [], units: [], balls: new Map() }

  for (let step = cursor.next(); step !== PACK_STEP.end; step = cursor.next()) {
    if (step === PACK_STEP.free) {
      pool?.release(cursor.at, cursor.size)
      continue
    }

    if (step === PACK_STEP.land) {
      const id = cursor.land
      const place = index.get(id.str)
      if (place === undefined) {
        draft = { faces: [], units: [], balls: new Map() }
        index.set(id.str, out.length)
        out.push([id, draft])
      } else {
        draft = (out[place] as [LandId, PackDraft])[1]
      }

      let at = cursor.at + HEAD_BYTES
      for (let i = 0; i < cursor.faces; i++) {
        draft.faces.push({
          peer: Link.peer(bin.subarray(at + FACE_AT.peer, at + FACE_AT.peer + PEER_BYTES)),
          tick: readU16(bin, at + FACE_AT.tick),
          time: readU32(bin, at + FACE_AT.time),
          summ: readU32(bin, at + FACE_AT.summ),
        })
        at += FACE_BYTES
      }
      continue
    }

    const at = cursor.at
    const size = cursor.size
    const unit = parseUnit(bin.subarray(at, at + size))
    draft.units.push(unit)
    offsets?.set(unit, at)

    if (cursor.span > size) {
      // Сверять `shot` с содержимым здесь нельзя: SHA-256 у платформы
      // асинхронный. Это делает слой приёма (docs/04 §8), у него же карантин.
      const sand = unit as SandUnit
      draft.balls.set(shotKey(sand.shot()), bin.subarray(at + size, at + size + sand.size()))
    }
  }

  return out
}
