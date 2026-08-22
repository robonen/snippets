// v8:hot — `readAtom` вызывается из `cell.value`, то есть с каждого ХОЛОДНОГО
// чтения поля; тёплое чтение сюда не заходит вовсе (кэш файбера).

import { untracked } from '@sync/fiber'
import { Link } from '../binary/link'
import { type Vary, varyEqual } from '../binary/vary'
import { ROOT, type SandView } from '../land/view'
import { predictItem } from './address'
import { type Handle, type Head, type Peer, SPOT } from './channel'
import { type Cell, cellOf, firstOf, mountSlot } from './cell'
import type { AtomField } from './field'
import { describe, type Issue } from './issue'
import type { SpaceCore } from './space'
import type { Type } from './value'

/** Восемь байт пира — сравнение по значению, не по идентичности объекта. */
const PEER_BYTES = 8

function typeOf(cell: Cell): Type<unknown> {
  return (cell.field as AtomField<unknown>).type
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

/**
 * Чтение атома: первый живой ребёнок слота, разобранный линзой поля.
 *
 * НИКОГДА не бросает — ни на мусоре от узла другой версии, ни на значении,
 * вынесенном в `ball`. Один недобросовестный пир не имеет права уронить
 * приложение (docs/05 §4).
 */
export function readAtom(core: SpaceCore, cell: Cell, head: Head): unknown {
  const type = typeOf(cell)
  const slot = cell.slot(head)
  if (slot === ROOT) return type.blank

  const view = firstOf(core, slot)
  if (view === null) return type.blank

  const raw = core.valueOf(view)
  if (raw === null) {
    // Значение вынесено в `ball` — его подаёт хранилище (S5), а не ленд. Молчать
    // тут нельзя: «пусто» и «не смогли прочитать» — разные состояния, и именно
    // на их слипании в baza держался п. 34 реестра.
    if (core.broken(view)) {
      core.report(issueAt(core, cell, head, view, 'shape', type.name, 'байты, которых кодек не знает'))
    }
    return type.blank
  }

  const value = type.decode(raw)
  if (value !== null) return value

  // `decode` вернул `null` при НЕ-`null` сыром значении — значит «это не наш
  // тип». У `t.maybe` `null` законен, но он приходит только из `raw === null`,
  // а тот отсечён выше.
  core.report(issueAt(core, cell, head, view, 'decode', type.name, describe(raw)))
  return type.blank
}

/**
 * Запись атома.
 *
 * Три вещи, каждая из которых существенна:
 *
 * 1. `encode` зовётся ДО монтирования слота. Отказ линзы (`t.pattern`, `t.int`,
 *    `t.range`) не имеет права оставить за собой пустой ключевой юнит — иначе
 *    неудачная отправка формы навсегда добавляла бы документу поле.
 * 2. ИДЕМПОТЕНТНОСТЬ. Без неё любой ре-рендер, любое эхо от пира и любое `x(x())`
 *    рождают юнит: растёт лог, тикают часы, диффы летят по кругу между двумя
 *    узлами бесконечно.
 * 3. `self` ПРЕЖНИЙ, якорь `ROOT`. Прежний `self` — потому что на нём висят
 *    дети, и смена значения не должна ронять поддерево. Якорь в начало — потому
 *    что новая версия обязана стать первым живым ребёнком, иначе атом перестанет
 *    видеть элементы, добавленные через list-вид, и `cast` станет ложью.
 */
export function writeAtom(core: SpaceCore, cell: Cell, head: Head, next: unknown): void {
  const type = typeOf(cell)
  const raw: Vary = next === null ? null : type.encode(next)

  // `untracked` обязателен: пишущий не подписывается на то, что сам меняет.
  const slot = untracked(() => cell.slot(head))
  const prev = slot === ROOT ? null : untracked(() => firstOf(core, slot))

  if (prev === null) {
    // Стирать нечего: надгробие над пустотой — это юнит, который ничего не
    // меняет, зато навсегда уезжает по проводу.
    if (raw === null) return
  } else if (varyEqual(core.valueOf(prev) as Vary, raw)) {
    return
  }

  const at = slot === ROOT ? mountSlot(core, head, cell.key, cell.field) : slot
  const self = prev === null ? predictItem(core.land, core.salt, at, ROOT, raw) : prev.self
  core.post(at, ROOT, self, raw, 'term')

  // Реентерации нет: значение пересчитается само, когда до канала дойдёт
  // распространение. У baza сеттер заканчивался на `return this.vary_of(peer)` —
  // канал перевычислялся изнутри самого себя (реестр, п. 37).
}

/**
 * Таблица методов атома: создаётся ОДИН раз на (модель, поле).
 *
 * Приёмник определяется вызовом (`this`), поэтому ни одного нового замыкания на
 * канал не создаётся — это решение Р4. Прикладной код пишет `post.title.set(x)`
 * и не видит ни `this`, ни классов: ограничение 1 запрещает их ПРИКЛАДНИКУ, а
 * не реализации.
 */
export const ATOM_METHODS: Readonly<Record<string, unknown>> = Object.freeze({
  /** Явная запись — как в ядре. Возвращает победителя LWW, а не то, что записали. */
  set(this: Handle, next: unknown): unknown {
    const cell = cellOf(this)
    return cell.value(this[SPOT].head, next)
  },

  /**
   * Стереть: постится надгробие. Не то же, что запись пустой строки — `null` в
   * ленде это надгробие, а не значение, поэтому «записать пустоту» через
   * `x(next)` невозможно в принципе (решение Р6).
   */
  clear(this: Handle): void {
    const cell = cellOf(this)
    const core = cell.core
    const head = this[SPOT].head
    const slot = untracked(() => cell.slot(head))
    if (slot === ROOT) return
    const prev = untracked(() => firstOf(core, slot))
    if (prev === null) return
    core.remove(prev.self)
  },

  /** Значение до разбора — для диагностики и миграций. Читается С ПОДПИСКОЙ. */
  raw(this: Handle): Vary | null {
    const cell = cellOf(this)
    const core = cell.core
    const prev = firstOf(core, cell.slot(this[SPOT].head))
    return prev === null ? null : core.valueOf(prev)
  },

  /**
   * Версия конкретного пира: «кто что писал».
   *
   * ОГРАНИЧЕНИЕ, названное вслух: видны только версии, дожившие до текущего
   * состояния, — то есть «что из ВИДИМОГО написал этот пир», а не «что этот пир
   * видел у себя». Полная семантика требует `Land.orderOf(head, peer)`, который
   * docs/05 §3.15 просит у S3 и которого у ленда пока нет; обходиться сканом
   * `land.units()` значило бы обходить ВЕСЬ ленд на каждое обращение.
   */
  by(this: Handle, peer: Peer): unknown {
    const cell = cellOf(this)
    const core = cell.core
    const type = typeOf(cell)
    const slot = cell.slot(this[SPOT].head)
    if (slot === ROOT) return type.blank

    const kids = core.order(slot)
    for (let i = 0; i < kids.length; i++) {
      const view = kids[i] as SandView
      if (!samePeer(view, peer)) continue
      const raw = core.valueOf(view)
      if (raw === null) continue
      const value = type.decode(raw)
      if (value !== null) return value
    }
    return type.blank
  },

  /**
   * Проверка ДО записи, для форм. `null` — годится. Ничего не пишет.
   *
   * Существует затем, чтобы форма погасила кнопку заранее, а не ловила
   * исключение из обработчика: бросать имеет право только запись, и лучше не
   * давать туда попасть.
   */
  check(this: Handle, next: unknown): Issue | null {
    const cell = cellOf(this)
    const core = cell.core
    const type = typeOf(cell)
    try {
      if (next !== null) type.encode(next)
      return null
    } catch (error) {
      return issueAt(
        core,
        cell,
        this[SPOT].head,
        null,
        'decode',
        type.name,
        error instanceof Error ? error.message : String(error),
      )
    }
  },

  /** Почему тут `blank`. `null` — всё в порядке. Второй проход, не горячий путь. */
  issue(this: Handle): Issue | null {
    const cell = cellOf(this)
    const core = cell.core
    const head = this[SPOT].head
    const type = typeOf(cell)

    const slot = cell.slot(head)
    if (slot === ROOT) return null
    const view = firstOf(core, slot)
    if (view === null) return null

    const raw = core.valueOf(view)
    if (raw === null) {
      if (!core.broken(view)) return null
      return issueAt(core, cell, head, view, 'shape', type.name, 'байты, которых кодек не знает')
    }
    if (type.decode(raw) !== null) return null
    return issueAt(core, cell, head, view, 'decode', type.name, describe(raw))
  },
})

/** Автор узла — сравнением байт, без построения текста ссылки (147.9 нс). */
function samePeer(view: SandView, peer: Peer): boolean {
  const mine = view.peer
  const other = peer.bin
  for (let i = 0; i < PEER_BYTES; i++) {
    if (mine[i] !== (other[i] ?? 0)) return false
  }
  return true
}
