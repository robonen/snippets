// v8:hot — разыменование ссылки лежит на том же пути, что и чтение любого поля:
// `cell.value(head)` → сюда → готовый документ.
//
// ─── Три раздельные операции вместо одного `dive(key, P, auto)` ──────────────
//
// Реестр, п. 28. У baza третий аргумент `dive` значил РАЗОМ «какое значение»,
// «создавать ли» и «с какими правами», и предел этой ловушки — строка
// `user.Title(null)!.val('Jin')`: чтобы записать заголовок, надо передать `null`
// туда, где ждут значение. У нас это три разные вещи и три разные подписи:
//
//   post.author()            читает      → `Doc | null`, про `null` не забыть нельзя
//   post.author.set(doc)     пишет       → ссылку, победителя LWW возвращает чтением
//   post.author.ensure(born) создаёт     → детерминированно и идемпотентно
//
// ─── Отказ не бывает молчаливым ──────────────────────────────────────────────
//
// Реестр, п. 35: у baza `dive` при отказе прав возвращал `null`, неотличимый от
// «нет значения». Здесь любой отказ — это `Issue` с полным контекстом:
// `broken-link` на чтении (ссылка ведёт в ленд, которого некому открыть) и
// `denied` на записи (сущности положено родиться в ленде, доступа к которому
// нет). Права уровня ленда — работа S6; место под ответ занято сейчас, потому
// что молчание — это то, что чинится годами.
//
// ─── Чего этот файл НЕ импортирует и почему ──────────────────────────────────
//
// `binding.ts` и `space.ts` — только типами. `kinds.ts` (таблица видов) импортирует
// этот файл, а `binding.ts` импортирует `kinds.ts`; возьми мы `openDoc` значением,
// получился бы цикл, в котором `kinds.ts` читает наши `const`-таблицы методов
// раньше, чем они созданы, — TDZ ровно на том пути, где модуль загружают начиная
// с `link.ts`. Документы открываются через `core.space.doc()`, который делает то
// же самое и уже лежит в ядре пространства.

import { untracked } from '@sync/fiber'
import { Link } from '../binary/link'
import { type Vary, varyEqual } from '../binary/vary'
import { ROOT, type SandView } from '../land/view'
import { predictItem, predictKey } from './address'
import { type Handle, type Head, SPOT } from './channel'
import { type Cell, cellOf, firstOf, mountSlot } from './cell'
import type { Born, LinkField, LinksField, PartField } from './field'
import { describe, ModelError, type Issue } from './issue'
// Реконсиляция берётся у списка, а не пишется здесь второй раз: «сколько юнитов
// родила правка» — вопрос, на который в слое обязан быть ОДИН ответ, а две копии
// алгоритма расходятся не сразу, а на кейсе конкурентного слияния.
import { reconcile } from './list'
import { type AnyModel, modelOf } from './model'
import { nestSlot } from './nest'
import type { ModelName } from './registry'
import type { Space, SpaceCore } from './space'
import { t } from './value'

/** Пешка — 22 байта: peer(8) + area(8) + head(6). Всё короче ссылкой на сущность не является. */
const PAWN_BYTES = 22
/** Смещение локального id внутри пешки. */
const PAWN_HEAD_AT = 16

/** Пустая выдача множественной ссылки — одна на модуль (правило 7 горячего пути). */
const NO_DOCS: readonly object[] = Object.freeze([])

/**
 * Линза ссылки — одна на модуль.
 *
 * `t.link`, а не своя: значение ссылки в ленде — это те же байты, что у
 * `atom(t.maybe(t.link))`, и на этом стоит бесплатность `cast` между ними.
 */
const REF = t.link

// ── Чтение ───────────────────────────────────────────────────────────────────

/**
 * Ссылка на отдельную сущность: первый живой ребёнок слота, разобранный как пешка.
 *
 * НИКОГДА не бросает — ни на мусоре, ни на ссылке в неизвестный ленд, ни на
 * значении, вынесенном в `ball`. Один недобросовестный пир не имеет права
 * уронить приложение (docs/05 §4).
 */
export function readLink(core: SpaceCore, cell: Cell, head: Head): unknown {
  const slot = cell.slot(head)
  if (slot === ROOT) return null

  const view = firstOf(core, slot)
  if (view === null) return null
  return docOf(core, cell, head, view, (cell.field as LinkField<ModelName>).to)
}

/**
 * Множественная ссылка: все живые дети слота.
 *
 * Битая ссылка ВЫПАДАЕТ из выдачи и даёт `Issue`. Альтернатива — дырка `null`
 * посреди массива — сделала бы тип `readonly (Doc | null)[]` и заставила бы
 * каждого читателя проверять каждый элемент ради чужого мусора.
 */
export function readLinks(core: SpaceCore, cell: Cell, head: Head): unknown {
  const slot = cell.slot(head)
  if (slot === ROOT) return NO_DOCS

  const kids = core.order(slot)
  if (kids.length === 0) return NO_DOCS

  const to = (cell.field as LinksField<ModelName>).to
  const out: object[] = []
  for (let i = 0; i < kids.length; i++) {
    const doc = docOf(core, cell, head, kids[i] as SandView, to)
    if (doc !== null) out.push(doc)
  }
  return out
}

/**
 * Вложенная часть: документ по адресу слота. `null` не бывает.
 *
 * Юнитов не пишет. Ключевой юнит появится при первой записи ВНУТРЬ части —
 * см. `nest.ts`, там объяснено, почему иначе «часть живёт в поддереве родителя»
 * было бы неправдой.
 */
export function readPart(core: SpaceCore, cell: Cell, head: Head): unknown {
  const model = modelFor((cell.field as PartField<ModelName>).of, 'part')
  return docAt(core.space, model, nestSlot(core, cell, head))
}

// ── Запись ───────────────────────────────────────────────────────────────────

/** Записать ссылку. `null` — стереть. */
export function writeLink(core: SpaceCore, cell: Cell, head: Head, next: unknown): void {
  putRef(core, cell, head, next === null ? null : refOf(next))
}

/** Записать состав множественной ссылки — РЕКОНСИЛЯЦИЕЙ, а не перезаписью. */
export function writeLinks(core: SpaceCore, cell: Cell, head: Head, next: unknown): void {
  const docs = next as readonly unknown[]

  const values: Vary[] = []
  for (let i = 0; i < docs.length; i++) values.push(REF.encode(local(core, refOf(docs[i]))))

  const slot = untracked(() => cell.slot(head))
  // Пустой состав в пустое поле: ключевой юнит ради пустоты не заводим — он
  // навсегда уехал бы по проводу и ничего бы не сообщил.
  if (slot === ROOT && values.length === 0) return

  const at = slot === ROOT ? mountSlot(core, head, cell.key, cell.field) : slot
  const prev = untracked(() => core.order(at))
  reconcile(core, at, prev, values, 0, prev.length)
}

/** Часть целиком не пишется: у неё нет значения, есть поддерево. */
export function writePart(_core: SpaceCore, cell: Cell): void {
  throw new ModelError(
    `field «${cell.key}» is a nested part: it always exists and is written one field at a time (post.stats().views(1)), not whole`,
    'part',
  )
}

// ── Методы каналов ───────────────────────────────────────────────────────────

/**
 * Таблица методов ссылки: создаётся ОДИН раз на (модель, поле).
 *
 * Приёмник определяется вызовом (`this`) — решение Р4. Прикладной код пишет
 * `post.author.ensure()` и не видит ни `this`, ни классов: ограничение 1
 * запрещает их ПРИКЛАДНИКУ, а не реализации.
 */
export const LINK_METHODS: Readonly<Record<string, unknown>> = Object.freeze({
  /** Явная запись. Возвращает победителя LWW, а не то, что записали. */
  set(this: Handle, next: object | null): unknown {
    const cell = cellOf(this)
    return cell.value(this[SPOT].head, next)
  },

  /**
   * Создать, если ещё нет. Идемпотентно и ДЕТЕРМИНИРОВАННО.
   *
   * Адрес — `H(соль ‖ ссылка на само поле)` (docs/05 §5), поэтому два пира,
   * одновременно позвавшие `ensure` на одном поле, получат ОДНУ сущность и
   * сойдутся. Возьми адрес рандомом — получишь две сущности и потерянные данные.
   */
  ensure(this: Handle, born?: Born): object {
    const cell = cellOf(this)
    const core = cell.core
    const head = this[SPOT].head
    const field = cell.field as LinkField<ModelName>
    const model = modelFor(field.to, 'link.ensure')

    // Уже есть — тот же документ. Проверка идёт БЕЗ подписки: `ensure` это
    // запись, и подписывать пишущего на то, что он сам меняет, значит будить его
    // собственной правкой.
    const found = untracked(() => cell.value(head)) as object | null
    if (found !== null) return found

    const slot = mountSlot(core, head, cell.key, cell.field)
    const site = bornAt(core, cell, head, born ?? field.born, slot)
    putRef(core, cell, head, site.at)
    return docAt(site.space, model, site.at)
  },

  /** Стереть ссылку: постится надгробие. Сама сущность остаётся жить. */
  clear(this: Handle): void {
    const cell = cellOf(this)
    putRef(cell.core, cell, this[SPOT].head, null)
  },
})

/** Таблица методов множественной ссылки. */
export const LINKS_METHODS: Readonly<Record<string, unknown>> = Object.freeze({
  set(this: Handle, next: readonly object[]): unknown {
    const cell = cellOf(this)
    return cell.value(this[SPOT].head, next)
  },

  size(this: Handle): number {
    const cell = cellOf(this)
    return (cell.value(this[SPOT].head) as readonly object[]).length
  },

  at(this: Handle, index: number): object | null {
    const cell = cellOf(this)
    return (cell.value(this[SPOT].head) as readonly object[])[index] ?? null
  },

  /**
   * Сравнение по ССЫЛКЕ, а не по идентичности объекта.
   *
   * Идентичность документа держится картой пространства, а сущность из соседнего
   * ленда приходит из ДРУГОГО пространства — сравнивать такие объекты через
   * `===` значило бы получать `false` там, где адрес один. Ровно этим болел
   * `sand_move` в baza (реестр, п. 38): ветвление по идентичности JS-объекта
   * `Link`, который пересоздаётся при каждой гидрации.
   */
  has(this: Handle, doc: object): boolean {
    const cell = cellOf(this)
    const target = refOf(doc)
    const items = cell.value(this[SPOT].head) as readonly object[]
    for (let i = 0; i < items.length; i++) {
      if (refOf(items[i] as object).equals(target)) return true
    }
    return false
  },

  /** Привязать существующую сущность. В КОНЕЦ — порядок часть контракта (реестр, п. 29). */
  add(this: Handle, doc: object): void {
    const cell = cellOf(this)
    const core = cell.core
    const head = this[SPOT].head
    const at = mountSlot(core, head, cell.key, cell.field)
    const raw = REF.encode(local(core, refOf(doc)))
    const lead = tailOf(core, at)
    core.post(at, lead, predictItem(core.land, core.salt, at, lead, raw), raw, 'term')
  },

  /**
   * Создать НОВУЮ сущность и сразу привязать.
   *
   * Отличие от `ensure` принципиальное: `ensure` обязан быть детерминированным
   * (два пира на одном поле — одна сущность), а `attach` обязан быть УНИКАЛЬНЫМ
   * (два пира, добавившие каждый по элементу, — две сущности). Контентный адрес
   * второго не даёт: одинаковые входы дают один адрес, и две «новые» сущности
   * слиплись бы в одну.
   *
   * Единственный источник уникального адреса в ленде — счётчик пира, и добраться
   * до него можно только чеканкой (`land.post`). Поэтому чеканим НАДГРОБИЕМ:
   * оно даёт свежий `self`, невидимо для `order()` (тот отдаёт только живых) и
   * служит якорем самому элементу. Цена названа: два юнита на `attach` вместо
   * одного.
   */
  attach(this: Handle, born?: Born): object {
    const cell = cellOf(this)
    const core = cell.core
    const head = this[SPOT].head
    const field = cell.field as LinksField<ModelName>
    const model = modelFor(field.to, 'links.attach')

    const at = mountSlot(core, head, cell.key, cell.field)
    const seed = core.land.post(at, tailOf(core, at), null, 'term')
    const site = bornAt(core, cell, head, born ?? field.born, seed.self)

    const raw = REF.encode(local(core, site.at))
    core.post(at, seed.self, predictItem(core.land, core.salt, at, seed.self, raw), raw, 'term')
    return docAt(site.space, model, site.at)
  },

  remove(this: Handle, doc: object): void {
    const cell = cellOf(this)
    const core = cell.core
    const slot = untracked(() => cell.slot(this[SPOT].head))
    if (slot === ROOT) return

    const target = refOf(doc)
    const kids = untracked(() => core.order(slot))
    for (let i = 0; i < kids.length; i++) {
      const view = kids[i] as SandView
      const at = absolute(core, view)
      if (at !== null && at.equals(target)) {
        core.remove(view.self)
        return
      }
    }
  },

  /**
   * Перестановка. Меняется `lead` перемещаемого узла, соседа никто не переписывает
   * — репойнт следующего делает сам ленд (реестр, п. 38).
   */
  move(this: Handle, from: number, to: number): void {
    const cell = cellOf(this)
    const core = cell.core
    const slot = untracked(() => cell.slot(this[SPOT].head))
    if (slot === ROOT) return

    const kids = untracked(() => core.order(slot))
    const self = (kids[from] as SandView | undefined)?.self
    if (self === undefined || to < 0 || to >= kids.length || from === to) return

    // Якорь считается по составу БЕЗ перемещаемого узла: «встать на позицию `to`»
    // и «встать за элементом с индексом `to - 1`» — разные вещи, и путать их
    // значит промахиваться на единицу при движении вперёд.
    const rest: SandView[] = []
    for (let i = 0; i < kids.length; i++) {
      if (i !== from) rest.push(kids[i] as SandView)
    }
    core.land.move(self, to === 0 ? ROOT : (rest[to - 1] as SandView).self)
  },

  clear(this: Handle): void {
    const cell = cellOf(this)
    const core = cell.core
    const slot = untracked(() => cell.slot(this[SPOT].head))
    if (slot === ROOT) return
    // Копия: `remove` бьёт сигнал формы головы, а мы идём по её же выдаче.
    const doomed = untracked(() => core.order(slot)).slice()
    for (let i = 0; i < doomed.length; i++) core.remove((doomed[i] as SandView).self)
  },
})

// ── Гранулярность рождения ───────────────────────────────────────────────────

/** Где родится сущность и какой у неё абсолютный адрес. */
interface Site {
  readonly space: Space
  readonly at: Link
}

/**
 * Разобрать `born` (docs/05 §5) — прямой порт `ensure_here`/`ensure_area`/
 * `ensure_lord`.
 *
 * Место рождения объявляется В СХЕМЕ и переопределяется в вызове. Это
 * единственное место, где прикладной разработчик обязан подумать про
 * гранулярность синхронизации, и прятать этот выбор значило бы спрятать самое
 * дорогое решение в приложении.
 */
function bornAt(core: SpaceCore, cell: Cell, head: Head, born: Born, anchor: Head): Site {
  // «Ссылка на само поле» (docs/05 §5) — абсолютный адрес якоря. Именно адрес, а
  // не имя поля: два поста с полем `author` обязаны родить РАЗНЫХ авторов. У
  // `ensure` якорь — слот поля (отсюда детерминизм), у `attach` — свежий
  // отчеканенный узел (отсюда уникальность).
  const idea = Link.pawn(core.id, core.land.idOf(anchor)).str

  if (born === 'here') {
    return { space: core.space, at: Link.pawn(core.id, core.land.idOf(seedOf(core, idea))) }
  }

  const land = born === 'area'
    ? Link.land(core.id.peer(), areaOf(core, idea))
    : born.land

  let space: Space
  try {
    space = core.space.of(land)
  } catch (error) {
    // Реестр, п. 35: отказ не бывает молчаливым. Ленд, которого некому открыть,
    // — это отказ в доступе, и он обязан быть виден и в диагностике
    // пространства, и в трассе исключения.
    core.report(deny(core, cell, head, anchor, land, error))
    throw error
  }

  return { space, at: Link.pawn(land, core.land.idOf(seedOf(core, idea))) }
}

/**
 * Детерминированный адрес новой сущности: `H(соль ‖ ссылка на само поле)`.
 *
 * Считается в НАШЕМ ленде и переносится в целевой байтами: узел, отчеканенный
 * здесь, интернирует ровно один номер и больше ничего не стоит, а заводить
 * третью формулу адреса ради шести байт было бы хуже — формул адреса ровно две
 * (`predictKey` для ключа, `predictItem` для элемента), и третья разошлась бы с
 * ними при первой же правке.
 */
function seedOf(core: SpaceCore, idea: string): Head {
  return predictKey(core.land, core.salt, ROOT, idea)
}

/** Восемь байт area из того же хэша: позиция секции — часть значения (`_AREA`). */
function areaOf(core: SpaceCore, idea: string): Uint8Array {
  const out = new Uint8Array(8)
  out.set(core.land.idOf(predictKey(core.land, core.salt, ROOT, `area:${idea}`)), 2)
  return out
}

// ── Общая механика ссылки ────────────────────────────────────────────────────

/**
 * Положить ссылку в слот. `null` — надгробие.
 *
 * Дисциплина та же, что у записи атома (`atom.ts`): якорь `ROOT`, прежний `self`,
 * идемпотентность. Копия, а не общая функция, — это второе повторение, а не
 * третье (PRINCIPLES, правило трёх); общей она станет вместе со списком и
 * словарём, когда станет ясно, что у всех троих она одна и та же.
 *
 * Якорь в начало — потому что новая версия обязана стать ПЕРВЫМ живым ребёнком:
 * иначе `link` перестанет видеть то, что положил `links`-вид, и `cast` между
 * ними станет ложью.
 */
function putRef(core: SpaceCore, cell: Cell, head: Head, to: Link | null): void {
  const raw: Vary = to === null ? null : REF.encode(local(core, to))

  const slot = untracked(() => cell.slot(head))
  const prev = slot === ROOT ? null : untracked(() => firstOf(core, slot))

  if (prev === null) {
    // Стирать нечего: надгробие над пустотой ничего не меняет, зато навсегда
    // уезжает по проводу.
    if (raw === null) return
  } else if (raw === null) {
    core.remove(prev.self)
    return
  } else if (varyEqual(core.valueOf(prev) as Vary, raw)) {
    return
  }

  const at = slot === ROOT ? mountSlot(core, head, cell.key, cell.field) : slot
  const self = prev === null ? predictItem(core.land, core.salt, at, ROOT, raw) : prev.self
  core.post(at, ROOT, self, raw, 'term')
}

/**
 * Юнит → документ. Здесь и только здесь ссылка становится сущностью.
 *
 * Порт инварианта `land.test` «Inner Links are relative to forked Land»: ссылка
 * внутрь своего ленда хранится ОТНОСИТЕЛЬНОЙ (6 значащих байт вместо 22) и
 * переразрешается на читающий ленд. Без этого форк ленда ссылался бы на
 * внутренности оригинала, а не на свои.
 */
function docOf(core: SpaceCore, cell: Cell, head: Head, view: SandView, to: ModelName): object | null {
  const raw = core.valueOf(view)
  if (raw === null) {
    if (core.broken(view)) {
      core.report(issueAt(core, cell, head, view, 'shape', 'pawn', 'bytes the codec does not know'))
    }
    return null
  }

  const at = REF.decode(raw)
  if (at === null) {
    core.report(issueAt(core, cell, head, view, 'decode', 'pawn', describe(raw)))
    return null
  }

  const bin = at.bin
  if (bin.length !== PAWN_BYTES) {
    // Ссылка уровня лорда или ленда — это не сущность. Молча вернуть `null`
    // значило бы повторить п. 35: «нет значения» и «мусор» слиплись бы.
    core.report(issueAt(core, cell, head, view, 'broken-link', 'pawn', at.str || '(empty)'))
    return null
  }

  const model = modelFor(to, 'link')
  // Разрешение — СРАВНЕНИЕМ БАЙТ, а не построением ссылок.
  //
  // Первая редакция звала `at.resolve(core.id).land().equals(core.id.land())`, и
  // это три `Link` на каждое разыменование, каждая с копией байт в `tighten`.
  //
  // Замер до и после, по три прогона (медиана): пересборка тысячи ссылок
  // 1.446 → 1.036 мс, то есть **−28 %**; одиночное холодное разыменование
  // 6.48 → 6.17 мкс, то есть 5 % — на уровне шума. И это правильный вывод, а не
  // разочарование: в одиночном чтении львиную долю занимают `keyIndex` головы и
  // открытие документа-цели, а цена трёх ссылок видна там, где разыменование
  // повторяется под уже прогретой головой. Текст ссылки строится только там,
  // где её показывают человеку.
  if (homely(bin, core.id.bin)) {
    return docAt(core.space, model, core.land.nodeOf(bin.subarray(PAWN_HEAD_AT, PAWN_BYTES)))
  }

  try {
    return docAt(core.space.of(at.land()), model, at)
  } catch {
    // Соседний ленд некому открыть. Это ожидаемое состояние, а не исключение:
    // ссылки живут дольше доступов, и приложение обязано пережить ссылку в ленд,
    // которого у него нет.
    core.report(issueAt(core, cell, head, view, 'broken-link', 'pawn', at.str))
    return null
  }
}

/**
 * Указывает ли пешка внутрь ЭТОГО ленда.
 *
 * Два случая сразу и одним проходом: относительная форма (`__HEAD`, шестнадцать
 * нулевых байт) и абсолютная, совпавшая с нашим лендом. Первая — наш обычный
 * способ хранения (порт `land.test` «Inner Links are relative to forked Land»),
 * вторая — то, что мог прислать пир, не сделавший `relate`.
 */
function homely(bin: Uint8Array, id: Uint8Array): boolean {
  let relative = true
  let same = true
  for (let i = 0; i < PAWN_HEAD_AT; i++) {
    const byte = bin[i] as number
    if (byte !== 0) relative = false
    // Короткая ссылка добивается нулями — ровно так же, как это делает `tighten`.
    if (byte !== (id[i] ?? 0)) same = false
    if (!relative && !same) return false
  }
  return true
}

/** Абсолютный адрес сущности, на которую смотрит юнит. `null` — юнит не ссылка. */
function absolute(core: SpaceCore, view: SandView): Link | null {
  const raw = core.valueOf(view)
  if (raw === null) return null
  const at = REF.decode(raw)
  return at === null ? null : at.resolve(core.id)
}

/** Абсолютный адрес документа. Работает и на документе соседнего пространства. */
function refOf(doc: unknown): Link {
  return (doc as { readonly $: { link(): Link } }).$.link()
}

/** Относительная форма для своего ленда: 6 значащих байт вместо 22. */
function local(core: SpaceCore, at: Link): Link {
  return at.relate(core.id)
}

/** Последний живой ребёнок — якорь для добавления В КОНЕЦ. */
function tailOf(core: SpaceCore, at: Head): Head {
  const kids = untracked(() => core.order(at))
  return kids.length === 0 ? ROOT : (kids[kids.length - 1] as SandView).self
}

function docAt(space: Space, model: AnyModel, at: Link | Head): object {
  return space.doc(model as AnyModel<ModelName>, at) as unknown as object
}

/**
 * Модель по имени.
 *
 * Промах карты значит ровно одно — файл модели не загружен, и сообщение говорит
 * именно это. Соврать чужим именем тип уже не даст: `ModelName` его отвергнет.
 */
function modelFor(name: ModelName, at: string): AnyModel {
  const found = modelOf(name)
  if (found === undefined) {
    throw new ModelError(
      `model «${name}» is not declared in this process: import the file with its model(...)`,
      at,
    )
  }
  return found
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

function deny(core: SpaceCore, cell: Cell, head: Head, slot: Head, land: Link, error: unknown): Issue {
  return {
    kind: 'denied',
    land: core.id,
    head,
    self: slot,
    peer: null,
    field: cell.key,
    expected: `write into land ${land.str || '(empty)'}`,
    got: error instanceof Error ? error.message : String(error),
  }
}
