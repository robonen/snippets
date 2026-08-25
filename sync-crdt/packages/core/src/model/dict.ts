// v8:hot — `readKey` лежит под каждым `post.reactions('👍')`, то есть под тем же
// горячим путём, что и чтение атома.
//
// ─── Что такое словарь (docs/05 §3.9) ────────────────────────────────────────
//
// Документ — это узел, чьи дети суть КЛЮЧЕВЫЕ ЮНИТЫ: значение такого юнита есть
// имя ключа, а его `self` служит головой для содержимого. Отсюда всё остальное:
// `dict` — это `list`, где значение элемента читается как ключ, а под ключом
// лежит атом; `parts` — тот же `dict`, где поддерево ключа открывается как
// документ; переименование ключа сохраняет поддерево, потому что `self` не
// меняется.
//
// ─── Где здесь кэш (решение Р2) ──────────────────────────────────────────────
//
// `cell.value` словаря ключуется НЕ головой документа, а `self` КЛЮЧЕВОГО ЮНИТА
// — он тоже плотный номер узла, то есть законный примитивный ключ, и ни одной
// конкатенации по-прежнему нет (правило 3 горячего пути этого слоя). Пара
// (голова, ключ) сводится к одному числу двумя чтениями, которые и так лежат на
// пути: `cell.slot(head)` и `keyIndex(slot)`. Оба уже кэшированы, поэтому вторая
// карта «ключ → значение» слою не нужна вовсе.
//
// Кэшируется именно ЗНАЧЕНИЕ, а не набор ключей: `dict(key)` — это обычное
// чтение поля из разметки, а `keys()` — операция над коллекцией. У `parts` и
// `index` выбор обратный, и по той же причине — см. `parts.ts`.
//
// ─── Что здесь исправлено против baza ────────────────────────────────────────
//
// п. 29: порядок ключей у baza обратен вставке (`dive` → `add` → `lead = hole`) и
//        нигде не заявлен. Здесь ключ всегда в КОНЕЦ, порядок — часть контракта
//        и предмет теста (docs/05 §7.15).
// п. 30: `self` ключа у baza выводился из `head + lead`, то есть от ТОЧКИ
//        ВСТАВКИ: два пира, добавившие один ключ в разные позиции, получали два
//        поддерева на один ключ. Здесь адрес контентный — `predictKey` — и такие
//        вставки схлопываются по LWW.
// п. 28: `dive(key, Pawn, auto)` значил и «значение», и «создать», и «права».
//        Здесь три раздельные операции: `x(key)` читает, `x(key, next)` пишет,
//        создание живёт у `parts`/`index` отдельным именем.
// п. 37: сеттер не заканчивается на чтение самого себя.

import { untracked } from '@sync/fiber'
import { Link } from '../binary/link'
import type { SandTag } from '../binary/unit'
import { type Vary, varyEqual } from '../binary/vary'
import { ROOT, type SandView } from '../land/view'
import { predictItem, predictKey } from './address'
import { CELL, type Cell, cellOf, firstOf, mountSlot } from './cell'
import { type Handle, type Head, SPOT, type Spot } from './channel'
import type { DictField, Field } from './field'
import { describe, type Issue } from './issue'
import type { SpaceCore } from './space'
import type { Cast, Key, Type } from './value'

const NO_KEYS: readonly Key[] = Object.freeze([])

function valueTypeOf(cell: Cell): Type<unknown> {
  return (cell.field as DictField<Key, unknown>).value
}

/**
 * Как поле читает ключ.
 *
 * У `dict` и `parts` это линза схемы: ключ чужого типа отвергается так же, как
 * значение чужого типа. У `index` линзы нет — его ключи объявлены как `Key`, и
 * принимается любой примитив, который им является.
 */
export function keyReaderOf(field: Field): (raw: Vary) => Key | null {
  // Структурно, а не по `kind`: `DictField & PartsField` в пересечении даёт
  // `never` (у них разные литералы `kind`), и спрашивать «есть ли линза ключа»
  // приходится у формы поля, а не у его вида.
  const cast = (field as { readonly key?: Cast<Key> }).key
  return cast === undefined ? plainKey : cast.decode
}

function plainKey(raw: Vary): Key | null {
  return typeof raw === 'string' || typeof raw === 'number' ? raw : null
}

function issueAt(
  core: SpaceCore,
  cell: Cell,
  head: Head,
  view: SandView | null,
  kind: Issue['kind'],
  expected: string,
  got: string,
): Issue {
  return {
    kind,
    land: core.id,
    head,
    self: view === null ? ROOT : view.self,
    peer: view === null ? null : Link.peer(view.peer),
    field: cell.key,
    expected,
    got,
  }
}

// ── Слоты и ключевые юниты ───────────────────────────────────────────────────

/** Слот поля, материализованный по требованию записи. */
export function mountField(core: SpaceCore, cell: Cell, head: Head): Head {
  const slot = untracked(() => cell.slot(head))
  return slot === ROOT ? mountSlot(core, head, cell.key, cell.field) : slot
}

/**
 * Материализовать ключевой юнит внутри слота. Идемпотентно.
 *
 * Та же формула, что у `mountSlot` для поля документа, с одним отличием: `tag`
 * приходит от ВИДА поля, а не от самого ключа — под ключом словаря лежит атом
 * (`solo`), под ключом `parts` и уровнем индекса — документ (`keys`). Второе
 * место с той же формулой — копия с комментарием, а не абстракция: третьего
 * повторения нет (PRINCIPLES, правило трёх).
 *
 * Ключ ложится в КОНЕЦ: порядок ключей — часть контракта (docs/05 §7.15).
 */
export function mountKey(core: SpaceCore, slot: Head, key: Key, tag: SandTag): Head {
  const found = untracked(() => core.keyIndex(slot)).get(String(key))
  if (found !== undefined) return found

  const kids = untracked(() => core.order(slot))
  const lead = kids.length === 0 ? ROOT : (kids[kids.length - 1] as SandView).self
  // Контентный адрес: от позиции НЕ зависит, поэтому два пира, добавившие один
  // ключ в разные места, получают ОДИН узел, а не два поддерева (реестр, п. 30).
  const self = predictKey(core.land, core.salt, slot, key)
  core.post(slot, lead, self, key, tag)
  return self
}

/** `self` ключевого юнита или `ROOT`, если ключа нет. Читается С ПОДПИСКОЙ. */
export function keySlot(core: SpaceCore, cell: Cell, head: Head, key: Key): Head {
  const slot = cell.slot(head)
  if (slot === ROOT) return ROOT
  return core.keyIndex(slot).get(String(key)) ?? ROOT
}

/**
 * Ключи слота в порядке вставки.
 *
 * Порядок ВСТАВОЧНЫЙ — это регрессия против LIFO у baza (реестр, п. 29). Первый
 * победитель имени и есть ключ: `order()` уже разложил сиблингов детерминированно
 * по LWW, поэтому дубль имени от чужого пира не удваивает ключ.
 */
export function readKeysAt(core: SpaceCore, cell: Cell, slot: Head): readonly Key[] {
  if (slot === ROOT) return NO_KEYS
  const kids = core.order(slot)
  if (kids.length === 0) return NO_KEYS

  const decode = keyReaderOf(cell.field)
  const out: Key[] = []
  const seen = new Set<string>()
  for (let i = 0; i < kids.length; i++) {
    const view = kids[i] as SandView
    const raw = core.valueOf(view)
    if (raw === null) continue
    // Meta-слот — ключевой юнит с ПУСТЫМ именем: ссылка на схему не имеет права
    // протечь в `keys()` лишним фантомным ключом (docs/05 §9, `$.meta()`).
    if (raw === '') continue
    const key = decode(raw)
    if (key === null) {
      core.report(issueAt(core, cell, slot, view, 'decode', 'key', describe(raw)))
      continue
    }
    const label = String(key)
    if (seen.has(label)) continue
    seen.add(label)
    out.push(key)
  }
  return out
}

// ── Значение под ключом: тот же атом, только слот другой ─────────────────────

/**
 * Чтение значения под ключевым юнитом.
 *
 * Это тело {@link readAtom} без первой строки: атом берёт слот у `cell.slot(head)`,
 * а словарь получает его готовым — ключ уже разрешён в номер узла. Копия, а не
 * общая функция: разводить их пришлось бы параметром «где взять слот», то есть
 * ветвлением на самом горячем пути ради экономии пятнадцати строк.
 *
 * НИКОГДА не бросает (docs/05 §4).
 */
export function readEntry(core: SpaceCore, cell: Cell, at: Head): unknown {
  const type = valueTypeOf(cell)
  const view = firstOf(core, at)
  if (view === null) return type.blank

  const raw = core.valueOf(view)
  if (raw === null) {
    if (core.broken(view)) {
      core.report(issueAt(core, cell, at, view, 'shape', type.name, 'bytes the codec does not know'))
    }
    return type.blank
  }

  const value = type.decode(raw)
  if (value !== null) return value

  core.report(issueAt(core, cell, at, view, 'decode', type.name, describe(raw)))
  return type.blank
}

/**
 * Запись значения под уже смонтированным ключевым юнитом.
 *
 * ИДЕМПОТЕНТНОСТЬ обязательна: без неё любой ре-рендер, любое эхо от пира и любое
 * `x(k, x(k))` рождают юнит, и диффы летят по кругу между двумя узлами
 * бесконечно. `self` прежний — на нём висят дети; якорь `ROOT` — новая версия
 * обязана стать первым живым ребёнком, иначе `cast` в атом станет ложью.
 */
export function postEntry(core: SpaceCore, at: Head, raw: Vary): void {
  const prev = untracked(() => firstOf(core, at))
  if (prev === null) {
    // Надгробие над пустотой — юнит, который ничего не меняет, зато навсегда
    // уезжает по проводу.
    if (raw === null) return
  } else if (varyEqual(core.valueOf(prev) as Vary, raw)) {
    return
  }

  const self = prev === null ? predictItem(core.land, core.salt, at, ROOT, raw) : prev.self
  core.post(at, ROOT, self, raw, 'term')
}

/** Писатель ячейки словаря: ключ уже разрешён в номер узла. */
export function writeEntry(core: SpaceCore, cell: Cell, at: Head, next: unknown): void {
  const type = valueTypeOf(cell)
  postEntry(core, at, next === null ? null : type.encode(next))
}

// ── Канал словаря ────────────────────────────────────────────────────────────

function readKey(core: SpaceCore, cell: Cell, head: Head, key: Key): unknown {
  const at = keySlot(core, cell, head, key)
  if (at === ROOT) return valueTypeOf(cell).blank
  return cell.value(at)
}

function writeKey(core: SpaceCore, cell: Cell, head: Head, key: Key, next: unknown): unknown {
  const type = valueTypeOf(cell)
  // Кодируем ДО монтирования: отказ линзы (`t.pattern`, `t.int`, `t.range`) не
  // имеет права оставить за собой пустой ключ — иначе неудачная отправка формы
  // навсегда добавляла бы словарю запись.
  const raw = next === null ? null : type.encode(next)

  const at = mountKey(core, mountField(core, cell, head), key, 'solo')
  postEntry(core, at, raw)
  // Читаем ПОСЛЕ записи, а не изнутри неё: у baza сеттер заканчивался на
  // `return this.items_vary()`, то есть канал перевычислялся из самого себя
  // (реестр, п. 37). Здесь это обычное чтение победителя LWW.
  return cell.value(at)
}

/**
 * Канал вида с КЛЮЧОМ: `x(key)` читает, `x(key, next)` пишет.
 *
 * Отдельная фабрика, а не второй аргумент общей: значение мультиплексировано
 * парой (голова, ключ), и ключ обязан попасть в КЛЮЧ канала, а не в его
 * аргумент. Зеркало `KeyedComputedRef` из ядра (docs/05 §1.4).
 */
export function keyedChannel(
  core: SpaceCore,
  cell: Cell,
  head: Head,
  body: (core: SpaceCore, cell: Cell, head: Head, a: unknown, b: unknown) => unknown,
): Handle {
  const channel = ((a?: unknown, b?: unknown): unknown =>
    body(core, cell, head, a, b)) as unknown as Record<symbol | string, unknown>

  const spot: Spot = { land: core.id, head, field: cell.key }
  // Присваивание, а не `Object.defineProperty`: 4 нс против 120 (реестр, п. 17).
  channel[SPOT] = spot
  channel[CELL] = cell
  Object.assign(channel, cell.methods)

  return channel as unknown as Handle
}

function dictBody(core: SpaceCore, cell: Cell, head: Head, key: unknown, next: unknown): unknown {
  if (next === undefined) return readKey(core, cell, head, key as Key)
  return writeKey(core, cell, head, key as Key, next)
}

export function dictChannel(core: SpaceCore, cell: Cell, head: Head): Handle {
  return keyedChannel(core, cell, head, dictBody)
}

/** Таблица методов словаря: ОДНА на (модель, поле). */
export const DICT_METHODS: Readonly<Record<string, unknown>> = Object.freeze({
  /** Явная запись — как в ядре. Возвращает победителя LWW. */
  set(this: Handle, key: Key, next: unknown): unknown {
    const cell = cellOf(this)
    return writeKey(cell.core, cell, this[SPOT].head, key, next)
  },

  /** Ключи в порядке ВСТАВКИ. Регрессия против LIFO у baza (реестр, п. 29). */
  keys(this: Handle): readonly Key[] {
    const cell = cellOf(this)
    return readKeysAt(cell.core, cell, cell.slot(this[SPOT].head))
  },

  size(this: Handle): number {
    const cell = cellOf(this)
    return readKeysAt(cell.core, cell, cell.slot(this[SPOT].head)).length
  },

  has(this: Handle, key: Key): boolean {
    const cell = cellOf(this)
    return keySlot(cell.core, cell, this[SPOT].head, key) !== ROOT
  },

  /**
   * Переименование СОХРАНЯЕТ поддерево: тот же `self`, другое значение.
   *
   * Занятый приёмник стирается ДО переименования: иначе под одним именем
   * оказались бы два ключевых юнита, и победителя выбирал бы порядок доставки —
   * то есть разные реплики прочитали бы разное.
   */
  rename(this: Handle, from: Key, to: Key): void {
    const cell = cellOf(this)
    const core = cell.core
    const head = this[SPOT].head
    if (String(from) === String(to)) return

    const slot = untracked(() => cell.slot(head))
    if (slot === ROOT) return
    const index = untracked(() => core.keyIndex(slot))
    const at = index.get(String(from))
    if (at === undefined) return

    const busy = index.get(String(to))
    if (busy !== undefined) core.remove(busy)

    const view = core.land.peek(at)
    if (view === null) return
    core.post(slot, view.lead, at, to, view.tag)
  },

  delete(this: Handle, key: Key): void {
    const cell = cellOf(this)
    const core = cell.core
    const at = untracked(() => keySlot(core, cell, this[SPOT].head, key))
    if (at !== ROOT) core.remove(at)
  },

  /** Надгробие на каждый ключевой юнит. Поддерево ключа не обходится. */
  clear(this: Handle): void {
    const cell = cellOf(this)
    const core = cell.core
    const slot = untracked(() => cell.slot(this[SPOT].head))
    if (slot === ROOT) return
    // Копия: `remove` бьёт сигнал формы головы, а мы идём по её же выдаче.
    const kids = untracked(() => core.order(slot)).slice()
    for (let i = 0; i < kids.length; i++) core.remove((kids[i] as SandView).self)
  },

  /** Первая причина, по которой ключ или значение не прочитались. Второй проход. */
  issue(this: Handle): Issue | null {
    const cell = cellOf(this)
    const core = cell.core
    const type = valueTypeOf(cell)
    const slot = cell.slot(this[SPOT].head)
    if (slot === ROOT) return null

    const decode = keyReaderOf(cell.field)
    const kids = core.order(slot)
    for (let i = 0; i < kids.length; i++) {
      const view = kids[i] as SandView
      const raw = core.valueOf(view)
      if (raw === null || raw === '') continue
      if (decode(raw) === null) {
        return issueAt(core, cell, slot, view, 'decode', 'key', describe(raw))
      }
      const held = firstOf(core, view.self)
      if (held === null) continue
      const value = core.valueOf(held)
      if (value === null) {
        if (!core.broken(held)) continue
        return issueAt(core, cell, slot, held, 'shape', type.name, 'bytes the codec does not know')
      }
      if (type.decode(value) === null) {
        return issueAt(core, cell, slot, held, 'decode', type.name, describe(value))
      }
    }
    return null
  },
})
