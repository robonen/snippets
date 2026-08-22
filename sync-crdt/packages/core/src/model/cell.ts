// v8:hot — здесь лежит форма ячейки поля и разрешение слота, то есть то, через
// что проходит каждое чтение и каждая запись модели.
//
// ─── Решение Р2: кэш живёт в ОПИСАНИИ ПОЛЯ, а не в сущности ──────────────────
//
// Два `computed.keyed` на (модель × поле × ленд), ключ — голова документа.
// Непрочитанное поле не стоит НИЧЕГО на сущность; поле, прочитанное у 10 000
// документов, — это записи в двух Map, а не 10 000 файберов. Замер ADR-016
// показал, что память определяется ЧИСЛОМ ПОДПИСОК, а не представлением: разрыв
// представлений 163 Б против цены подписки +613…+803 Б.
//
// ─── Решение Р3: два канала, `slot` и `value` ────────────────────────────────
//
// `slot` отвечает «где лежит», `value` — «что там». Появление СОСЕДНЕГО поля
// меняет состав детей документа, поэтому пересчитывается `slot` — и возвращает
// ТУ ЖЕ голову; распространение гасится сравнением результата в `Fiber.put`, и
// значение не декодируется вовсе. Слей их в один канал — и первая запись в
// соседнее поле стоила бы скан плюс декод у всех прочитанных полей документа.
// Плата честно записана в docs/05 §7.4: вдвое больше файберов на ПРОЧИТАННОЕ
// поле.

import { untracked } from '@sync/fiber'
import type { KeyedComputedRef } from '@sync/fiber'
import type { SandTag } from '../binary/unit'
import { ROOT, type SandView } from '../land/view'
import { predictKey } from './address'
import type { Handle, Head } from './channel'
import { SPOT } from './channel'
import type { Field, FieldKind } from './field'
import type { AnyModel } from './model'
import { mountNest } from './nest'
import type { SpaceCore } from './space'

/**
 * Ключ ячейки на канале.
 *
 * Присваивание символьного свойства, а не поиск по реестру: методам канала нужна
 * их ячейка, а `WeakMap.set` стоит 623 нс против 4 нс у присваивания (реестр,
 * п. 17). `Object.defineProperty` — 120 нс, тоже мимо.
 */
export const CELL: unique symbol = Symbol('sync.cell')

/**
 * Псевдо-поле производного канала.
 *
 * unsafe: `'derive'` не входит в `FieldKind` и наружу не попадает — производное
 * поле объявляется третьим аргументом `model()`, а не в схеме. Отдельный вид
 * нужен только затем, чтобы ячейка производного имела ТУ ЖЕ форму, что ячейка
 * схемного поля: два шейпа на `cell.field.kind` стоили бы полиморфной загрузки
 * на общем пути.
 */
export const DERIVED: Field = Object.freeze({ kind: 'derive' as FieldKind })

/** Ячейка поля: два канала, таблица методов и карта каналов по голове. */
export interface Cell {
  readonly core: SpaceCore
  /**
   * Привязка, которой ячейка принадлежит; `null` — ячейка ad-hoc спеки из
   * `cast()`, у которой документа нет.
   *
   * Различие несёт цену: у схемной ячейки identity канала уже обеспечена
   * мемоизацией ДОКУМЕНТА (`post.title` — это свойство одного и того же объекта),
   * поэтому вторая карта «голова → канал» ей не нужна вовсе. Первая редакция
   * держала её и платила 8 `Map.set` на открытие документа и 8 записей карты на
   * его память: `doc/open` 2.29 мкс при бюджете 1.00, `doc/mem` 2528 Б при 2048.
   */
  readonly bind: Binding | null
  readonly key: string
  readonly field: Field
  /** Голова документа → `self` ключевого юнита; {@link ROOT} — поля ещё нет. */
  readonly slot: KeyedComputedRef<Head, Head>
  /** Голова документа → готовое значение поля. */
  value: KeyedComputedRef<Head, unknown>
  /** Таблица методов канала: ОДНА на (модель, поле). Копируется одним `Object.assign`. */
  readonly methods: Readonly<Record<string, unknown>>
  /** Голова → канал: identity для ad-hoc спек `cast()`. У схемной ячейки пуста. */
  readonly channels: Map<Head, Handle>
}

export interface Binding {
  readonly core: SpaceCore
  readonly model: AnyModel
  /** Плотный массив, порядок = порядок ключей схемы. Форма хендла отсюда. */
  readonly cells: readonly Cell[]
  readonly docs: Map<Head, object>
}

export type Reader = (core: SpaceCore, cell: Cell, head: Head) => unknown
export type Writer = (core: SpaceCore, cell: Cell, head: Head, next: unknown) => void

/** Ячейка канала. Бросает на отвязанном методе — это цена решения Р4. */
export function cellOf(handle: Handle): Cell {
  // Проверка на `null`/`undefined` ОТДЕЛЬНАЯ: отвязанный метод (`const {set} =
  // post.title`) приходит сюда с `this === undefined`, и без неё сообщением
  // было бы «Cannot read properties of undefined» — то есть ровно ничего.
  const cell = handle === undefined || handle === null
    ? undefined
    : (handle as unknown as Record<symbol, Cell | undefined>)[CELL]
  if (cell === undefined) {
    throw new TypeError(
      'метод канала вызван без приёмника: `const {push} = post.tags` отвязывает его — зовите `post.tags.push(...)`',
    )
  }
  return cell
}

/** Голова документа, которому принадлежит канал. */
export function headOf(handle: Handle): Head {
  return handle[SPOT].head
}

/**
 * Подсказка о том, что лежит под ключевым юнитом.
 *
 * `tag` остаётся ПОДСКАЗКОЙ, а не дискриминатором: ни один читатель по нему не
 * диспетчеризуется (docs/05 §3.9). Сделай тег дискриминатором — и `cast` между
 * видами перестанет работать, потому что вид перестанет быть свойством ЧТЕНИЯ.
 */
export function tagOf(field: Field): SandTag {
  const kind = field.kind
  if (kind === 'list' || kind === 'links' || kind === 'text') return 'vals'
  if (kind === 'dict' || kind === 'parts' || kind === 'index') return 'keys'
  return 'solo'
}

/**
 * Материализовать ключевой юнит поля. Идемпотентно: если он есть — ничего не пишет.
 *
 * Ключ ложится в КОНЕЦ. У baza `dive` шёл через `add` с `lead = hole`, и порядок
 * ключей выходил ОБРАТНЫМ вставке — побочный эффект якоря, не заявленный в
 * контракте (реестр, п. 29). Здесь порядок — часть контракта и предмет теста.
 *
 * Первым делом достраивается цепочка родителей (`nest.ts`): голова, в которую
 * пишут, может оказаться ВЛОЖЕННОЙ ЧАСТЬЮ, чей собственный ключевой юнит ещё не
 * материализован — `part` читается без записи и потому оставляет его на первую
 * запись внутрь себя. Без этой строки юниты части висели бы на узле, которого
 * нет ни у одной головы в детях, и `post.$.drop()` оставлял бы их сиротами.
 */
export function mountSlot(core: SpaceCore, head: Head, key: string, field: Field): Head {
  mountNest(core, head)

  // `untracked` обязателен: запись не имеет права подписывать пишущего на то,
  // что он сам меняет, иначе эффект будит сам себя своей же правкой.
  const found = untracked(() => core.keyIndex(head)).get(key)
  if (found !== undefined) return found

  const kids = untracked(() => core.order(head))
  const lead = kids.length === 0 ? ROOT : (kids[kids.length - 1] as SandView).self
  const self = predictKey(core.land, core.salt, head, key)
  core.post(head, lead, self, key, tagOf(field))
  return self
}

/** Первый живой ребёнок слота — то, что атом считает своим значением. */
export function firstOf(core: SpaceCore, slot: Head): SandView | null {
  if (slot === ROOT) return null
  return (core.order(slot)[0] as SandView | undefined) ?? null
}
