// Независимый разбор байтов `Vary` — вторая реализация формата.
//
// Golden-векторы фиксируют поведение, но не доказывают правильность: их вывел
// тот же человек, что писал кодек, и проверяет ими он же свою раскладку. Здесь
// разбор написан заново по ОПИСАНИЮ формата — таблица в шапке `../vary.ts` и
// `docs/03-binary-format.md` §4, — а не срисован с `vary.ts`. Совпадение двух
// независимых прочтений одного описания и есть доказательство.
//
// Правила горячего пути тут НЕ действуют намеренно: файл живёт в `__tests__`,
// скорость не важна, и любая оптимизация — это шанс повторить чужую ошибку.
// Аргументы считаются в `bigint`, строки собираются посимвольно, каждая
// проверка выписана буквой правила, а не свёрнута в общий проход.
//
// ─── Прочтение описания ──────────────────────────────────────────────────────
//
//   tag = major << 5 | short
//   short ≤ 30 → arg = short;  short = 31 → arg = 31 + LEB128 следом
//
//   major 0 SPEC   arg — код: 0 null · 1 false · 2 true · 3 float64 (8 байт)
//   major 1 UINT   arg — само значение
//   major 2 NINT   значение = -1 - arg
//   major 3 BLOB   arg — длина в байтах, следом байты
//   major 4 TEXT   arg — длина в байтах, следом UTF-8
//   major 5 LIST   arg — число элементов
//   major 6 DICT   arg — число пар «ключ TEXT, значение»
//   major 7 EXTRA  arg — номер расширения: 0 Date≥0 · 1 Date<0 · 2 big≥0 ·
//                  3 big<0 · 4…7 зарезервированы
//
// Разбор строгий: §4 требует каноничности, и вторая реализация обязана мерить
// именно её, иначе она примет вход, который кодек никогда бы не написал, и
// расхождение раскладок пройдёт незамеченным. Что проверяется:
//   1. LEB128 минимален (последняя группа не нулевая, если групп больше одной);
//   2. целые пишутся целыми: safe-integer в вещественной ветке — отказ;
//   3. `-0` в вещественной ветке — отказ; NaN только `0x7ff8000000000000`;
//   4. ключи словаря строго возрастают по байтам UTF-8;
//   5. UTF-8 без overlong-форм, суррогатов и хвостов за U+10FFFF;
//   6. модуль bigint без ведущего нуля;
//   7. после значения не остаётся ни байта.

/**
 * Отказ независимого разбора. Отдельный класс, а не `VaryError`: путать, чья
 * это была жалоба — кодека или сверки, — в отчёте о расхождении нельзя.
 */
export class VaryMismatch extends Error {
  readonly at: number

  constructor(reason: string, at: number) {
    super(`${reason} — байт ${at}`)
    this.name = 'VaryMismatch'
    this.at = at
  }
}

/**
 * Значение, которое отдаёт независимый разбор.
 *
 * Тип объявлен здесь заново, а не взят импортом из `../vary`: сверка не должна
 * зависеть от проверяемого модуля даже типами.
 */
export type RefVary =
  | null
  | boolean
  | number
  | bigint
  | string
  | Uint8Array
  | Date
  | RefVary[]
  | { [key: string]: RefVary }

/** Потолок вложенности: вход недоверенный, разбор рекурсивный. */
const REF_MAX_DEPTH = 512

/** Границы `Date`: дальше `new Date(ms)` даёт Invalid Date. */
const REF_TIME_LIMIT = 8_640_000_000_000_000

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER)

interface Cursor {
  readonly bytes: Uint8Array
  at: number
}

function byte(cur: Cursor): number {
  const value = cur.bytes[cur.at]
  if (value === undefined) throw new VaryMismatch('байты кончились раньше значения', cur.at)
  cur.at += 1
  return value
}

/**
 * LEB128 без знака. Считается в `bigint`, чтобы разбор не зависел от того,
 * влезает ли число в double: проверка на диапазон — отдельное правило, и она
 * должна ловить, а не тонуть в округлении.
 */
function leb128(cur: Cursor): bigint {
  let out = 0n
  let shift = 0n
  let groups = 0
  let last = 0

  for (;;) {
    const b = byte(cur)
    out |= BigInt(b & 0x7f) << shift
    shift += 7n
    groups += 1
    last = b
    if ((b & 0x80) === 0) break
    // Десять групп по 7 бит — это 70 бит; всё, что длиннее, заведомо мусор.
    if (groups > 10) throw new VaryMismatch('LEB128 длиннее десяти групп', cur.at)
  }

  // Правило 1: длины пишутся минимальным числом байт. Хвостовая нулевая группа
  // — это второе представление того же числа.
  if (groups > 1 && (last & 0x7f) === 0) throw new VaryMismatch('LEB128 не минимален', cur.at)

  return out
}

interface Tag {
  readonly major: number
  readonly arg: bigint
}

function tag(cur: Cursor): Tag {
  const head = byte(cur)
  const major = head >> 5
  const short = head & 0x1f
  // Смещение на 31: короткая форма покрывает 0…30, расширенная начинается ровно
  // там, где короткая кончилась, — иначе у 0…30 было бы по два написания.
  const arg = short === 31 ? 31n + leb128(cur) : BigInt(short)
  return { major, arg }
}

function span(cur: Cursor, length: bigint): Uint8Array {
  if (length > BigInt(cur.bytes.length - cur.at)) {
    throw new VaryMismatch(`нагрузки на ${length} байт нет в буфере`, cur.at)
  }
  const from = cur.at
  cur.at += Number(length)
  return cur.bytes.subarray(from, cur.at)
}

/**
 * Свой разбор UTF-8 — намеренно вместо `TextDecoder`.
 *
 * Кодек пишет строки нативным `TextEncoder`; если сверять его нативным
 * `TextDecoder`, обе стороны сойдутся даже при неверном прочтении длины, потому
 * что ошибка окажется общей. Здесь последовательности разбираются буквой
 * стандарта, а overlong-формы, суррогаты и код-пойнты за U+10FFFF отвергаются:
 * у одного символа не должно быть двух записей (правило 1 в применении к тексту).
 */
function utf8(bytes: Uint8Array, base: number): string {
  let out = ''
  let i = 0

  const cont = (index: number): number => {
    const b = bytes[index]
    if (b === undefined || (b & 0xc0) !== 0x80) {
      throw new VaryMismatch('оборванная последовательность UTF-8', base + index)
    }
    return b & 0x3f
  }

  while (i < bytes.length) {
    const lead = bytes[i] as number
    let code: number
    let size: number

    if (lead < 0x80) {
      code = lead
      size = 1
    } else if (lead >= 0xc2 && lead <= 0xdf) {
      code = ((lead & 0x1f) << 6) | cont(i + 1)
      size = 2
    } else if (lead >= 0xe0 && lead <= 0xef) {
      code = ((lead & 0x0f) << 12) | (cont(i + 1) << 6) | cont(i + 2)
      size = 3
    } else if (lead >= 0xf0 && lead <= 0xf4) {
      code = ((lead & 0x07) << 18) | (cont(i + 1) << 12) | (cont(i + 2) << 6) | cont(i + 3)
      size = 4
    } else {
      // 0x80…0xc1 — либо хвост без головы, либо overlong-голова двухбайтовой
      // формы (0xc0/0xc1 кодируют только то, что влезает в один байт).
      throw new VaryMismatch(`недопустимый ведущий байт UTF-8 0x${lead.toString(16)}`, base + i)
    }

    if (size === 3 && code < 0x800) throw new VaryMismatch('overlong-последовательность UTF-8', base + i)
    if (size === 4 && code < 0x10000) throw new VaryMismatch('overlong-последовательность UTF-8', base + i)
    if (code >= 0xd800 && code <= 0xdfff) throw new VaryMismatch('суррогат в UTF-8', base + i)
    if (code > 0x10ffff) throw new VaryMismatch('код-пойнт за U+10FFFF', base + i)

    out += String.fromCodePoint(code)
    i += size
  }

  return out
}

/** Лексикографическое сравнение байтов — им задан порядок ключей (правило 4). */
function cmpBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const x = a[i] as number
    const y = b[i] as number
    if (x !== y) return x < y ? -1 : 1
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1
}

function float64(cur: Cursor): number {
  const at = cur.at
  const raw = span(cur, 8n)

  // Порядок байт задан форматом (big-endian), а не платформой, поэтому биты
  // собираются вручную, а не через `getFloat64` над чужим буфером.
  let bits = 0n
  for (const b of raw) bits = (bits << 8n) | BigInt(b)

  const view = new DataView(new ArrayBuffer(8))
  view.setBigUint64(0, bits, false)
  const value = view.getFloat64(0, false)

  // Правило 3: `-0` пишется как `0`, у NaN одна запись.
  if (bits === 0x8000_0000_0000_0000n) throw new VaryMismatch('-0 в вещественной ветке', at)
  if (Number.isNaN(value) && bits !== 0x7ff8_0000_0000_0000n) {
    throw new VaryMismatch(`неканоничный NaN 0x${bits.toString(16)}`, at)
  }
  // Правило 2: целые предпочитаются вещественным. Число за границей точного
  // (1e300 и т. п.) целым не пишется — оно `isInteger`, но не `isSafeInteger`.
  if (Number.isSafeInteger(value)) throw new VaryMismatch(`целое ${value} записано вещественным`, at)

  return value
}

function magnitude(cur: Cursor): bigint {
  const at = cur.at
  const size = leb128(cur)
  const raw = span(cur, size)
  if (raw.length > 0 && raw[0] === 0) throw new VaryMismatch('ведущий нуль в модуле bigint', at)

  let out = 0n
  for (const b of raw) out = (out << 8n) | BigInt(b)
  return out
}

function value(cur: Cursor, depth: number): RefVary {
  if (depth > REF_MAX_DEPTH) throw new VaryMismatch('вложенность глубже 512', cur.at)

  const at = cur.at
  const { major, arg } = tag(cur)

  if (major === 0) {
    if (arg === 0n) return null
    if (arg === 1n) return false
    if (arg === 2n) return true
    if (arg === 3n) return float64(cur)
    throw new VaryMismatch(`неизвестный код спецзначения ${arg}`, at)
  }

  if (major === 1) {
    if (arg > MAX_SAFE) throw new VaryMismatch(`целое ${arg} за границей безопасного`, at)
    return Number(arg)
  }

  if (major === 2) {
    const out = -1n - arg
    if (out < -MAX_SAFE) throw new VaryMismatch(`целое ${out} за границей безопасного`, at)
    return Number(out)
  }

  if (major === 3) return new Uint8Array(span(cur, arg))

  if (major === 4) {
    const from = cur.at
    return utf8(span(cur, arg), from)
  }

  if (major === 5) {
    const count = Number(arg)
    const out: RefVary[] = []
    for (let i = 0; i < count; i++) out.push(value(cur, depth + 1))
    return out
  }

  if (major === 6) {
    const count = Number(arg)
    const out: { [key: string]: RefVary } = {}
    let previous: Uint8Array | null = null

    for (let i = 0; i < count; i++) {
      const keyAt = cur.at
      const keyTag = tag(cur)
      if (keyTag.major !== 4) throw new VaryMismatch(`ключ словаря не TEXT, а major ${keyTag.major}`, keyAt)
      const raw = span(cur, keyTag.arg)
      const key = utf8(raw, keyAt)

      // Правило 4: сортировка по БАЙТАМ ключа. Строго возрастает — повтор ключа
      // дал бы одному значению две записи.
      if (previous !== null) {
        const order = cmpBytes(previous, raw)
        if (order === 0) throw new VaryMismatch(`ключ «${key}» повторяется`, keyAt)
        if (order > 0) throw new VaryMismatch(`ключ «${key}» нарушает порядок по байтам`, keyAt)
      }
      previous = raw

      // `out[key] = …` подменил бы прототип на ключе `__proto__`, и поле
      // потерялось бы уже в сверке. Семантика `JSON.parse`: собственное поле.
      Object.defineProperty(out, key, { value: value(cur, depth + 1), writable: true, enumerable: true, configurable: true })
    }

    return out
  }

  // major === 7, расширения.
  if (arg === 0n || arg === 1n) {
    const msAt = cur.at
    const ms = leb128(cur)
    if (ms > BigInt(REF_TIME_LIMIT)) throw new VaryMismatch(`дата за пределами диапазона: ${ms} мс`, msAt)
    // Ноль миллисекунд принадлежит расширению 0; в расширении 1 он был бы
    // вторым написанием эпохи, то есть нарушением единственности представления.
    if (arg === 1n && ms === 0n) throw new VaryMismatch('нулевая дата записана как отрицательная', msAt)
    return new Date(arg === 0n ? Number(ms) : -Number(ms))
  }

  if (arg === 2n || arg === 3n) {
    const bigAt = cur.at
    const abs = magnitude(cur)
    if (arg === 3n && abs === 0n) throw new VaryMismatch('нулевой bigint записан отрицательным', bigAt)
    return arg === 2n ? abs : -abs
  }

  throw new VaryMismatch(`расширение №${arg} этой версии формата неизвестно`, at)
}

/**
 * Разобрать байты `Vary` независимой реализацией.
 *
 * Бросает `VaryMismatch` и на битых байтах, и на любом отступлении от
 * каноничности: для сверки «принял, но не то» — худший исход, чем отказ.
 */
export function referenceDecode(bytes: Uint8Array): RefVary {
  const cur: Cursor = { bytes, at: 0 }
  const out = value(cur, 0)
  // Правило: у значения ровно одна запись, а значит и ровно одна длина.
  if (cur.at !== bytes.length) throw new VaryMismatch(`после значения осталось ${bytes.length - cur.at} байт`, cur.at)
  return out
}
