// v8:hot — `$` создаётся на КАЖДЫЙ открытый документ, значит его цена входит в
// бюджет `doc/open` и `doc/mem` (docs/05 §8.5).
//
// ─── `$` — операции уровня документа ─────────────────────────────────────────
//
// Единственное зарезервированное имя поля, и запрет на него держит ТИП
// (`NoReserved`), а не проверка в рантайме.
//
// Методы ОБЩИЕ, приёмник определяется вызовом — то же решение Р4, что у каналов
// поля, и по той же причине, но здесь она измерена: первая редакция строила
// десять замыканий на документ, и `doc/open` стоил 2.20 мкс при бюджете 1.00, а
// `doc/mem` — 3008 Б при бюджете 2048. Общая таблица превращает десять
// аллокаций функций в тринадцать записей свойств в объект одной формы.
//
// `changedAt()` и `authors()` — МЕТОДЫ, а не каналы, и это сознательно
// (docs/05 §1.5): под ними полный обход поддерева, и выглядеть дёшево они не
// должны. Канал сделал бы их неотличимыми от `post.title()`, и кто-нибудь
// поставил бы обход в цикл рендера.

import { Link } from '../binary/link'
import type { SandView } from '../land/view'
import type { DocOps, Head, Peer } from './channel'
import { SPOT } from './channel'
import type { Binding } from './cell'
import type { ModelName } from './registry'
import type { SpaceCore } from './space'
import { t, type Key } from './value'

/** Потолок обхода поддерева: чужой ленд может прислать кольцо голов. */
const WALK_MAX = 1 << 20

/** Имя meta-слота: ключевой юнит с пустым именем (см. `space.ts`, `keyIndex`). */
const META = ''

/** Привязка, на которой стоит документ. Символ, чтобы не резервировать имя. */
const BIND: unique symbol = Symbol('sync.bind')

/** Приёмник методов `$`: всё, что им нужно, лежит в двух собственных полях. */
interface Ops extends DocOps<ModelName> {
  readonly [BIND]: Binding
}

const DOC_METHODS = Object.freeze({
  /** Абсолютная ссылка: ключ в сети, в devtools и в `link`-полях. */
  link(this: Ops): Link {
    const core = this[BIND].core
    return Link.pawn(core.id, core.land.idOf(this[SPOT].head))
  },

  /** Есть ли хоть один юнит. Отличает «пусто» от «не создавали». */
  exists(this: Ops): boolean {
    return this[BIND].core.order(this[SPOT].head).length > 0
  },

  /**
   * Ссылка на схему из meta-слота.
   *
   * Слот пуст, пока версию схемы никто не пишет: миграции в S4 не входят
   * (docs/05 §10), и врать про них каналом было бы хуже, чем честный `null`.
   */
  meta(this: Ops): Link | null {
    const core = this[BIND].core
    const slot = metaOf(core, this[SPOT].head)
    if (slot === null) return null
    const first = core.order(slot.self)[0]
    if (first === undefined) return null
    const raw = core.valueOf(first)
    return raw === null ? null : t.link.decode(raw)
  },

  /**
   * Для UI: гасить кнопку заранее, а не ловить молчаливый отказ записи.
   *
   * Пока всегда `true`: права — работа S6, и ленд их не разбирает вовсе
   * (`land.ts` пропускает `gift`/`seal`/`pass`). Канал заведён сейчас потому,
   * что у baza `dive` при отказе прав молча возвращал `null`, неотличимый от
   * «нет значения» (реестр, п. 35), и место под честный ответ должно быть
   * занято до того, как ответ появится.
   */
  canWrite(this: Ops): boolean {
    return true
  },

  /** ЯВНО ленивое: полный обход поддерева. */
  changedAt(this: Ops): Date | null {
    let latest = 0
    walk(this[BIND].core, this[SPOT].head, view => {
      if (view.time > latest) latest = view.time
    })
    return latest === 0 ? null : new Date(latest * 1000)
  },

  /** ЯВНО ленивое: полный обход поддерева. */
  authors(this: Ops): readonly Peer[] {
    const seen = new Set<string>()
    const out: Peer[] = []
    walk(this[BIND].core, this[SPOT].head, view => {
      const peer = Link.peer(view.peer)
      const key = peer.str
      if (seen.has(key)) return
      seen.add(key)
      out.push(peer)
    })
    return out
  },

  /**
   * Ключи, которых нет в схеме: то, что прислал узел новой версии.
   *
   * Схема — ЛИНЗА, а не ограничение на диске (docs/05 §7.11): другой пир кладёт
   * в ленд что хочет, и единственный честный ответ на это — показать, что именно
   * он положил, а не притвориться, что его нет.
   */
  extras(this: Ops): readonly Key[] {
    const bind = this[BIND]
    const schema = bind.model.schema
    const out: Key[] = []
    for (const key of bind.core.keyIndex(this[SPOT].head).keys()) {
      if (!Object.hasOwn(schema, key)) out.push(key)
    }
    return out
  },

  /**
   * Стереть документ: надгробие на каждый ключевой юнит.
   *
   * Поддерево ключа не обходится: мёртвый ключ выпадает из `keyIndex`, значит ни
   * одно поле его больше не найдёт, а `order()` продолжает спускаться в детей
   * надгробий — на этом держится позиция вставки после удаления. Глубокое
   * стирание (со всеми значениями) — работа сборщика, а не документа.
   */
  drop(this: Ops): void {
    const core = this[BIND].core
    // Копия: `remove` бьёт сигнал формы головы, а мы идём по её же выдаче.
    const doomed = core.order(this[SPOT].head).slice()
    for (let i = 0; i < doomed.length; i++) core.remove((doomed[i] as SandView).self)
  },
})

/**
 * `$` документа: три собственных поля и общая таблица методов.
 *
 * Порядок вставки один и тот же на всех документах, поэтому все `$` сходятся к
 * одной карте скрытых классов — как и сами документы.
 */
export function docOps(core: SpaceCore, bind: Binding, head: Head): DocOps<ModelName> {
  const base = {
    [SPOT]: { land: core.id, head, field: '' },
    [BIND]: bind,
    model: bind.model.name as ModelName,
  }
  return Object.assign(base, DOC_METHODS) as unknown as DocOps<ModelName>
}

/** Meta-слот: отфильтрован из `keyIndex` намеренно, поэтому ищется проходом. */
function metaOf(core: SpaceCore, head: Head): SandView | null {
  const kids = core.order(head)
  for (let i = 0; i < kids.length; i++) {
    const view = kids[i] as SandView
    if (core.valueOf(view) === META) return view
  }
  return null
}

/**
 * Обход поддерева. Со счётчиком и множеством посещённых: голова — это чужие
 * данные, и кольцо `A → B → A` в них представимо, а необходимости в нём нет ни у
 * кого.
 */
function walk(core: SpaceCore, from: Head, visit: (view: SandView) => void): void {
  const stack: Head[] = [from]
  const seen = new Set<Head>([from])
  let budget = WALK_MAX

  while (stack.length > 0 && budget-- > 0) {
    const kids = core.order(stack.pop() as Head)
    for (let i = 0; i < kids.length; i++) {
      const view = kids[i] as SandView
      if (seen.has(view.self)) continue
      seen.add(view.self)
      visit(view)
      stack.push(view.self)
    }
  }
}
