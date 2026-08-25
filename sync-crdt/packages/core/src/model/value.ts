// ─── Линзы значений: `Cast` и `Type` ─────────────────────────────────────────
//
// Здесь живёт решение Р5 из [docs/05 §0](../../../../docs/05-model-api.md):
// `Cast<T>` умеет читать и писать, но НЕ знает, что подставить вместо мусора;
// `Type<T>` — это `Cast<T>`, которому «пустое» значение НАЗВАЛИ. Атому годится
// только второй, поэтому `atom(t.enum([...]))` не компилируется вовсе, а не
// «запрещён комментарием»: у `$mol_schema_enum` `cast` молча подставлял
// `Options[0]`, и член от узла новой версии становился валидным значением
// (реестр расхождений, п. 26).
//
// Контракт один на весь слой (docs/05 §4):
//   decode(raw) → T | null   — НИКОГДА не бросает; `null` значит «это не наш тип»
//   encode(value) → Vary     — бросает только на том, что типом не выражается
//                              (`t.pattern`, `t.int`, `t.range`)
//
// Один недобросовестный пир не имеет права уронить приложение, поэтому чтение
// без исключений — не удобство, а требование безопасности.

import { Link } from '../binary/link'
import type { Vary } from '../binary/vary'

/** Ключ словаря и ключ мультиплексированного канала — один и тот же примитив. */
export type Key = string | number

/** Линза «сырое значение ↔ прикладное». Чтение НИКОГДА не бросает. */
export interface Cast<T> {
  readonly name: string
  /** `null` — «это не наш тип»: пишется `Issue`, чтение продолжается. */
  decode(raw: Vary): T | null
  /** Бросает только на том, что не выражается типом (`t.pattern`). */
  encode(value: T): Vary
  /** Назначить «пустое» значение и тем превратить `Cast` в `Type`. */
  or(blank: T): Type<T>
}

/** `Cast` с определённым «пустым» значением. Только такой годится для `atom`. */
export interface Type<T> extends Cast<T> {
  readonly blank: T
}

/**
 * Внутренняя форма линзы: поля объявлены ВСЕ и всегда, включая `blank`.
 *
 * Один шейп на все линзы — правило 1 горячего пути: `type.decode` на чтении поля
 * обязан быть мономорфным, а объект без `blank` и объект с `blank` это два
 * скрытых класса. Отсутствие «пустого» выражено значением `undefined`, и оно же
 * — единственный сентинел «аргумента не было» (правило 3). `null` сентинелом
 * тут быть не может: у `t.maybe` он законное `blank`.
 */
interface Lens<T> {
  readonly name: string
  readonly blank: T | undefined
  decode(raw: Vary): T | null
  encode(value: T): Vary
  or(blank: T): Type<T>
}

function lens<T>(
  name: string,
  blank: T | undefined,
  decode: (raw: Vary) => T | null,
  encode: (value: T) => Vary,
): Lens<T> {
  return {
    name,
    blank,
    decode,
    encode,
    // Новая линза, а не мутация: описание типа создаётся один раз при объявлении
    // схемы, поэтому аллокация здесь холодная, а разделяемый `t.string` обязан
    // остаться без `blank` после чужого `.or()`.
    or: (next: T): Type<T> => lens(name, next, decode, encode) as Type<T>,
  }
}

/** Значение как есть: примитивы `Vary` кодируются собой. */
function asIs<T>(value: T): Vary {
  return value as unknown as Vary
}

/** Пустые байты — одна константа на модуль (правило 7 горячего пути). */
const NO_BYTES = new Uint8Array(0)
const NO_ITEMS: readonly never[] = Object.freeze([])
const NO_FIELDS: Readonly<Record<string, never>> = Object.freeze({})

/** Простой объект `Vary`, а не массив, байты и не дата. */
function isPlain(raw: Vary): raw is { readonly [key: string]: Vary } {
  return typeof raw === 'object'
    && raw !== null
    && !Array.isArray(raw)
    && !(raw instanceof Uint8Array)
    && !(raw instanceof Date)
}

/**
 * Набор линз на все случаи схемы.
 *
 * @example
 * ```ts
 * atom(t.string)                                // ок: у строки есть blank ''
 * atom(t.enum(['draft', 'live']))               // ← ОШИБКА КОМПИЛЯЦИИ
 * atom(t.enum(['draft', 'live']).or('draft'))   // хочу дефолт — назови его
 * atom(t.maybe(t.enum(['draft', 'live'])))      // хочу различать отсутствие — вот null
 * ```
 */
export const t = {
  /** Строка. `blank` — пустая строка. */
  string: lens<string>('string', '', raw => (typeof raw === 'string' ? raw : null), asIs) as Type<string>,

  /**
   * Число. `blank` — `0`, а НЕ `NaN`: у baza `float.default` был `NaN`, и любое
   * арифметическое выражение над непрочитанным полем становилось `NaN`, молча
   * заражая весь расчёт.
   */
  number: lens<number>('number', 0, raw => (typeof raw === 'number' ? raw : null), asIs) as Type<number>,

  /** Целое. Дробное не читается и не пишется: на записи бросает. */
  int: lens<number>(
    'int',
    0,
    raw => (typeof raw === 'number' && Number.isInteger(raw) ? raw : null),
    value => {
      if (!Number.isInteger(value)) throw new TypeError(`t.int: ${value} is not an integer`)
      return value
    },
  ) as Type<number>,

  bool: lens<boolean>('bool', false, raw => (typeof raw === 'boolean' ? raw : null), asIs) as Type<boolean>,

  /**
   * Целое произвольной длины. Отдельно от `number` не для красоты: у `$mol_vary`
   * малый неотрицательный bigint уезжал тем же тегом `uint`, и записанный `0n`
   * читался числом `0` (реестр, п. 40). У нашего кодека это разные байты, и
   * линза обязана держать разницу на своей стороне тоже.
   */
  bigint: lens<bigint>('bigint', 0n, raw => (typeof raw === 'bigint' ? raw : null), asIs) as Type<bigint>,

  /**
   * Байты. `blank` — общий пустой массив: писать в него нельзя, длина нулевая,
   * и заводить новый на каждое непрочитанное поле было бы аллокацией на пустом
   * месте.
   */
  bytes: lens<Uint8Array>(
    'bytes',
    NO_BYTES,
    raw => (raw instanceof Uint8Array ? raw : null),
    asIs,
  ) as Type<Uint8Array>,

  /** Дата. Естественного «пустого» у неё нет — отсюда `Cast`, а не `Type`. */
  date: lens<Date>('date', undefined, raw => (raw instanceof Date ? raw : null), asIs) as Cast<Date>,

  /**
   * Ссылка. Пока едет байтами: расширение `Link` в `Vary` зарезервировано
   * (`vary.ts`, расширение №4), и до его появления линза читает байты ссылки, а
   * не саму ссылку. Разбор текста тоже принимается — но через `try`, потому что
   * `Link.parse` бросает, а чтение бросать не имеет права.
   */
  link: lens<Link>(
    'link',
    undefined,
    raw => {
      if (raw instanceof Uint8Array) {
        try {
          return Link.from(raw)
        } catch {
          return null
        }
      }
      if (typeof raw !== 'string') return null
      try {
        return Link.parse(raw)
      } catch {
        return null
      }
    },
    value => value.bin,
  ) as Cast<Link>,

  /**
   * Перечисление. Неизвестный член → `null` + `Issue`, никакой подстановки
   * первого варианта: узел новой версии не имеет права протащить своё значение
   * в наш тип через молчание (реестр, п. 26).
   */
  enum<const M extends readonly Key[]>(members: M): Cast<M[number]> {
    // Множество, а не `includes`: перечисление на два десятка членов читается на
    // каждом декоде поля, а `Set.has` не зависит от длины.
    const known = new Set<Key>(members)
    return lens<M[number]>(
      `enum(${members.join('|')})`,
      undefined,
      raw => ((typeof raw === 'string' || typeof raw === 'number') && known.has(raw) ? (raw as M[number]) : null),
      asIs,
    ) as Cast<M[number]>
  },

  /**
   * «Значения нет» как ЗАКОННОЕ значение. `blank` — `null`, и это единственный
   * способ отличить «не заполняли» от «пусто» на уровне типа (docs/05 §7.7).
   */
  maybe<T>(inner: Cast<T>): Type<T | null> {
    return lens<T | null>(
      `maybe(${inner.name})`,
      null,
      raw => (raw === null ? null : inner.decode(raw)),
      value => (value === null ? null : inner.encode(value)),
    ) as Type<T | null>
  },

  /** Строка по образцу. На записи бросает: типом «строка вида X» не выражается. */
  pattern(re: RegExp, name?: string): Cast<string> {
    // Копия БЕЗ `g`/`y`: у глобальной регулярки `test` двигает `lastIndex`, и
    // одна и та же строка через раз перестала бы проходить проверку. Ошибка
    // ловится не тестом, а жалобой пользователя «через раз не сохраняется».
    const fixed = new RegExp(re.source, re.flags.replace(/[gy]/g, ''))
    const label = name ?? `pattern(${re.source})`
    return lens<string>(
      label,
      undefined,
      raw => (typeof raw === 'string' && fixed.test(raw) ? raw : null),
      value => {
        if (!fixed.test(value)) throw new TypeError(`t.${label}: «${value}» does not match ${re.source}`)
        return value
      },
    ) as Cast<string>
  },

  /** Число в границах включительно. На записи бросает. */
  range(min: number, max: number): Cast<number> {
    return lens<number>(
      `range(${min}..${max})`,
      undefined,
      raw => (typeof raw === 'number' && raw >= min && raw <= max ? raw : null),
      value => {
        if (!(value >= min && value <= max)) throw new RangeError(`t.range: ${value} outside [${min}, ${max}]`)
        return value
      },
    ) as Cast<number>
  },

  /**
   * Массив ЦЕЛИКОМ в одном юните. Не путать с `list()`: внутри нет слияния,
   * два пира, поправившие разные элементы, затрут друг друга по LWW.
   *
   * Один негодный элемент делает негодным весь массив. Молча выбрасывать
   * элементы нельзя: «пришло 5, прочитали 4» — это тихая потеря данных, а
   * `Issue` о ней не расскажет, потому что чтение формально удалось.
   */
  array<T>(item: Cast<T>): Type<readonly T[]> {
    return lens<readonly T[]>(
      `array(${item.name})`,
      NO_ITEMS,
      raw => {
        if (!Array.isArray(raw)) return null
        const source = raw as readonly Vary[]
        const out: T[] = []
        for (let i = 0; i < source.length; i++) {
          const value = item.decode(source[i] as Vary)
          if (value === null) return null
          out.push(value)
        }
        return out
      },
      value => {
        const out: Vary[] = []
        for (let i = 0; i < value.length; i++) out.push(item.encode(value[i] as T))
        return out
      },
    ) as Type<readonly T[]>
  },

  /** Словарь строка → значение ЦЕЛИКОМ в одном юните. Не путать с `dict()`. */
  record<T>(value: Cast<T>): Type<Readonly<Record<string, T>>> {
    return lens<Readonly<Record<string, T>>>(
      `record(${value.name})`,
      NO_FIELDS,
      raw => {
        if (!isPlain(raw)) return null
        const out: Record<string, T> = {}
        for (const key of Object.keys(raw)) {
          const item = value.decode(raw[key] as Vary)
          if (item === null) return null
          out[key] = item
        }
        return out
      },
      source => {
        const out: Record<string, Vary> = {}
        for (const key of Object.keys(source)) out[key] = value.encode(source[key] as T)
        return out
      },
    ) as Type<Readonly<Record<string, T>>>
  },
}
