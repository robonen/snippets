// v8:hot — `readList` зовётся с каждого холодного чтения поля-списка, а
// `reconcile` — единственный путь записи в него.
//
// ─── Сердце файла: реконсиляция ──────────────────────────────────────────────
//
// docs/05 §3.8. «Прочитал массив, поменял один элемент, записал обратно» обязано
// породить РОВНО ОДИН юнит, а не N. Это требование DoD стадии, и оно проверяется
// счётчиком (`list.test.ts`, «одна правка — один юнит»), а не глазами.
//
// Порядок ветвей ФИКСИРОВАН: совпало → вставка → удаление → замена. Смена
// приоритета превращает «поменял один элемент» в N юнитов и убивает вложенные
// поддеревья — ровно то, что ловит портированный кейс baza «Insert before
// removed before changed».
//
// ─── Что здесь исправлено против baza (реестр расхождений) ───────────────────
//
// п. 29: у baza `add` постил с `lead = hole`, то есть в НАЧАЛО, а `splice` в том
//        же классе дописывал в КОНЕЦ — две противоположные семантики без единого
//        слова в документации. Здесь якорь назван в имени операции: `push` —
//        конец, `unshift` — начало, и порядок это предмет теста.
// п. 37: у baza `items_vary` заканчивался на `return this.items_vary()`, то есть
//        канал перевычислялся ИЗНУТРИ САМОГО СЕБЯ. Здесь запись не реентерантна:
//        значение приходит обычным распространением, а `x(next)` возвращает
//        победителя LWW чтением ПОСЛЕ записи, а не рекурсией.
// п. 38: `move` меняет `lead` перемещаемого узла и не ветвится по идентичности
//        JS-объектов — сравниваются номера узлов (сделано в S3, `Land.move`).

import { untracked } from '@sync/fiber'
import { Link } from '../binary/link'
import type { SandTag } from '../binary/unit'
import { type Vary, varyEqual } from '../binary/vary'
import { ROOT, type SandView } from '../land/view'
import { predictItem } from './address'
import { type Handle, type Head, SPOT } from './channel'
import { type Cell, cellOf, mountSlot } from './cell'
import type { ListField } from './field'
import { describe, type Issue, ModelError } from './issue'
import type { SpaceCore } from './space'
import type { Cast } from './value'

/** Пустые выдачи — по одной на модуль (правило 7 горячего пути). */
const NO_ITEMS: readonly unknown[] = Object.freeze([])
const NO_VIEWS: readonly SandView[] = Object.freeze([])

function itemOf(cell: Cell): Cast<unknown> {
  return (cell.field as ListField<unknown>).item
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
 * Равенство значений на горячем пути реконсиляции.
 *
 * `===` первым: у строк и чисел — а это подавляющее большинство элементов —
 * он отвечает без единой аллокации, тогда как `varyEqual` кодирует ОБА значения
 * в байты, то есть платит два `varyEncode` на каждый элемент списка. `-0`/`+0` и
 * `NaN` от такого порядка не страдают: формат каноничен, и оба пути дают один
 * ответ (регрессия `minus-zero-is-not-a-value`).
 */
function sameVary(a: Vary, b: Vary): boolean {
  return a === b || varyEqual(a, b)
}

/**
 * Живые дети слота поля. `ROOT` — поля ещё нет, детей нет тем более.
 *
 * ПОЗИЦИЯ — это позиция среди детей ленда, а не среди прочитанных значений.
 * Различие видно только на мусоре от чужой версии, и выбор сделан в его пользу
 * сознательно: иначе один недобросовестный пир, положивший в список значение
 * чужого типа, СДВИНУЛ БЫ индексы всем остальным, и `removeAt(2)` у двух реплик
 * означал бы разные элементы.
 */
function kidsOf(core: SpaceCore, cell: Cell, head: Head): readonly SandView[] {
  const slot = cell.slot(head)
  if (slot === ROOT) return NO_VIEWS
  return core.order(slot)
}

function kidsNow(core: SpaceCore, cell: Cell, head: Head): readonly SandView[] {
  // `untracked` обязателен на пути ЗАПИСИ: пишущий не подписывается на то, что
  // сам меняет, иначе эффект будит сам себя своей же правкой.
  return untracked(() => kidsOf(core, cell, head))
}

/**
 * Чтение списка: все живые дети слота, разобранные линзой элемента.
 *
 * НИКОГДА не бросает. Элемент, который линза не приняла, ПРОПУСКАЕТСЯ и даёт
 * `Issue`: у `Cast<T>` нет `blank` (решение Р5), подставить вместо мусора нечего,
 * а бросить нельзя — у baza `list.of()` не оборачивал схему в `maybe`, и чтение
 * списка с чужим значением роняло геттер (реестр, п. 27). Пропуск не молчание:
 * на каждый негодный элемент уходит ровно один `Issue`, а `size()` продолжает
 * считать элементы ленда, поэтому «пришло 5, прочитали 4» видно и в диагностике,
 * и в расхождении `size()` с длиной выдачи.
 */
export function readList(core: SpaceCore, cell: Cell, head: Head): readonly unknown[] {
  const kids = kidsOf(core, cell, head)
  if (kids.length === 0) return NO_ITEMS

  const item = itemOf(cell)
  const out: unknown[] = []
  for (let i = 0; i < kids.length; i++) {
    const view = kids[i] as SandView
    const raw = core.valueOf(view)
    if (raw === null) {
      // `order()` отдаёт только живых, значит `null` тут — не надгробие, а
      // значение, вынесенное в `ball`: его подаёт хранилище (S5), не ленд.
      if (core.broken(view)) {
        core.report(issueAt(core, cell, head, view, 'shape', item.name, 'байты, которых кодек не знает'))
      }
      continue
    }
    const value = item.decode(raw)
    if (value === null) {
      core.report(issueAt(core, cell, head, view, 'decode', item.name, describe(raw)))
      continue
    }
    out.push(value)
  }
  return out
}

/**
 * Закодировать ВЕСЬ массив до первой записи.
 *
 * До, а не по ходу: отказ линзы (`t.pattern`, `t.int`, `t.range`) на пятом
 * элементе не имеет права оставить в ленде четыре первых — список пережил бы
 * неудачную отправку формы наполовину применённым.
 */
function encodeAll(cell: Cell, next: readonly unknown[]): Vary[] {
  const item = itemOf(cell)
  const out: Vary[] = []
  for (let i = 0; i < next.length; i++) {
    const raw = item.encode(next[i])
    if (raw === null) {
      // `null` в ленде — НАДГРОБИЕ, а не значение (решение Р6). Элемент, чья
      // линза кодирует значение в `null` (`t.maybe`), молча стёр бы соседа.
      throw new ModelError(
        `поле «${cell.key}»: элемент №${i} кодируется в null, а null в ленде — надгробие, а не значение`,
        'list.write',
      )
    }
    out.push(raw)
  }
  return out
}

/**
 * Реконсиляция подсписка `[from, to)` значениями `next`.
 *
 * Якорь — предыдущий живой юнит РЕЗУЛЬТАТА, а не индекс в старом массиве:
 * позиция вставки обязана переживать удаление соседа, иначе кейсы «Insert after
 * wiped» и «Wiped before inserted» сходятся к разным спискам.
 *
 * @param slot голова, под которой лежат элементы (ключевой юнит поля)
 * @param tag подсказка о вложенном содержимом вставляемых элементов
 */
export function reconcile(
  core: SpaceCore,
  slot: Head,
  prev: readonly SandView[],
  next: readonly Vary[],
  from: number,
  to: number,
  tag: SandTag = 'term',
): void {
  let lead: Head = from > 0 ? (prev[from - 1] as SandView).self : ROOT
  let i = from
  let j = 0

  while (j < next.length || i < to) {
    const before = i < to ? (prev[i] as SandView) : undefined
    const after = j < next.length ? (next[j] as Vary) : undefined

    // 1. Совпало — не трогаем вовсе. Ветка первая, и потому «поменял один
    //    элемент из тысячи» стоит один юнит, а не тысячу.
    if (before !== undefined && after !== undefined && sameVary(core.valueOf(before) as Vary, after)) {
      lead = before.self
      i++
      j++
      continue
    }

    // 2. Вставка: справа осталось больше нового, чем старого.
    if (after !== undefined && next.length - j > to - i) {
      const self = predictItem(core.land, core.salt, slot, lead, after)
      core.post(slot, lead, self, after, tag)
      lead = self
      j++
      continue
    }

    // 3. Удаление: справа осталось больше старого, чем нового.
    if (before !== undefined && to - i > next.length - j) {
      // Надгробие остаётся ЯКОРЕМ: `order()` спускается в детей мёртвых узлов,
      // поэтому позиция вставки переживает удаление (кейсы «Insert after wiped»
      // и «Wiped before inserted»).
      //
      // РАСХОЖДЕНИЕ с кодом docs/05 §3.8, ВЫНУЖДЕННОЕ ЗАМЕРОМ. Там надгробие
      // сохраняет ПРЕЖНИЙ `lead` («переезд утащил бы за собой всё поддерево»).
      // На практике это ломает порт `Insert before removed before changed`:
      // ранг среди сиблингов, делящих один `lead`, определяется меткой
      // ПОБЕДИТЕЛЯ, а надгробие получает свежую метку — и удалённый элемент
      // прыгает в начало своей группы, утаскивая туда же всех, кто встал за
      // ним. Наблюдалось буквально: `['foo','bar'] → ['xxx','foo','bar'] →
      // ['xxx','bars']` давало `['bars','xxx']`. Якорь результата от этого
      // спасает — и он же ровно то, что делает `drop` в baza. Поддерево при
      // этом переезжает ВМЕСТЕ с надгробием, что для элемента списка и нужно:
      // вставленные после него обязаны остаться после него.
      core.post(slot, lead, before.self, null, before.tag)
      lead = before.self
      i++
      continue
    }

    // 4. Замена — ТОТ ЖЕ `self`, новое значение. Именно поэтому смена значения
    //    ключа словаря переносит на него всё вложенное поддерево. `tag` берётся
    //    у прежней версии, а не у вставки: замена не меняет ВИДА содержимого.
    const stay = before as SandView
    core.post(slot, lead, stay.self, after as Vary, stay.tag)
    lead = stay.self
    i++
    j++
  }
}

/**
 * Запись списка целиком — реконсиляция, а не перезапись.
 *
 * Реентерации нет: значение пересчитается само, когда до канала дойдёт
 * распространение (реестр, п. 37).
 */
export function writeList(core: SpaceCore, cell: Cell, head: Head, next: unknown): void {
  const items = next as readonly unknown[]
  const raw = encodeAll(cell, items)

  const slot = untracked(() => cell.slot(head))
  if (slot === ROOT) {
    // Пустой список в пустое поле — ноль юнитов. Монтировать ключевой юнит ради
    // «ничего» значило бы, что чтение пустого поля отличается от его записи
    // пустотой только лишним юнитом в логе.
    if (raw.length === 0) return
    reconcile(core, mountSlot(core, head, cell.key, cell.field), NO_VIEWS, raw, 0, 0)
    return
  }

  const prev = untracked(() => core.order(slot))
  reconcile(core, slot, prev, raw, 0, prev.length)
}

/** Общий путь всех правок подсписка: `push`, `unshift`, `insert`, `splice`. */
function spliceAt(handle: Handle, values: readonly unknown[], from: number, to: number): void {
  const cell = cellOf(handle)
  const core = cell.core
  const head = handle[SPOT].head
  const raw = encodeAll(cell, values)

  const slot = untracked(() => cell.slot(head))
  if (slot === ROOT) {
    if (raw.length === 0) return
    reconcile(core, mountSlot(core, head, cell.key, cell.field), NO_VIEWS, raw, 0, 0)
    return
  }

  const prev = untracked(() => core.order(slot))
  const start = clamp(from, prev.length)
  reconcile(core, slot, prev, raw, start, clamp(to, prev.length, start))
}

function clamp(at: number, size: number, low = 0): number {
  if (!Number.isFinite(at)) return size
  const whole = Math.trunc(at)
  if (whole < low) return low
  return whole > size ? size : whole
}

/**
 * Таблица методов списка: создаётся ОДИН раз на (модель, поле).
 *
 * Приёмник определяется вызовом (`this`) — решение Р4. Прикладной код пишет
 * `post.tags.push('x')` и не видит ни `this`, ни классов: ограничение 1
 * запрещает их ПРИКЛАДНИКУ, а не реализации.
 */
export const LIST_METHODS: Readonly<Record<string, unknown>> = Object.freeze({
  /** Явная запись — как в ядре. Возвращает победителя LWW, а не то, что записали. */
  set(this: Handle, next: readonly unknown[]): readonly unknown[] {
    const cell = cellOf(this)
    return cell.value(this[SPOT].head, next) as readonly unknown[]
  },

  /**
   * Сколько элементов лежит в ленде.
   *
   * Может отличаться от длины выдачи `()` — ровно на число элементов, которых не
   * приняла линза. Это не расхождение, а два разных вопроса: «сколько позиций» и
   * «сколько я умею прочитать» (см. {@link readList}).
   */
  size(this: Handle): number {
    const cell = cellOf(this)
    return kidsOf(cell.core, cell, this[SPOT].head).length
  },

  /** Элемент по позиции. Отрицательная — с конца, как `Array.prototype.at`. */
  at(this: Handle, index: number): unknown {
    const cell = cellOf(this)
    const core = cell.core
    const kids = kidsOf(core, cell, this[SPOT].head)
    const at = index < 0 ? kids.length + index : index
    const view = kids[at]
    if (view === undefined) return null
    const raw = core.valueOf(view)
    if (raw === null) return null
    return itemOf(cell).decode(raw)
  },

  /** Есть ли такое значение. Сравнение по БАЙТАМ — тем же признаком, что у LWW. */
  has(this: Handle, value: unknown): boolean {
    const cell = cellOf(this)
    const core = cell.core
    const needle = tryEncode(cell, value)
    if (needle === undefined) return false
    const kids = kidsOf(core, cell, this[SPOT].head)
    for (let i = 0; i < kids.length; i++) {
      if (sameVary(core.valueOf(kids[i] as SandView) as Vary, needle)) return true
    }
    return false
  },

  /** В КОНЕЦ. Якорь назван в имени: у baza `add` делал ровно обратное (п. 29). */
  push(this: Handle, ...values: readonly unknown[]): void {
    const cell = cellOf(this)
    const size = kidsNow(cell.core, cell, this[SPOT].head).length
    spliceAt(this, values, size, size)
  },

  /** В НАЧАЛО. */
  unshift(this: Handle, ...values: readonly unknown[]): void {
    spliceAt(this, values, 0, 0)
  },

  /** Перед позицией `at`. */
  insert(this: Handle, at: number, ...values: readonly unknown[]): void {
    spliceAt(this, values, at, at)
  },

  /**
   * Заменить подсписок `[from, to)` на `next`.
   *
   * По умолчанию — дописать в конец: `from = size()`, `to = from`. Ровно та же
   * умолчальная пара, что у baza, но там она сосуществовала с `add`, который
   * постил в начало (п. 29).
   */
  splice(this: Handle, next: readonly unknown[], from?: number, to?: number): void {
    const cell = cellOf(this)
    const size = kidsNow(cell.core, cell, this[SPOT].head).length
    const start = from === undefined ? size : from
    spliceAt(this, next, start, to === undefined ? start : to)
  },

  /**
   * Убрать ВСЕ вхождения значения — порт `cut` из baza.
   *
   * Все, а не первое: `remove(v)` парен `has(v)`, и после него `has(v)` обязан
   * стать `false`, иначе операция называется не тем словом.
   */
  remove(this: Handle, value: unknown): void {
    const cell = cellOf(this)
    const core = cell.core
    const needle = itemOf(cell).encode(value)
    const kids = kidsNow(core, cell, this[SPOT].head)
    for (let i = 0; i < kids.length; i++) {
      const view = kids[i] as SandView
      if (sameVary(core.valueOf(view) as Vary, needle)) core.remove(view.self)
    }
  },

  /** Убрать элемент по позиции. */
  removeAt(this: Handle, index: number): void {
    const cell = cellOf(this)
    const core = cell.core
    const view = kidsNow(core, cell, this[SPOT].head)[index]
    if (view !== undefined) core.remove(view.self)
  },

  /**
   * Переставить элемент. `to` — позиция В ТЕКУЩЕМ списке, за которой он встанет
   * (ноль — в начало): та же семантика, что у `sand_move(unit, head, to)` в baza,
   * включая её же вырожденный случай — перестановка на соседнюю позицию справа
   * ничего не меняет. Портированные оттуда серии перестановок сходятся к тем же
   * массивам.
   *
   * Ветвления по идентичности JS-объектов `Link`, из-за которого один и тот же
   * логический `move` давал в baza разный граф, здесь нет вовсе (реестр, п. 38):
   * сравниваются номера узлов.
   *
   * ПОЧЕМУ НЕ `Land.move`. Он отказывается писать, когда `lead` не меняется
   * (`back === lead` → `false`), а в нашем порядке этого мало: ранг среди
   * сиблингов, делящих один `lead`, определяется МЕТКОЙ победителя, поэтому
   * перестановка ВНУТРИ одной группы выражается свежей меткой, а не сменой
   * `lead`. Плюс он перепривязывает ровно одного последователя, тогда как
   * `lead`-детей у переезжающего узла бывает несколько — и тогда цепочка
   * замыкается в кольцо (серия «Many moves» ловит это на третьем шаге).
   */
  move(this: Handle, from: number, to: number): void {
    const cell = cellOf(this)
    const core = cell.core
    const head = this[SPOT].head
    const slot = untracked(() => cell.slot(head))
    if (slot === ROOT) return

    const kids = untracked(() => core.order(slot))
    const view = kids[from]
    if (view === undefined) return
    // Вырожденные случаи baza: «на своё место» и «на одну вправо» — не правки.
    if (to === from || to === from + 1) return
    const lead = to <= 0 ? ROOT : (kids[to - 1] as SandView | undefined)?.self
    if (lead === undefined || lead === view.self) return

    // Дети переезжающего узла остаются на месте: их `lead` переводится на его
    // ПРЕДШЕСТВЕННИКА В ПОРЯДКЕ ЧТЕНИЯ, а не на его собственный `lead`. Разница
    // видна ровно там, где `move` и нужен: у узла, стоящего не в цепочке, свой
    // `lead` может указывать далеко назад, и переезд детей туда выносит целое
    // поддерево в начало списка. Замер: серия «Reorder separated sublists»
    // давала [4,6,5,1,3,2] вместо [1,3,2,4,6,5], пока дети уезжали к `view.lead`.
    //
    // Всех детей, а не одного последователя (как `sand_move` в baza и как
    // `Land.move`): `lead`-детей у переезжающего узла бывает несколько, и
    // оставленный ребёнок замыкает цепочку в кольцо — серия «Many moves» ловит
    // это на третьем шаге.
    //
    // Обратный порядок обхода — чтобы взаимный порядок детей уцелел:
    // переписанный последним получает самую свежую метку и потому становится
    // первым в своей группе.
    const back = from <= 0 ? ROOT : (kids[from - 1] as SandView).self
    for (let i = kids.length - 1; i >= 0; i--) {
      const kid = kids[i] as SandView
      if (kid.self === view.self || kid.lead !== view.self) continue
      repost(core, slot, back, kid)
    }
    repost(core, slot, lead, view)
  },

  /** Надгробие на каждый живой элемент. Поддерево элемента не обходится. */
  clear(this: Handle): void {
    const cell = cellOf(this)
    const core = cell.core
    // Копия: `remove` бьёт сигнал формы головы, а мы идём по её же выдаче.
    const kids = kidsNow(core, cell, this[SPOT].head).slice()
    for (let i = 0; i < kids.length; i++) core.remove((kids[i] as SandView).self)
  },

  /** Почему выдача короче, чем `size()`. `null` — всё в порядке. Второй проход. */
  issue(this: Handle): Issue | null {
    const cell = cellOf(this)
    const core = cell.core
    const head = this[SPOT].head
    const item = itemOf(cell)
    const kids = kidsOf(core, cell, head)

    for (let i = 0; i < kids.length; i++) {
      const view = kids[i] as SandView
      const raw = core.valueOf(view)
      if (raw === null) {
        if (!core.broken(view)) continue
        return issueAt(core, cell, head, view, 'shape', item.name, 'байты, которых кодек не знает')
      }
      if (item.decode(raw) === null) {
        return issueAt(core, cell, head, view, 'decode', item.name, describe(raw))
      }
    }
    return null
  },
})

/**
 * Переписать узел с новым соседом, сохранив значение и `tag`.
 *
 * `tag` переносится с прежней версии по той же причине, по которой его
 * переносит `Land.move`: потерянный тег объявил бы живой словарь атомом
 * (ADR-016 вменил ровно эту потерю обычным объектам).
 */
function repost(core: SpaceCore, slot: Head, lead: Head, view: SandView): void {
  const value = core.valueOf(view)
  // Значение вынесено в `ball` — его подаёт хранилище (S5). Переписать узел
  // нечем, и записать вместо него `null` значило бы поставить надгробие.
  if (value === null) return
  core.post(slot, lead, view.self, value, view.tag)
}

/** `undefined` — линза даже не смогла закодировать, значит такого в списке нет. */
function tryEncode(cell: Cell, value: unknown): Vary | undefined {
  try {
    return itemOf(cell).encode(value)
  } catch {
    // Проглатывания нет: `has` — это ВОПРОС, и единственный честный ответ на
    // «есть ли в списке значение, которое туда не кладётся» — «нет». Бросать
    // имеет право запись (`remove`), и она бросает.
    return undefined
  }
}
