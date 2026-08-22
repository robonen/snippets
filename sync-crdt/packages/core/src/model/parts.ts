// Вложенные документы по ключу и по пути: `parts` и `index`.
//
// ─── Почему они здесь, а не в `dict.ts` ──────────────────────────────────────
//
// Граница по оси изменения (PRINCIPLES, правило 3): в `dict.ts` под ключом лежит
// ЗНАЧЕНИЕ, здесь — ДОКУМЕНТ. Разметка одна и та же (ключевой юнит, его `self` —
// голова содержимого), а вот что кэшируется — разное, и это единственное
// содержательное различие видов.
//
// ─── Где здесь кэш (решение Р2) ──────────────────────────────────────────────
//
// У `dict` `cell.value` держит значение под ключом. У `parts` и `index` держать
// там нечего: результат `x(key)` — это ДОКУМЕНТ, а он уже мемоизирован по
// идентичности в `bind.docs` (docs/05 §3.12), и второй кэш поверх него дал бы
// две записи на один объект. Поэтому `cell.value` этих видов ключуется слотом
// УРОВНЯ и держит набор его ключей — то единственное, что стоит считать один раз
// и переиспользовать: у `index` этот же канал обслуживает `keys(prefix)` на
// ЛЮБОЙ глубине, потому что уровень индекса от уровня ничем не отличается.
//
// ─── Чего здесь ещё нет ──────────────────────────────────────────────────────
//
// `born` принимается и игнорируется: `area` и `land` — это гранулярность
// синхронизации (docs/05 §5), а Tine и Area в `order()` объявлены работой S3.5
// (docs/05 §10). Параметр в сигнатуре стоит уже сейчас потому, что место
// рождения объявляется В СХЕМЕ, и добавить его потом значило бы менять схемы
// приложений, а не реализацию.

import { untracked } from '@sync/fiber'
import { ROOT, type SandView } from '../land/view'
import { openDoc } from './binding'
import { type Cell, cellOf } from './cell'
import { type Handle, type Head, SPOT } from './channel'
import { keyedChannel, keySlot, mountField, mountKey, readKeysAt } from './dict'
import type { Born, Depth, IndexField, PartsField } from './field'
import { ModelError } from './issue'
import { modelOf } from './model'
import type { SpaceCore } from './space'
import type { Key } from './value'

const NO_KEYS: readonly Key[] = Object.freeze([])

/**
 * Ключевой юнит вложенного документа несёт `keys`, а не `solo`.
 *
 * `tag` — подсказка, а не дискриминатор (docs/05 §3.9): по нему никто не
 * диспетчеризуется, но потерять его нельзя — `Land.move` и `Land.remove`
 * переносят его на новую версию узла, и живой документ, переехавший внутри
 * списка, иначе объявлялся бы атомом.
 */
const NEST_TAG = 'keys' as const

function modelAt(core: SpaceCore, name: string, head: Head, at: string): object {
  const model = modelOf(name)
  if (model === undefined) {
    throw new ModelError(
      `модель «${name}» не объявлена в этом процессе: импортируйте файл с её model(...)`,
      at,
    )
  }
  return openDoc(core, model, head)
}

/**
 * Читатель `parts` и `index`: ключи УРОВНЯ, а не значения.
 *
 * Ключ канала — слот уровня, поэтому один и тот же канал обслуживает и корень
 * поля, и любую промежуточную ветку индекса.
 */
export function readKeys(core: SpaceCore, cell: Cell, slot: Head): unknown {
  return readKeysAt(core, cell, slot)
}

/** У `parts` и `index` записи через `cell.value` нет: под ключом лежит документ. */
export function writeNest(_core: SpaceCore, cell: Cell, _slot: Head, _next: unknown): never {
  throw new ModelError(
    `поле «${cell.key}» вида «${cell.field.kind}» не пишется целиком: пишите в поля вложенного документа`,
    'parts.write',
  )
}

// ── parts ────────────────────────────────────────────────────────────────────

/**
 * Часть по ключу. Есть ВСЕГДА — поэтому `Doc`, а не `Doc | null`.
 *
 * Ключевой юнит материализуется ПРИ ОБРАЩЕНИИ, и это не «чтение, которое пишет»:
 * `x(key)` возвращает не данные, а ручку на адрес, и адрес этот контентный —
 * повторное обращение к тому же ключу не рождает ни одного юнита. Отложить
 * монтирование до первой записи в документ нечем: писать будет ЕГО поле, которое
 * про родителя не знает, и ключ не появился бы в `keys()` вовсе — то есть
 * `post.comments('c1').body('!')` из docs/05 §2.5 оставил бы словарь пустым.
 *
 * Проверка без создания называется отдельным словом — `has(key)`.
 *
 * Разрешение идёт БЕЗ подписки: адрес детерминирован, а зависимость от данных
 * возникает там, где данные и читают, — в полях вложенного документа.
 */
function partsBody(core: SpaceCore, cell: Cell, head: Head, key: unknown, next: unknown): unknown {
  if (next !== undefined) {
    throw new ModelError(
      `поле «${cell.key}»: у части нет записи целиком — пишите в её поля, например x(${String(key)}).title(…)`,
      'parts.write',
    )
  }
  const at = untracked(() => mountKey(core, mountField(core, cell, head), key as Key, NEST_TAG))
  return modelAt(core, (cell.field as PartsField<Key, never>).of, at, 'parts')
}

export function partsChannel(core: SpaceCore, cell: Cell, head: Head): Handle {
  return keyedChannel(core, cell, head, partsBody)
}

export const PARTS_METHODS: Readonly<Record<string, unknown>> = Object.freeze({
  /** Ключи в порядке ВСТАВКИ (реестр, п. 29). Кэшируются `cell.value` уровня. */
  keys(this: Handle): readonly Key[] {
    const cell = cellOf(this)
    const slot = cell.slot(this[SPOT].head)
    if (slot === ROOT) return NO_KEYS
    return cell.value(slot) as readonly Key[]
  },

  size(this: Handle): number {
    const cell = cellOf(this)
    const slot = cell.slot(this[SPOT].head)
    if (slot === ROOT) return 0
    return (cell.value(slot) as readonly Key[]).length
  },

  /** Проверка БЕЗ создания — в отличие от `x(key)`. */
  has(this: Handle, key: Key): boolean {
    const cell = cellOf(this)
    return keySlot(cell.core, cell, this[SPOT].head, key) !== ROOT
  },

  delete(this: Handle, key: Key): void {
    const cell = cellOf(this)
    const core = cell.core
    const at = untracked(() => keySlot(core, cell, this[SPOT].head, key))
    if (at !== ROOT) core.remove(at)
  },

  clear(this: Handle): void {
    const cell = cellOf(this)
    const core = cell.core
    const slot = untracked(() => cell.slot(this[SPOT].head))
    if (slot === ROOT) return
    // Копия: `remove` бьёт сигнал формы головы, а мы идём по её же выдаче.
    const kids = untracked(() => core.order(slot)).slice()
    for (let i = 0; i < kids.length; i++) core.remove((kids[i] as SandView).self)
  },
})

// ── index ────────────────────────────────────────────────────────────────────

function depthOf(cell: Cell): Depth {
  return (cell.field as IndexField<Depth, never>).depth
}

/**
 * Путь обязан быть ровно объявленной глубины.
 *
 * Типом это уже запрещено (`PathAt<D>` — кортеж), и проверка стоит здесь для
 * тех, кто пришёл из JS: путь короче глубины молча вернул бы ВЕТКУ вместо
 * документа, а это самый неприятный вид ошибки — правдоподобный.
 */
function pathOf(cell: Cell, path: unknown): readonly Key[] {
  const depth = depthOf(cell)
  if (!Array.isArray(path) || path.length !== depth) {
    const got = Array.isArray(path) ? `${path.length}` : typeof path
    throw new ModelError(
      `поле «${cell.key}»: индекс глубины ${depth} ждёт путь из ${depth} ключей, пришло ${got}`,
      'index.path',
    )
  }
  return path as readonly Key[]
}

/** Слот уровня по префиксу. `ROOT` — ветки нет; НИЧЕГО не создаётся. */
function walkTo(core: SpaceCore, cell: Cell, head: Head, path: readonly Key[], upto: number): Head {
  let slot = cell.slot(head)
  for (let i = 0; i < upto; i++) {
    if (slot === ROOT) return ROOT
    const at = core.keyIndex(slot).get(String(path[i]))
    if (at === undefined) return ROOT
    slot = at
  }
  return slot
}

function indexBody(core: SpaceCore, cell: Cell, head: Head, path: unknown, next: unknown): unknown {
  if (next !== undefined) {
    throw new ModelError(
      `поле «${cell.key}»: индекс не пишется целиком — заводите ветку через ensure(path)`,
      'index.write',
    )
  }
  const keys = pathOf(cell, path)
  // Чтение НИЧЕГО не создаёт — в отличие от `ensure`. Именно это и проверяет
  // новый кейс корпуса «чтение отсутствующей ветки не создаёт юнитов»
  // (docs/05 §8.1, `empire.test.ts` 1 → 3).
  const at = walkTo(core, cell, head, keys, keys.length)
  if (at === ROOT) return null
  return modelAt(core, (cell.field as IndexField<Depth, never>).of, at, 'index')
}

export function indexChannel(core: SpaceCore, cell: Cell, head: Head): Handle {
  return keyedChannel(core, cell, head, indexBody)
}

export const INDEX_METHODS: Readonly<Record<string, unknown>> = Object.freeze({
  /** Ключи уровня под префиксом. Пустой префикс — верхний уровень. */
  keys(this: Handle, prefix: readonly Key[]): readonly Key[] {
    const cell = cellOf(this)
    const core = cell.core
    const depth = depthOf(cell)
    if (!Array.isArray(prefix) || prefix.length >= depth) {
      throw new ModelError(
        `поле «${cell.key}»: префикс индекса глубины ${depth} — от 0 до ${depth - 1} ключей`,
        'index.keys',
      )
    }
    const slot = walkTo(core, cell, this[SPOT].head, prefix, prefix.length)
    if (slot === ROOT) return NO_KEYS
    return cell.value(slot) as readonly Key[]
  },

  /**
   * Завести ветку и документ. Идемпотентно: адреса всех уровней контентные,
   * поэтому два пира, вызвавшие `ensure` на одном пути, сходятся к одному
   * документу, а не к двум (реестр, п. 30).
   */
  ensure(this: Handle, path: readonly Key[], born?: Born): unknown {
    const cell = cellOf(this)
    const core = cell.core
    const keys = pathOf(cell, path)
    void born
    let slot = mountField(core, cell, this[SPOT].head)
    for (let i = 0; i < keys.length; i++) {
      slot = mountKey(core, slot, keys[i] as Key, NEST_TAG)
    }
    return modelAt(core, (cell.field as IndexField<Depth, never>).of, slot, 'index.ensure')
  },

  /** Надгробие на ЛИСТ пути. Промежуточные ветки остаются: их делят соседи. */
  delete(this: Handle, path: readonly Key[]): void {
    const cell = cellOf(this)
    const core = cell.core
    const keys = pathOf(cell, path)
    const at = untracked(() => walkTo(core, cell, this[SPOT].head, keys, keys.length))
    if (at !== ROOT) core.remove(at)
  },
})
