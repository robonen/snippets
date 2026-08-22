// ─── `cast`: другой ВИД на те же юниты ───────────────────────────────────────
//
// docs/05 §1.7 и §3.11. Ни одного обращения к данным и ни одного нового юнита:
// `cast` — это новая ручка на ту же координату, два `Map.get` на тёплом пути.
//
// ПОЧЕМУ это вообще возможно. В ленде нет «вида»: документ — это узел, чьи дети
// суть ключевые юниты, а `tag` (`term`/`solo`/`vals`/`keys`) остаётся ПОДСКАЗКОЙ,
// а не дискриминатором — ни один читатель по нему не диспетчеризуется
// (docs/05 §3.9). Атом берёт первого живого ребёнка, список — всех, словарь —
// всех и читает их значения как ключи. Сделай тег дискриминатором — и `cast`
// станет ложью: правка текста, которая строит патч через список токенов,
// перестанет работать.
//
// ─── Что «бесплатно» НЕ значит ───────────────────────────────────────────────
//
// Честно записано в docs/05 §7.10: бесплатно по ДАННЫМ, не по кэшу. Читая одно
// поле и текстом, и списком, получаем два независимых файбера на одну голову —
// данные не дублируются, кэш дублируется. И `cast` ничего не проверяет:
// `cast(post.body, dict(t.string, t.int))` даст словарь с бессмысленными ключами
// и не пожалуется. «Бесплатно» и «безопасно» — разные обещания, выполнено первое.

import { computed, type KeyedComputedRef } from '@sync/fiber'
import { ROOT } from '../land/view'
import { channelFor } from './binding'
import { type Chan, type Doc, type Handle, type Head, SPOT } from './channel'
import { CELL, type Cell, cellOf } from './cell'
import type { Field } from './field'
import { ModelError } from './issue'
import { readerFor, methodsFor, writerFor } from './kinds'
import { type AnyModel, modelOf } from './model'
import { nestSlot } from './nest'
import type { ModelName } from './registry'
import type { SpaceCore } from './space'

/**
 * Что можно перевести в другой вид: канал поля или документ целиком.
 *
 * Документ приходит объектом каналов, а не ручкой: `Doc` не несёт `SPOT` сам —
 * его несёт `$`.
 */
export type CastFrom = Handle | { readonly $: Handle }

/**
 * Другой ВИД на те же юниты. Ноль миграции данных.
 *
 * @example
 * ```ts
 * cast(post.body, list(t.string))()     // токены текста как список
 * cast(post.author, atom(t.maybe(t.link)))()  // ссылка как сырой адрес
 * cast(post.stats, Comment).body()      // тот же head, другая модель
 * ```
 */
export function cast<F extends Field>(from: CastFrom, as: F): Chan<F>
export function cast<N extends ModelName>(from: CastFrom, as: AnyModel<N> | N): Doc<N>
export function cast(from: CastFrom, as: Field | AnyModel<ModelName> | ModelName): unknown {
  const site = siteOf(from)

  if (typeof as === 'string' || 'schema' in as) {
    const model = typeof as === 'string' ? modelFor(as) : as
    // Документ по ТОЙ ЖЕ голове: `cast(post.stats, Comment)` и `post.stats()`
    // обязаны смотреть в один узел, иначе «другой вид на те же юниты» неправда.
    //
    // Слот считается ТОЛЬКО здесь. Виду поля он не нужен вовсе — у ад-хок ячейки
    // свой канал `slot` с той же формулой, — а посчитать его заранее значило бы
    // подписать вызывающего на состав детей документа: `cast` внутри `computed`
    // начал бы пересчитываться от появления соседнего поля. Замер той же правки:
    // `cast/warm` 42.8 → 23.0 нс при поле 9.1 (отрыв от пола ×4.7 → ×2.5).
    const slot = site.cell === null ? site.head : nestSlot(site.core, site.cell, site.head)
    return site.core.space.doc(model as AnyModel<ModelName>, slot) as unknown as object
  }

  if (site.key === '' && site.head === ROOT) {
    // ROOT служит и головой ленда, и сентинелом «поля ещё нет» (`cell.slot`), а
    // значит вид на КОРНЕВОЙ документ неотличим от пустого слота и молча читался
    // бы пустым. Молчание тут — то же, за что в реестре числятся пп. 27 и 35,
    // поэтому отказ громкий.
    throw new ModelError(
      'cast: вид на корневой документ ленда неотличим от пустого слота — ROOT занят сентинелом. Переводите поле, а не корень',
      'cast',
    )
  }

  return channelFor(site.core, specCell(site.core, site.key, as), site.head)
}

/** Координата, к которой привязан вид. */
interface Site {
  readonly core: SpaceCore
  /** Голова, по которой мультиплексируется ячейка вида. */
  readonly head: Head
  /** Имя поля; `''` — вид на документ целиком. */
  readonly key: string
  /** Ячейка исходного канала; `null` — переводят документ целиком. */
  readonly cell: Cell | null
}

function siteOf(from: CastFrom): Site {
  const own = (from as Partial<Handle>)[SPOT]

  // Канал поля: у него есть ячейка, а в ней — ядро.
  if (own !== undefined && own.field !== '') {
    const cell = cellOf(from as Handle)
    return { core: cell.core, head: own.head, key: cell.key, cell }
  }

  const ops = (from as { readonly $?: Handle }).$
  if (ops === undefined) {
    throw new ModelError(
      'cast: `$` не несёт ни ячейки, ни ядра — переводите сам документ (cast(post, …)), а не post.$',
      'cast',
    )
  }

  return { core: coreOfDoc(from as object), head: ops[SPOT].head, key: '', cell: null }
}

/**
 * Ядро документа — через любой его канал.
 *
 * `$` собирается в `ops.ts` и ячейки не несёт, а ядро документу нужно ровно
 * одно на все каналы: ленд у них общий. Обход своих ключей стоит столько же,
 * сколько один `Map.get`, и происходит на холодном пути — в `cast`, а не в чтении.
 */
function coreOfDoc(doc: object): SpaceCore {
  const keys = Object.keys(doc)
  for (let i = 0; i < keys.length; i++) {
    const channel = (doc as Record<string, unknown>)[keys[i] as string]
    const cell = typeof channel === 'function'
      ? (channel as unknown as Record<symbol, Cell | undefined>)[CELL]
      : undefined
    if (cell !== undefined) return cell.core
  }
  throw new ModelError('cast: у документа нет ни одного канала — ленд брать неоткуда', 'cast')
}

/**
 * Ячейка ad-hoc спеки: пара каналов на (ядро × спека × имя поля).
 *
 * Мемо по ОБЪЕКТУ спеки, а не по её содержимому: спека создаётся один раз — в
 * объявлении модели или в модульной константе, — поэтому это `Map.get`, а не
 * аллокация. Спека, собранная прямо в аргументе (`cast(x, list(t.string))` в
 * цикле), заведёт по ячейке на вызов — и это ровно та цена, о которой говорит
 * §7.10: платится кэшем, не данными.
 */
function specCell(core: SpaceCore, key: string, spec: Field): Cell {
  let byCore = specs.get(core)
  if (byCore === undefined) {
    byCore = new Map()
    specs.set(core, byCore)
  }

  let byKey = byCore.get(spec)
  if (byKey === undefined) {
    byKey = new Map()
    byCore.set(spec, byKey)
  }

  const found = byKey.get(key)
  if (found !== undefined) return found

  const fresh = makeSpecCell(core, key, spec)
  byKey.set(key, fresh)
  return fresh
}

const specs = new WeakMap<SpaceCore, Map<Field, Map<string, Cell>>>()

/**
 * Та же сборка, что у схемной ячейки (`binding.ts`, `makeCell`), с одним
 * отличием: у вида на ДОКУМЕНТ слот — сама голова, а не запись в `keyIndex`.
 *
 * Повторение сборки вынужденное: `makeCell` приватен, а вынести его наружу — это
 * правка основания, на котором параллельно стоят ещё двое.
 */
function makeSpecCell(core: SpaceCore, key: string, spec: Field): Cell {
  const read = readerFor(spec.kind)
  const write = writerFor(spec.kind)

  const slot: KeyedComputedRef<Head, Head> = key === ''
    // Вид на документ: данные лежат прямо под головой. Канал без зависимостей —
    // пересчитан не будет никогда.
    ? computed.keyed((head: Head) => head)
    : computed.keyed((head: Head) => core.keyIndex(head).get(key) ?? ROOT)

  const cell: Cell = {
    core,
    // `null` — у ad-hoc спеки документа нет, поэтому identity канала держит
    // собственная карта `channels` (см. `channelFor`).
    bind: null,
    key,
    field: spec,
    slot,
    value: undefined as unknown as KeyedComputedRef<Head, unknown>,
    methods: methodsFor(spec.kind),
    channels: new Map(),
  }

  cell.value = computed.keyed({
    get: (head: Head) => read(core, cell, head),
    set: (head: Head, next: unknown) => {
      write(core, cell, head, next)
    },
  })

  return cell
}

function modelFor(name: ModelName): AnyModel {
  const found = modelOf(name)
  if (found === undefined) {
    throw new ModelError(
      `модель «${name}» не объявлена в этом процессе: импортируйте файл с её model(...)`,
      'cast',
    )
  }
  return found
}
