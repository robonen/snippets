// v8:hot — `varyEncode`/`varyDecode` числятся горячими в PRINCIPLES.md
// (раздел `@sync/core/binary`). Правила горячего пути действуют на весь файл:
// поля объектов задаются в конструкторе, массивы плотные, константы и таблицы
// живут в модульной области, `try/catch` стоит только на границе функции.
//
// ─── Раскладка байтов ────────────────────────────────────────────────────────
//
// Значение — это один байт тега, за ним (по надобности) varint-аргумент и
// нагрузка. Старшие 3 бита тега — мажорный тип, младшие 5 — короткий аргумент.
//
//   tag = major << 5 | short
//   short ≤ 30          → arg = short                       (аргумент в теге)
//   short = 31          → arg = 31 + LEB128 следом           (расширение)
//
// Смещение на 31 в расширенной форме не украшение, а требование каноничности
// №1: без него у чисел 0…30 было бы по два представления. Со смещением каждое
// значение аргумента имеет ровно одну запись.
//
// | major | имя  | аргумент          | нагрузка                                |
// |-------|------|-------------------|-----------------------------------------|
// | 0     | SPEC | это не аргумент, а код: 0 null · 1 false · 2 true · 3 float64 |
// | 1     | UINT | само значение     | —                                       |
// | 2     | NINT | -1 - значение     | —                                       |
// | 3     | BLOB | длина в байтах    | сами байты                              |
// | 4     | TEXT | длина в байтах    | UTF-8                                   |
// | 5     | LIST | число элементов   | элементы подряд                         |
// | 6     | DICT | число пар         | пары «ключ TEXT, значение» подряд       |
// | 7     | EXTRA| номер расширения  | зависит от расширения                   |
//
// Расширения (major 7):
//
// | № | что        | нагрузка                                                  |
// |---|------------|-----------------------------------------------------------|
// | 0 | Date ≥ 0   | LEB128 миллисекунд эпохи                                  |
// | 1 | Date < 0   | LEB128 миллисекунд эпохи без знака                        |
// | 2 | bigint ≥ 0 | LEB128 длины, затем модуль big-endian без ведущих нулей    |
// | 3 | bigint < 0 | то же, модуль без знака                                   |
// | 4 | Link       | ЗАРЕЗЕРВИРОВАНО                                           |
// | 5 | Duration   | ЗАРЕЗЕРВИРОВАНО                                           |
// | 6 | Interval   | ЗАРЕЗЕРВИРОВАНО                                           |
// | 7 | Tree       | ЗАРЕЗЕРВИРОВАНО                                           |
//
// Знак вынесен в номер расширения, а не в зигзаг, из-за арифметики: диапазон
// `Date` — ±8.64e15 мс, и зигзаг `-ms * 2 - 1` для дальних дат до нашей эры
// выходит за 2⁵³, где нечётные целые в double уже не представимы. Округление
// съело бы младший бит — то есть знак — и дата 1 мс до эпохи вернулась бы как
// 1 мс после неё. Разделение по номеру держит аргумент в пределах точного.
//
// ### Куда встанет Link
//
// Место под ссылки уже занято: расширение №4. Нагрузка — LEB128 длины `bin`
// (8 · 16 · 22 по [03 §1](../../../../docs/03-binary-format.md)) и сами байты.
// Правка кодека при появлении `Link` — три точки:
//   1. `putVary`: ветка `value instanceof Link` **до** проверки прототипа;
//   2. `takeExtra`: `case EXTRA_LINK`, длина обязана быть 8, 16 или 22 — иначе
//      у одного и того же адреса нашлось бы второе представление;
//   3. `locate`: ссылка признаётся годным листом.
// Номера 0…2 при этом не двигаются: сдвиг сломал бы все golden-векторы, а
// формат — публичный контракт с первого релиза (ADR-005).
//
// ─── Каноничность (ADR-008) ──────────────────────────────────────────────────
//
// Кодек **строг в обе стороны**: он не только пишет канонично, но и отказывает
// на неканоничном входе. Иначе чужая (или наша будущая, сломанная) реализация
// прислала бы байты, которые мы бы приняли и переслали дальше с чужим хэшем —
// то есть ровно тот тихий развал сети, ради которого правила и заведены.
// Что именно проверяет разбор: минимальность varint, отсутствие ведущих нулей
// в модуле bigint, строгое возрастание ключей словаря, единственную форму NaN,
// отсутствие `-0` и целых в вещественной ветке, отсутствие хвоста после
// значения.

/**
 * Значение, которое кодек умеет уложить в байты.
 *
 * `undefined` в объединение не входит намеренно: пустое место в массиве и
 * отсутствующее поле неотличимы после разбора, а значит round-trip перестал бы
 * быть тождеством. Пустота выражается только через `null` (правило 6).
 *
 * @example
 * ```ts
 * const bytes = varyEncode({ name: 'ok', tags: [1, 2], blob: new Uint8Array([7]) })
 * varyDecode(bytes) // → то же значение
 * ```
 */
export type Vary =
  | null
  | boolean
  | number
  | bigint
  | string
  | Uint8Array
  | Date
  | readonly Vary[]
  | { readonly [key: string]: Vary }

/**
 * Отказ кодека. Ожидаемых ошибок у `Vary` нет: и неподдержанный тип на входе,
 * и битые байты на выходе — исключительные ситуации, а не значения
 * (PRINCIPLES.md, раздел «Ошибки»).
 *
 * `at` — место: путь `$.foo[2]` при кодировании, `байт 17` при разборе.
 */
export class VaryError extends Error {
  readonly reason: string
  readonly at: string

  constructor(reason: string, at: string) {
    super(at === '' ? reason : `${reason} — ${at}`)
    this.name = 'VaryError'
    this.reason = reason
    this.at = at
  }
}

// ── Константы формата ────────────────────────────────────────────────────────

const MAJOR_SPEC = 0x00
const MAJOR_UINT = 0x20
const MAJOR_NINT = 0x40
const MAJOR_BLOB = 0x60
const MAJOR_TEXT = 0x80
const MAJOR_LIST = 0xa0
const MAJOR_DICT = 0xc0
const MAJOR_EXTRA = 0xe0

const SPEC_NULL = 0x00
const SPEC_FALSE = 0x01
const SPEC_TRUE = 0x02
const SPEC_FLOAT = 0x03

const EXTRA_DATE_POS = 0
const EXTRA_DATE_NEG = 1
const EXTRA_BIG_POS = 2
const EXTRA_BIG_NEG = 3

/** Аргумент, который ещё влезает в тег. 31 — маркер расширенной формы. */
const SHORT_MAX = 30
const SHORT_WIDE = 31

/**
 * Потолок вложенности. Значение из сети — недоверенный вход, а разбор
 * рекурсивный: без потолка десяток килобайт из одних открывающих списков кладёт
 * стек ещё до того, как мы посмотрим на данные.
 */
const MAX_DEPTH = 512

/** Границы `Date`: за ними `new Date(ms)` даёт Invalid Date и round-trip рвётся. */
const TIME_LIMIT = 8.64e15

const SINK_START = 256

/** Потолок длины varint: 64 бита по 7 — десять байт. Резерв берётся по нему. */
const VARINT_MAX = 10

/** Выше этого потолка скрэтч не удерживается: одно большое значение не должно держать мегабайты. */
const SINK_KEEP = 1 << 20

/**
 * Длина строки в код-юнитах, до которой свой цикл выгоднее `encodeInto`.
 *
 * На длинной строке нативный кодировщик выигрывает в разы, но у него есть
 * постоянная составляющая (вид на буфер, вход в C++), которая на строке из
 * пяти символов и есть вся работа. Порог замерен в `bench/vary.mjs`.
 */
const TEXT_MANUAL = 32

/** Самый длинный тег: байт тега плюс восьмибайтовый varint. */
const TAG_MAX = 9

/** Длина, до которой разбор ASCII посимвольно обгоняет `TextDecoder`. */
const TEXT_ASCII = 32

const OBJECT_PROTO = Object.prototype

const TEXT_ENC = new TextEncoder()
// `fatal` обязателен: молчаливая подмена битого UTF-8 на U+FFFD — это разные
// байты у одного значения после пересборки, то есть разные хэши.
const TEXT_DEC = new TextDecoder('utf-8', { fatal: true })

/**
 * Единственный `DataView` на модуль — окно в восемь байт под перевод double.
 *
 * `DataView` в конструкторе кодера и декодера стоил заметно: разбор целого
 * укладывался в 76 нс, а кодирование того же целого — в 300, и почти вся
 * разница была на создании вида, который нужен одной ветке из десяти. Здесь
 * он создаётся один раз. Порядок байт задаётся явно (`false` — big-endian):
 * от порядка платформы формат зависеть не может.
 */
const F64_BYTES = new Uint8Array(8)
const F64_VIEW = new DataView(F64_BYTES.buffer)

interface MaybeWellFormed {
  isWellFormed?: () => boolean
}

/** Нативная проверка на одинокий суррогат (ES2024). Есть не везде — отсюда запасной ход. */
const NATIVE_WELL_FORMED = (String.prototype as MaybeWellFormed).isWellFormed

function wellFormed(text: string): boolean {
  if (NATIVE_WELL_FORMED !== undefined) return NATIVE_WELL_FORMED.call(text)
  return utf8Size(text) >= 0
}

/** Таблица «байт → две hex-цифры»: собирается один раз на модуль (правило 7). */
const HEX: string[] = []
for (let i = 0; i < 256; i++) HEX.push(i.toString(16).padStart(2, '0'))

// ── Приёмник байтов ──────────────────────────────────────────────────────────

/**
 * Растущий буфер записи. Живёт один на модуль и переиспользуется — см.
 * {@link varyEncode}.
 */
class Sink {
  buf: Uint8Array
  pos: number

  constructor() {
    // Все поля — здесь: форма объекта не меняется после создания (правило 2).
    this.buf = new Uint8Array(SINK_START)
    this.pos = 0
  }

  room(need: number): void {
    const want = this.pos + need
    if (want <= this.buf.length) return
    // Не «удваивать, пока не хватит», а сразу до нужного: буфер на 32 КиБ,
    // выращенный удвоениями от 256 Б, стоил семи аллокаций и семи копий.
    const twice = this.buf.length * 2
    const next = new Uint8Array(want > twice ? want : twice)
    next.set(this.buf.subarray(0, this.pos))
    this.buf = next
  }

  byte(value: number): void {
    this.room(1)
    this.buf[this.pos++] = value
  }

  blob(src: Uint8Array): void {
    this.room(src.length)
    this.buf.set(src, this.pos)
    this.pos += src.length
  }
}

/**
 * LEB128, минимальной длины.
 *
 * Деление вместо сдвигов не забывчивость: `>>>` режет до 32 бит, а аргументом
 * бывает целое до 2⁵³ — на сдвигах длины больше 4 ГиБ молча испортились бы.
 */
/**
 * Пишет varint в готовое место и возвращает новую позицию.
 *
 * Место обязан зарезервировать вызывающий — {@link VARINT_MAX} байт. Поштучная
 * запись через `sink.byte` проверяла бы границу на каждый байт: две загрузки
 * поля, сложение и сравнение там, где всё это уже сделано разом.
 */
function writeVarint(buf: Uint8Array, from: number, value: number): number {
  let pos = from
  let rest = value

  // Ветка на 32 битах: сдвиг вчетверо дешевле деления, а длины, коды и почти
  // все целые в неё укладываются. Замер: целое на миллион кодировалось 96 нс,
  // из них 45 уходило на три деления.
  if (rest <= 0xffffffff) {
    while (rest >= 0x80) {
      buf[pos++] = (rest & 0x7f) | 0x80
      rest >>>= 7
    }
    buf[pos++] = rest
    return pos
  }

  // Выше 2³² число делится ровно один раз — на 2²⁸, — и обе половины снова
  // укладываются в 32 бита. Цикл из шести делений стоил 117 нс, эта раскладка —
  // 3 нс; из-за него `Date` кодировался вчетверо дольше обычного целого.
  let high = Math.floor(rest / 0x10000000)
  const low = rest - high * 0x10000000
  buf[pos++] = (low & 0x7f) | 0x80
  buf[pos++] = ((low >>> 7) & 0x7f) | 0x80
  buf[pos++] = ((low >>> 14) & 0x7f) | 0x80
  buf[pos++] = ((low >>> 21) & 0x7f) | 0x80
  while (high >= 0x80) {
    buf[pos++] = (high & 0x7f) | 0x80
    high >>>= 7
  }
  buf[pos++] = high
  return pos
}

function putVarint(sink: Sink, value: number): void {
  sink.room(VARINT_MAX)
  sink.pos = writeVarint(sink.buf, sink.pos, value)
}

function putArg(sink: Sink, major: number, arg: number): void {
  if (arg <= SHORT_MAX) {
    sink.byte(major | arg)
    return
  }
  // Тег и varint — одна запись, поэтому и место под них берётся одно.
  sink.room(VARINT_MAX + 1)
  const buf = sink.buf
  const pos = sink.pos
  buf[pos] = major | SHORT_WIDE
  sink.pos = writeVarint(buf, pos + 1, arg - SHORT_MAX - 1)
}

// ── UTF-8 ────────────────────────────────────────────────────────────────────

/**
 * Длина строки в байтах UTF-8, либо `-1`, если в строке одинокий суррогат.
 *
 * Проверка и замер сведены в один проход не ради скорости, а потому что это
 * один и тот же обход: `TextEncoder` на одиноком суррогате молча подставил бы
 * U+FFFD, и значение потеряло бы символ по дороге в сеть.
 */
function utf8Size(text: string): number {
  let size = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code < 0x80) {
      size += 1
      continue
    }
    if (code < 0x800) {
      size += 2
      continue
    }
    if (code < 0xd800 || code > 0xdfff) {
      size += 3
      continue
    }
    if (code > 0xdbff) return -1
    const low = i + 1 < text.length ? text.charCodeAt(i + 1) : 0
    if (low < 0xdc00 || low > 0xdfff) return -1
    size += 4
    i += 1
  }
  return size
}

/** Пишет UTF-8 в готовое место. Строка уже проверена {@link utf8Size}. */
function writeUtf8(buf: Uint8Array, from: number, text: string): number {
  let pos = from
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i)
    if (unit < 0x80) {
      buf[pos++] = unit
      continue
    }
    if (unit < 0x800) {
      buf[pos++] = 0xc0 | (unit >> 6)
      buf[pos++] = 0x80 | (unit & 0x3f)
      continue
    }
    if (unit >= 0xd800 && unit <= 0xdbff) {
      i += 1
      const code = 0x10000 + ((unit - 0xd800) << 10) + (text.charCodeAt(i) - 0xdc00)
      buf[pos++] = 0xf0 | (code >> 18)
      buf[pos++] = 0x80 | ((code >> 12) & 0x3f)
      buf[pos++] = 0x80 | ((code >> 6) & 0x3f)
      buf[pos++] = 0x80 | (code & 0x3f)
      continue
    }
    buf[pos++] = 0xe0 | (unit >> 12)
    buf[pos++] = 0x80 | ((unit >> 6) & 0x3f)
    buf[pos++] = 0x80 | (unit & 0x3f)
  }
  return pos
}

/** Лексикографическое сравнение двух отрезков одного буфера, без нарезки видов. */
function cmpRange(buf: Uint8Array, aFrom: number, aSize: number, bFrom: number, bSize: number): number {
  const edge = aSize < bSize ? aSize : bSize
  for (let i = 0; i < edge; i++) {
    const x = buf[aFrom + i] as number
    const y = buf[bFrom + i] as number
    if (x !== y) return x < y ? -1 : 1
  }
  return aSize - bSize
}

/**
 * Вес код-юнита в порядке код-пойнтов.
 *
 * UTF-16 расставляет суррогаты (D800…DFFF) *перед* E000…FFFF, а код-пойнты, за
 * которые суррогаты отвечают, все больше U+FFFF. Сдвиг двух диапазонов
 * навстречу друг другу восстанавливает настоящий порядок.
 */
function rankUnit(unit: number): number {
  if (unit >= 0xe000) return unit - 0x800
  if (unit >= 0xd800) return unit + 0x2000
  return unit
}

/**
 * Ключи в порядке байтов UTF-8 (правило 4) — но без перевода в байты.
 *
 * UTF-8 сохраняет порядок код-пойнтов, поэтому сравнивать можно сами строки;
 * нельзя только доверять `<`, потому что он идёт по код-юнитам. Первая версия
 * переводила каждый ключ в свой `Uint8Array` — на объекте из семи полей это
 * стоило 106 нс на ключ, почти всё на аллокациях.
 */
function cmpKeys(a: string, b: string): number {
  const edge = a.length < b.length ? a.length : b.length
  for (let i = 0; i < edge; i++) {
    const x = a.charCodeAt(i)
    const y = b.charCodeAt(i)
    if (x !== y) return rankUnit(x) - rankUnit(y)
  }
  return a.length - b.length
}

/** Объекты, на которых вставками дешевле, чем `Array.prototype.sort`. */
const SORT_SMALL = 32

/**
 * Сортировка ключей вставками.
 *
 * `sort` с чужим компаратором стоил 276 нс на семи ключах против 116 нс здесь:
 * на таких размерах вся его цена — в обвязке вокруг вызова компаратора. Бонусом
 * на уже упорядоченном объекте (а такие в схемах преобладают) остаётся ровно
 * `n-1` сравнений и ни одной перестановки. За `SORT_SMALL` квадрат берёт своё,
 * и там работает штатный `sort`.
 */
function sortKeys(keys: string[]): void {
  if (keys.length > SORT_SMALL) {
    keys.sort(cmpKeys)
    return
  }
  for (let i = 1; i < keys.length; i++) {
    const key = keys[i] as string
    let slot = i - 1
    while (slot >= 0 && cmpKeys(keys[slot] as string, key) > 0) {
      keys[slot + 1] = keys[slot] as string
      slot -= 1
    }
    keys[slot + 1] = key
  }
}

// ── Кодирование ──────────────────────────────────────────────────────────────

function putNumber(sink: Sink, value: number): void {
  // Правило 2: целое всегда предпочтительнее вещественного, поэтому `1.0` и `1`
  // дают одни и те же байты. Граница — безопасное целое: за ней double уже не
  // различает соседние целые, и обратный перевод вернул бы не то же число.
  if (Number.isSafeInteger(value)) {
    // Правило 3: `-0` неотличим от `0`.
    if (value >= 0) putArg(sink, MAJOR_UINT, value === 0 ? 0 : value)
    else putArg(sink, MAJOR_NINT, -1 - value)
    return
  }

  sink.byte(SPEC_FLOAT)

  // Правило 3: у NaN одна запись. В JS все NaN наблюдаются как тихий 0x7FF8…,
  // но полагаться на это — значит полагаться на детали NaN-boxing конкретного
  // движка; байты выписываются явно.
  if (Number.isNaN(value)) {
    F64_VIEW.setUint32(0, 0x7ff80000, false)
    F64_VIEW.setUint32(4, 0, false)
  } else {
    F64_VIEW.setFloat64(0, value, false)
  }
  sink.blob(F64_BYTES)
}

function putBig(sink: Sink, value: bigint): void {
  const negative = value < 0n
  putArg(sink, MAJOR_EXTRA, negative ? EXTRA_BIG_NEG : EXTRA_BIG_POS)

  if (value === 0n) {
    putVarint(sink, 0)
    return
  }

  // Через hex, а не через сдвиги: `mag >>= 8n` в цикле — квадрат по длине
  // числа, а `toString(16)` для степени двойки линеен и делается на месте.
  const hex = (negative ? -value : value).toString(16)
  const odd = hex.length & 1
  const size = (hex.length + odd) >> 1

  putVarint(sink, size)
  sink.room(size)

  let pos = sink.pos
  let cursor = 0
  if (odd === 1) {
    sink.buf[pos++] = hexDigit(hex.charCodeAt(0))
    cursor = 1
  }
  for (; cursor < hex.length; cursor += 2) {
    sink.buf[pos++] = (hexDigit(hex.charCodeAt(cursor)) << 4) | hexDigit(hex.charCodeAt(cursor + 1))
  }
  sink.pos = pos
}

function hexDigit(code: number): number {
  return code <= 0x39 ? code - 0x30 : code - 0x57
}

function putText(sink: Sink, text: string, what: string): void {
  // Короткая строка (а это все ключи словаря и почти все значения) идёт своим
  // циклом: он заодно и проверяет, и меряет, и пишет.
  //
  // Отдельная ветка «короткий ASCII одним проходом» здесь была и снята: она
  // ускоряла одинокую строку с 90 до 68 нс, но замедляла вложенный объект с
  // 1.44 до 1.58 мкс — на десяти вызовах подряд разросшийся `putText`
  // перестаёт вставляться в вызывающего. Объект весит больше одинокой строки.
  if (text.length <= TEXT_MANUAL) {
    const size = utf8Size(text)
    if (size < 0) throw new VaryError(`lone surrogate in ${what} — valid UTF-8 cannot be produced from it`, '')
    putArg(sink, MAJOR_TEXT, size)
    if (size === 0) return
    sink.room(size)
    sink.pos = writeUtf8(sink.buf, sink.pos, text)
    return
  }

  // На длинной строке замер разворачивает картину. Свой проход по `charCodeAt`
  // на 4096 символах стоил 21–28 мкс, `encode` — 1.5–12 мкс, а `encodeInto` в
  // готовый буфер — 0.16–7.9 мкс: он не аллоцирует и на ASCII вырождается почти
  // в memcpy. Поэтому пишем сразу в приёмник.
  //
  // `encodeInto` подменил бы одинокий суррогат на U+FFFD, а это уже другое
  // значение, поэтому проверка идёт до записи и отдельно.
  if (!wellFormed(text)) throw new VaryError(`lone surrogate in ${what} — valid UTF-8 cannot be produced from it`, '')

  // Длина в байтах наперёд неизвестна, а тег стоит перед нагрузкой. Поэтому
  // нагрузка пишется с запасом под самый длинный тег, а потом подтягивается к
  // нему: memmove нескольких килобайт дешевле лишнего прохода по строке.
  // Верхняя оценка — три байта на код-юнит (суррогатная пара это 2 юнита на 4 байта).
  const cap = text.length * 3
  sink.room(TAG_MAX + cap)
  const from = sink.pos + TAG_MAX
  const done = TEXT_ENC.encodeInto(text, sink.buf.subarray(from, from + cap))

  // Сторож на оценку сверху. Если она когда-нибудь окажется мала, `encodeInto`
  // не пожалуется — просто остановится, и в сеть уйдёт обрезанная строка.
  if (done.read !== text.length) throw new VaryError(`string did not fit the estimate: read ${done.read} of ${text.length}`, '')

  const written = done.written
  putArg(sink, MAJOR_TEXT, written)
  if (sink.pos !== from) sink.buf.copyWithin(sink.pos, from, from + written)
  sink.pos += written
}

function putDate(sink: Sink, value: Date): void {
  const ms = value.getTime()
  if (Number.isNaN(ms)) throw new VaryError('Invalid Date cannot be encoded: it has no instant to return', '')

  // `ms >= 0` отсекает и `-0`: `Object.is(-0, 0)` тут не нужен, потому что
  // `new Date(-0).getTime()` даёт именно `0`.
  if (ms >= 0) {
    putArg(sink, MAJOR_EXTRA, EXTRA_DATE_POS)
    putVarint(sink, ms)
  } else {
    putArg(sink, MAJOR_EXTRA, EXTRA_DATE_NEG)
    putVarint(sink, -ms)
  }
}

function putList(sink: Sink, list: readonly Vary[], depth: number): void {
  putArg(sink, MAJOR_LIST, list.length)
  for (let i = 0; i < list.length; i++) {
    const item = list[i]
    // Правило 6: дырка в массиве и `undefined` неотличимы от `null` после
    // разбора, а значит тождество round-trip на них не держится.
    if (item === undefined) throw new VaryError(`element #${i} is undefined; the array must be dense`, '')
    putVary(sink, item, depth + 1)
  }
}

function putDict(sink: Sink, dict: { readonly [key: string]: Vary }, depth: number): void {
  const keys = Object.keys(dict)
  const count = keys.length
  putArg(sink, MAJOR_DICT, count)
  if (count === 0) return

  // Правило 4: порядок по БАЙТАМ ключа, а не по код-юнитам JS. Разница видна на
  // астральных символах: суррогатная пара кодируется с F0…, что больше EE… от
  // U+E000, а по код-юнитам D800 меньше E000. Сортировка идёт по {@link cmpKeys},
  // который даёт байтовый порядок, не строя байтов. Массив свой — `Object.keys`
  // возвращает свежий, чужого объекта сортировка не касается.
  if (count > 1) sortKeys(keys)

  for (let i = 0; i < count; i++) {
    const key = keys[i] as string
    putText(sink, key, 'key')

    const item = dict[key]
    if (item === undefined) throw new VaryError(`value of key "${key}" is undefined; absence is expressed with null`, '')
    putVary(sink, item, depth + 1)
  }
}

function putVary(sink: Sink, value: Vary, depth: number): void {
  if (depth > MAX_DEPTH) throw new VaryError(`nesting deeper than ${MAX_DEPTH}`, '')

  if (value === null) {
    sink.byte(SPEC_NULL)
    return
  }
  if (typeof value === 'boolean') {
    sink.byte(value ? SPEC_TRUE : SPEC_FALSE)
    return
  }
  if (typeof value === 'number') {
    putNumber(sink, value)
    return
  }
  if (typeof value === 'string') {
    putText(sink, value, 'string')
    return
  }
  if (typeof value === 'bigint') {
    putBig(sink, value)
    return
  }
  if (typeof value !== 'object') {
    throw new VaryError(`the codec does not accept a value of type ${typeof value}`, '')
  }

  if (value instanceof Uint8Array) {
    putArg(sink, MAJOR_BLOB, value.length)
    sink.blob(value)
    return
  }
  if (value instanceof Date) {
    putDate(sink, value)
    return
  }
  if (Array.isArray(value)) {
    // `Array.isArray` сужает до `any[]`, а не до `readonly Vary[]`, поэтому
    // приведение здесь — плата за форму типа, а не потеря проверки.
    putList(sink, value as readonly Vary[], depth)
    return
  }

  // Всё остальное со своим прототипом — Map, Set, RegExp, чужой класс, другой
  // TypedArray — отвергается, а не сводится к словарю: тихая потеря полей
  // страшнее отказа.
  const proto = Object.getPrototypeOf(value) as object | null
  if (proto !== OBJECT_PROTO && proto !== null) {
    throw new VaryError(`the codec does not accept an object of kind ${nameOf(value)}`, '')
  }

  putDict(sink, value as { readonly [key: string]: Vary }, depth)
}

function nameOf(value: object): string {
  const ctor = (value as { constructor?: { name?: string } }).constructor
  const name = ctor === undefined ? undefined : ctor.name
  return name === undefined || name === '' ? 'unnamed' : name
}

// ── Источник байтов ──────────────────────────────────────────────────────────

class Reader {
  readonly buf: Uint8Array
  readonly end: number
  pos: number

  constructor(buf: Uint8Array) {
    this.buf = buf
    this.end = buf.length
    this.pos = 0
  }
}

function at(pos: number): string {
  return `byte ${pos}`
}

function need(reader: Reader, count: number): void {
  if (reader.pos + count > reader.end) {
    throw new VaryError(`need ${count} more B, but only ${reader.end - reader.pos} left`, at(reader.pos))
  }
}

function takeVarint(reader: Reader): number {
  let value = 0
  let scale = 1
  let count = 0

  for (;;) {
    if (reader.pos >= reader.end) throw new VaryError('varint truncated', at(reader.pos))
    const byte = reader.buf[reader.pos++] as number
    count += 1
    // 8 групп по 7 бит = 56 бит: больше безопасного целого всё равно не бывает.
    if (count > 8) throw new VaryError('varint wider than 53 bits', at(reader.pos - 1))

    value += (byte & 0x7f) * scale
    if ((byte & 0x80) === 0) {
      // Правило 1: у длины одна запись. Хвостовой нулевой группы у минимальной
      // формы не бывает — она добавляет ноль старших бит.
      if (count > 1 && byte === 0) throw new VaryError('varint is not minimal-length', at(reader.pos - 1))
      if (value > Number.MAX_SAFE_INTEGER) throw new VaryError('varint exceeds 2⁵³-1', at(reader.pos - 1))
      return value
    }
    scale *= 128
  }
}

function takeArg(reader: Reader, tag: number): number {
  const short = tag & 0x1f
  if (short <= SHORT_MAX) return short

  const wide = SHORT_MAX + 1 + takeVarint(reader)
  // Смещение на 31 способно вытолкнуть аргумент за безопасное целое, а дальше
  // арифметика над ним перестанет быть точной.
  if (wide > Number.MAX_SAFE_INTEGER) throw new VaryError('tag argument exceeds 2⁵³-1', at(reader.pos))
  return wide
}

function takeFloat(reader: Reader): number {
  need(reader, 8)
  // Байты переливаются в модульное окно: свой `DataView` на каждый разбор стоил
  // дороже, чем сама эта копия восьми байт.
  F64_BYTES.set(reader.buf.subarray(reader.pos, reader.pos + 8))

  const hi = F64_VIEW.getUint32(0, false)
  const lo = F64_VIEW.getUint32(4, false)

  if ((hi & 0x7ff00000) === 0x7ff00000 && ((hi & 0x000fffff) !== 0 || lo !== 0)) {
    // Правило 3: NaN только в одной записи. Отличить тихий NaN от сигнального
    // после `getFloat64` уже нельзя — смотрим на биты до перевода.
    if (hi !== 0x7ff80000 || lo !== 0) throw new VaryError('NaN is not canonical (only 0x7FF8000000000000 allowed)', at(reader.pos))
    reader.pos += 8
    return Number.NaN
  }

  const value = F64_VIEW.getFloat64(0, false)
  if (Object.is(value, -0)) throw new VaryError('-0 must be encoded as integer 0', at(reader.pos))
  // Правило 2: если число целое и безопасное, его место в UINT/NINT.
  if (Number.isSafeInteger(value)) throw new VaryError(`${value} is a safe integer and belongs in the integer tag`, at(reader.pos))

  reader.pos += 8
  return value
}

function takeText(reader: Reader, size: number): string {
  need(reader, size)
  const from = reader.pos
  const till = from + size

  // Короткий ASCII — самый частый ключ словаря; посимвольная сборка на нём
  // дешевле входа в `TextDecoder` (см. bench/vary.mjs).
  if (size <= TEXT_ASCII) {
    let text = ''
    let plain = true
    for (let i = from; i < till; i++) {
      const byte = reader.buf[i] as number
      if (byte >= 0x80) {
        plain = false
        break
      }
      text += String.fromCharCode(byte)
    }
    if (plain) {
      reader.pos = till
      return text
    }
  }

  let text: string
  try {
    text = TEXT_DEC.decode(reader.buf.subarray(from, till))
  } catch (error) {
    throw new VaryError(`malformed UTF-8: ${(error as Error).message}`, at(from))
  }
  reader.pos = till
  return text
}

function takeBig(reader: Reader, negative: boolean): bigint {
  const size = takeVarint(reader)
  need(reader, size)

  if (size === 0) {
    if (negative) throw new VaryError('bigint has no negative zero', at(reader.pos))
    return 0n
  }
  // Правило 1: ведущий нулевой байт — вторая запись того же числа.
  if (reader.buf[reader.pos] === 0) throw new VaryError('bigint magnitude has a leading zero byte', at(reader.pos))

  let hex = ''
  const till = reader.pos + size
  for (let i = reader.pos; i < till; i++) hex += HEX[reader.buf[i] as number]
  reader.pos = till

  const mag = BigInt(`0x${hex}`)
  return negative ? -mag : mag
}

function takeExtra(reader: Reader, tag: number, from: number): Vary {
  const extra = takeArg(reader, tag)

  if (extra === EXTRA_DATE_POS || extra === EXTRA_DATE_NEG) {
    const away = takeVarint(reader)
    if (away > TIME_LIMIT) throw new VaryError(`${away} ms outside the Date range`, at(from))
    // Правило 1 в приложении к знаку: у эпохи одна запись, положительная.
    if (extra === EXTRA_DATE_NEG && away === 0) throw new VaryError('the epoch must be encoded with a positive sign', at(from))
    return new Date(extra === EXTRA_DATE_POS ? away : -away)
  }
  if (extra === EXTRA_BIG_POS) return takeBig(reader, false)
  if (extra === EXTRA_BIG_NEG) return takeBig(reader, true)

  throw new VaryError(`extension #${extra} is unknown to this codec version`, at(from))
}

function takeDict(reader: Reader, tag: number, depth: number): Vary {
  const count = takeArg(reader, tag)
  const dict: Record<string, Vary> = {}

  let prevFrom = -1
  let prevSize = 0

  for (let i = 0; i < count; i++) {
    need(reader, 1)
    const keyAt = reader.pos
    const keyTag = reader.buf[reader.pos++] as number
    if ((keyTag & 0xe0) !== MAJOR_TEXT) {
      throw new VaryError(`a dictionary key must be a string, but the tag is 0x${HEX[keyTag]}`, at(keyAt))
    }

    const size = takeArg(reader, keyTag)
    need(reader, size)
    const from = reader.pos

    // Правило 4: строго по возрастанию байтов. «Не меньше» тут мало — равенство
    // означало бы два одинаковых ключа, то есть потерю одного значения.
    // Сравниваются отрезки на месте: пара `subarray` на ключ стоила заметную
    // часть разбора словаря, а нужны они были только ради сравнения.
    if (prevFrom >= 0 && cmpRange(reader.buf, prevFrom, prevSize, from, size) >= 0) {
      throw new VaryError('dictionary keys are not in strictly ascending byte order', at(from))
    }
    prevFrom = from
    prevSize = size

    const key = takeText(reader, size)
    const value = takeVary(reader, depth + 1)

    // `dict['__proto__'] = …` подменил бы прототип вместо записи поля: ключ
    // пришёл из сети, и такой подарок разбирается через defineProperty. Ветка
    // редкая, поэтому её цена (см. реестр расхождений, п.17) не в счёт.
    if (key === '__proto__') Object.defineProperty(dict, key, { value, writable: true, enumerable: true, configurable: true })
    else dict[key] = value
  }

  return dict
}

function takeVary(reader: Reader, depth: number): Vary {
  if (depth > MAX_DEPTH) throw new VaryError(`nesting deeper than ${MAX_DEPTH}`, at(reader.pos))

  need(reader, 1)
  const from = reader.pos
  const tag = reader.buf[reader.pos++] as number

  switch (tag & 0xe0) {
    case MAJOR_SPEC: {
      if (tag === SPEC_NULL) return null
      if (tag === SPEC_FALSE) return false
      if (tag === SPEC_TRUE) return true
      if (tag === SPEC_FLOAT) return takeFloat(reader)
      throw new VaryError(`tag 0x${HEX[tag]} is unknown to this codec version`, at(from))
    }
    case MAJOR_UINT:
      return takeArg(reader, tag)
    case MAJOR_NINT: {
      const arg = takeArg(reader, tag)
      if (arg >= Number.MAX_SAFE_INTEGER) throw new VaryError('an integer below -(2⁵³-1) cannot be represented as a number', at(from))
      return -1 - arg
    }
    case MAJOR_BLOB: {
      const size = takeArg(reader, tag)
      need(reader, size)
      // Копия, а не окно: иначе разобранное значение держало бы весь буфер
      // пачки живым, пока живо само.
      const blob = reader.buf.slice(reader.pos, reader.pos + size)
      reader.pos += size
      return blob
    }
    case MAJOR_TEXT:
      return takeText(reader, takeArg(reader, tag))
    case MAJOR_LIST: {
      const count = takeArg(reader, tag)
      const list: Vary[] = []
      for (let i = 0; i < count; i++) list.push(takeVary(reader, depth + 1))
      return list
    }
    case MAJOR_DICT:
      return takeDict(reader, tag, depth)
    default:
      return takeExtra(reader, tag, from)
  }
}

// ── Путь до плохого узла ─────────────────────────────────────────────────────

/**
 * Путь до первого узла, который кодек не берёт, либо `null`, если всё годное.
 *
 * Считается **только после отказа**, отдельным проходом. Так на счастливом пути
 * не платят ни строкой, ни push/pop за диагностику, которая почти никогда не
 * понадобится, — а когда понадобится, она полная, а не «где-то в объекте».
 */
function locate(value: unknown, depth: number, trail: string): string | null {
  if (depth > MAX_DEPTH) return trail
  if (value === null) return null

  const kind = typeof value
  if (kind === 'boolean' || kind === 'number' || kind === 'bigint') return null
  if (kind === 'string') return utf8Size(value as string) < 0 ? trail : null
  if (kind !== 'object') return trail

  if (value instanceof Uint8Array) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? trail : null

  if (Array.isArray(value)) {
    const list = value as readonly unknown[]
    for (let i = 0; i < list.length; i++) {
      const bad = locate(list[i], depth + 1, `${trail}[${i}]`)
      if (bad !== null) return bad
    }
    return null
  }

  const proto = Object.getPrototypeOf(value) as object | null
  if (proto !== OBJECT_PROTO && proto !== null) return trail

  const dict = value as Record<string, unknown>
  for (const key of Object.keys(dict)) {
    const bad = locate(dict[key], depth + 1, `${trail}.${key}`)
    if (bad !== null) return bad
  }
  return null
}

// ── Публичное API ────────────────────────────────────────────────────────────

const SCRATCH = new Sink()
let BUSY = false

/**
 * Кодирует значение в канонические байты.
 *
 * Одно и то же по смыслу значение всегда даёт одни и те же байты: порядок
 * ключей объекта не важен, `1.0` совпадает с `1`, `-0` — с `0`.
 *
 * @throws {VaryError} на неподдержанном типе, `undefined` внутри контейнера,
 * Invalid Date, одиноком суррогате в строке и вложенности глубже 512.
 *
 * @example
 * ```ts
 * varyEncode({ b: 1, a: 2 }) // те же байты, что и varyEncode({ a: 2, b: 1 })
 * ```
 */
export function varyEncode(value: Vary): Uint8Array {
  // Скрэтч, а не свежий буфер на вызов: замер показал 300 нс на кодирование
  // одного целого, из которых почти всё уходило на создание буфера и вида.
  // Результат всё равно копируется наружу, так что переиспользование ничего
  // не делит между вызовами.
  //
  // Оговорка про повторный вход: `Object.keys` на прокси зовёт чужую ловушку,
  // а та вправе позвать `varyEncode` снова. Вложенный вызов берёт свой буфер —
  // иначе внешний тихо получил бы перезаписанные байты.
  const own = !BUSY
  const sink = own ? SCRATCH : new Sink()
  if (own) {
    BUSY = true
    sink.pos = 0
  }

  // `try` стоит на границе функции, а не в цикле (правило 9): цена нулевая,
  // пока никто не бросает, а взамен сообщение получает путь до плохого узла.
  try {
    putVary(sink, value, 0)
  } catch (error) {
    if (own) BUSY = false
    if (error instanceof VaryError && error.at === '') {
      throw new VaryError(error.reason, locate(value, 0, '$') ?? '$')
    }
    throw error
  }

  const out = sink.buf.slice(0, sink.pos)
  if (own) {
    BUSY = false
    // Одно большое значение не должно навсегда оставить мегабайты под скрэтчем.
    if (sink.buf.length > SINK_KEEP) sink.buf = new Uint8Array(SINK_START)
  }
  return out
}

/**
 * Разбирает канонические байты обратно в значение.
 *
 * Разбор строгий: неканоничный вход (не минимальный varint, несортированные
 * ключи, `-0` или целое в вещественном теге, хвост после значения) отвергается,
 * а не «чинится».
 *
 * @throws {VaryError} на обрыве, неизвестном теге, нарушении каноничности и
 * лишних байтах в хвосте.
 */
export function varyDecode(bytes: Uint8Array): Vary {
  const reader = new Reader(bytes)
  const value = takeVary(reader, 0)

  if (reader.pos !== reader.end) {
    throw new VaryError(`${reader.end - reader.pos} B left after the value`, at(reader.pos))
  }
  return value
}

/**
 * Равны ли значения по своим байтам — то есть по тому же признаку, по которому
 * их различает хэш юнита.
 *
 * Сравнение идёт именно через кодирование, без коротких путей по значениям:
 * любой «быстрый» предикат рядом с кодеком рано или поздно разойдётся с ним, и
 * тогда две реплики согласятся, что значения равны, при разных хэшах.
 */
export function varyEqual(a: Vary, b: Vary): boolean {
  const left = varyEncode(a)
  const right = varyEncode(b)
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false
  }
  return true
}
