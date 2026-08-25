// v8:hot — `order` и `keyIndex` лежат под КАЖДЫМ чтением поля.
//
// ─── Три канала и ни одного объектного ключа ─────────────────────────────────
//
// docs/05 §3.2. У baza `sand_ordered` мемоизирован по литералу `{head, peer}`:
// на каждый вызов аллокация объекта плюс сериализация в строковый ключ — на
// самом горячем пути, под которым лежит вообще всё чтение модели (реестр, п. 25).
// Здесь ключ — примитив, и ни одной конкатенации нет нигде: срез по пиру, когда
// он появится, выражается карри (`orderOf(peer)(head)`), а не склейкой строк.
//
// ─── Почему `order` отдаёт ВИДЫ, а не номера узлов ───────────────────────────
//
// Это стоило одного неверного захода, и он записан здесь, чтобы не повторился.
// `Land.nodes()` дешевле `Land.order()` — он не материализует `SandView`, — но
// отдаёт ТОЛЬКО СОСТАВ детей. Перезапись значения по тому же `self` состава не
// меняет, поэтому `Fiber.put` со структурным сравнением честно гасит
// распространение, и второе подряд `title(x)` возвращает первое значение.
// `Land.order()` отдаёт виды, а вид пересоздаётся при смене победителя узла —
// значит массив видов различается ровно тогда, когда различается СОДЕРЖИМОЕ.
// Одна подписка на голову вместо подписки на каждого ребёнка, и правильная.
//
// Виды при этом заводятся только на РЕАЛЬНО ПРОЧИТАННЫЕ узлы и кэшируются самим
// лендом, так что +194 Б/юнит из ADR-016 платятся не за ленд, а за прочитанное.

import { Link } from '../binary/link'
import type { LandId } from '../binary/pack'
import { UnitError, type SandTag } from '../binary/unit'
import { VaryError, type Vary } from '../binary/vary'
import type { Land } from '../land/land'
import { ROOT, type SandView } from '../land/view'
import { batch, computed, type KeyedComputedRef } from '@sync/fiber'
import type { Doc, Head } from './channel'
import { ModelError, warnIssue, type Issue } from './issue'
import { type AnyModel, modelOf } from './model'
import type { ModelName } from './registry'
import { openDoc } from './binding'

/** Пустая карта ключей — одна на модуль: у документа без юнитов ключей нет. */
const NO_KEYS: ReadonlyMap<string, Head> = Object.freeze(new Map<string, Head>())

const EMPTY_SALT = new Uint8Array(0)

/** Голова ленда как адрес корневого документа. */
export const ROOT_HEAD: Head = ROOT

export interface SpaceOptions {
  readonly land: Land
  /** Абсолютный адрес ленда. По умолчанию — пустая ссылка (одноленовый стенд). */
  readonly id?: LandId
  /**
   * Соль контентных адресов. Секрет ленда: внутри ленда адреса детерминированы,
   * снаружи хэш не выдаёт содержимого (docs/05 §3.6).
   */
  readonly salt?: Uint8Array
  /** По умолчанию — предупреждение с полным контекстом. */
  readonly report?: (issue: Issue) => void
  /** Как открыть соседний ленд. Без него `of()` честно отказывается. */
  readonly open?: (land: LandId) => Space
  /**
   * Разрешение читать: зовётся перед КАЖДЫМ обращением к составу детей.
   *
   * Сюда подключается гидрация (`store/vault.ts`): пока ленд едет из хранилища,
   * функция ПРИОСТАНАВЛИВАЕТ файбер, а когда данные приехали — становится
   * чтением готового канала (ADR-002: `post.title()` остаётся синхронным, хотя
   * под ним IDB). Без хранилища не передаётся вовсе и не стоит ничего.
   *
   * Ставится именно на `order`, а не на каждое поле, потому что через него
   * проходит ВСЁ чтение слоя: `keyIndex`, `slot`, значение, списки, словари и
   * текст. Один вызов на холодный пересчёт канала, а не на чтение.
   */
  readonly ready?: () => void
}

export interface Space {
  readonly land: LandId
  /** Корневой документ ленда. */
  root<N extends ModelName>(model: AnyModel<N> | N): Doc<N>
  /** Документ по адресу. Мемоизирован: два вызова дают ОДИН объект (`===`). */
  doc<N extends ModelName>(model: AnyModel<N> | N, at: Link | Head): Doc<N>
  /** Соседний ленд того же узла. */
  of(land: LandId): Space
  /** Транзакция: одна метка времени на все записи и один flush наружу. */
  edit<R>(fn: () => R): R
  /** Подписка на диагностику. Возвращает отписку. */
  onIssue(handle: (issue: Issue) => void): () => void
  /** Внутренняя ручка слоя. Публичному коду не нужна, следующему слою — нужна. */
  readonly [CORE]: SpaceCore
}

/**
 * Ключ внутренней ручки пространства.
 *
 * Экспортируется намеренно: списки, словари, текст, ссылки и `cast` собираются
 * ПОВЕРХ этого основания и обязаны получить те же каналы, а не завести свои —
 * иначе один и тот же состав детей окажется в двух кэшах и даст два ответа.
 */
export const CORE: unique symbol = Symbol('sync.space.core')

/** Всё, что нужно видам полей от пространства. */
export interface SpaceCore {
  readonly space: Space
  readonly land: Land
  readonly id: LandId
  readonly salt: Uint8Array
  /** Живые дети головы в порядке чтения, видами. Одна подписка на голову. */
  readonly order: KeyedComputedRef<Head, readonly SandView[]>
  /** Имя ключа → `self` ключевого юнита. Инвалидируется составом детей головы. */
  readonly keyIndex: KeyedComputedRef<Head, ReadonlyMap<string, Head>>
  /**
   * Значение вида — без броска.
   *
   * РАНЬШЕ здесь проверялся маркер выноса в `ball`: значения длиннее 62 байт
   * ленд хранить не умел, и `SandView.value` на них бросал. S5 это закрыла —
   * выносное значение лежит в том же слоте арены и читается как обычное.
   *
   * Осталась вторая причина не доверять байтам, и она никуда не денется: их
   * прислал ЧУЖОЙ пир. Кодек значений на неизвестном теге бросает, а чтение поля
   * бросать не имеет права ни при каком входе (docs/05 §4) — поэтому отказ
   * разбора становится `null`, а причину для `Issue` даёт {@link SpaceCore.broken}.
   */
  valueOf(view: SandView): Vary | null
  /** Байты есть, но кодек их не разбирает. Холодный путь: только для `Issue`. */
  broken(view: SandView): boolean
  post(head: Head, lead: Head, self: Head, value: Vary, tag: SandTag): void
  /** Надгробие поверх живого узла. `lead` и `tag` переносит сам ленд. */
  remove(node: Head): boolean
  report(issue: Issue): void
}

/**
 * Пространство: ленд, приёмник диагностики и транзакция в одном месте.
 *
 * Ambient-контекста нет (ADR-010): `space` передаётся явно. Глобальный `onWarn`
 * не годится, потому что лендов в процессе много, и диагностика одного не должна
 * приезжать подписчику другого.
 *
 * @example
 * ```ts
 * const space = createSpace({land})
 * const post = space.root(Post)
 * post.title('Файберы и CRDT')
 * ```
 */
export function createSpace(options: SpaceOptions): Space {
  const land = options.land
  const id = options.id ?? Link.hole
  const salt = options.salt ?? EMPTY_SALT
  const sink = options.report ?? warnIssue
  const open = options.open
  const listeners = new Set<(issue: Issue) => void>()

  // Дети головы в порядке чтения. Ключ — ЧИСЛО: голова на байтовом ленде это
  // плотный номер узла, и материализовать из него строку пришлось бы на каждый
  // lookup (ADR-016: 604 → 1336 мкс на 10 000 вставок).
  const gate = options.ready
  const order = gate === undefined
    ? computed.keyed((head: Head) => land.order(head))
    : computed.keyed((head: Head) => {
      gate()
      return land.order(head)
    })

  // Ключ поля → `self` ключевого юнита. Запись ЗНАЧЕНИЯ поля сюда не попадает:
  // она живёт в поддереве ключевого юнита и бьёт сигнал ЕГО головы, а не этой.
  const keyIndex = computed.keyed((head: Head): ReadonlyMap<string, Head> => {
    const kids = order(head)
    if (kids.length === 0) return NO_KEYS

    const out = new Map<string, Head>()
    for (let i = 0; i < kids.length; i++) {
      const view = kids[i] as SandView
      const value = valueOf(view)
      // Meta-слот: ключевой юнит с пустым именем.
      //
      // РАСХОЖДЕНИЕ С docs/05, вынужденное форматом: там meta живёт под
      // `self = hole`, но ленд на байтах такой юнит отвергает на приёме — корень
      // это сентинел, а не узел, и юнит с нулевым `self` сделал бы корень своим
      // же ребёнком, а обход слоя моделей — бесконечным. Пустое имя поля
      // недостижимо для схемы (ключи схемы непусты), поэтому роль «слот не для
      // данных» оно исполняет так же, а `$.meta()` его находит.
      if (value === '') continue
      const key = typeof value === 'string' ? value : typeof value === 'number' ? String(value) : null
      if (key === null) continue
      // `order()` уже разложил сиблингов детерминированно по LWW — первый и есть
      // победитель ключа.
      if (!out.has(key)) out.set(key, view.self)
    }
    return out
  })

  function valueOf(view: SandView): Vary | null {
    // `try/catch` НА ГРАНИЦЕ ФУНКЦИИ, а не внутри цикла (правило 9 горячего
    // пути): вызывающие обходят детей головы, и обёртка на итерацию мешала бы
    // оптимизации. Замер цены — `bench/model.mjs`, гейт `field/cold`.
    try {
      return view.value
    } catch (error) {
      if (error instanceof VaryError) return null
      throw error
    }
  }

  function broken(view: SandView): boolean {
    try {
      view.value
      return false
    } catch {
      // Проглатывания здесь нет: отказ уже превращён в значение выше, а этот
      // вызов существует ровно затем, чтобы отличить «пусто» от «не прочли», —
      // и вызывающий немедленно строит по нему `Issue` с полным контекстом.
      return true
    }
  }

  function report(issue: Issue): void {
    sink(issue)
    // Подписчики после приёмника: приёмник — политика владельца пространства,
    // подписчики — наблюдатели, и порядок между ними обязан быть определён.
    for (const listener of listeners) listener(issue)
  }

  const core: SpaceCore = {
    // unsafe: `space` замыкается на объект, который создаётся строкой ниже.
    // Развязать иначе нельзя: пространству нужен core, а core — пространство, и
    // оба живут ровно столько же, сколько ленд.
    space: undefined as unknown as Space,
    land,
    id,
    salt,
    order,
    keyIndex,
    valueOf,
    broken,
    post: (head, lead, self, value, tag) => {
      try {
        land.write(head, lead, self, value, tag)
      } catch (error) {
        // ПРЕЖНИЙ ПОТОЛОК СНЯТ. До S5 сюда попадало любое значение длиннее
        // 62 байт — то есть длиннее 31 кириллической буквы, — и запись
        // отказывала: выносить его было некуда. Теперь оно уезжает в `ball`,
        // который лежит в том же слоте арены, и отказ остался ровно один —
        // потолок самого формата: `sizeBig` это два байта, больше 65 535 байт в
        // один юнит не положить ни при каком хранилище.
        //
        // Форма отказа прежняя и по той же причине: §4 обещает прикладному коду
        // либо значение, либо `Issue`, либо ошибку СВОЕГО слоя, а не `UnitError`
        // бинарного.
        if (error instanceof UnitError && error.at === 'field value') {
          throw new ModelError(
            `value does not fit into a unit: ${error.reason}. Such a value must be cut into parts — as a list or text`,
            'field write',
          )
        }
        throw error
      }
    },
    remove: node => land.remove(node),
    report,
  }

  const space: Space = {
    land: id,
    root<N extends ModelName>(model: AnyModel<N> | N): Doc<N> {
      return openDoc(core, resolve(model), ROOT_HEAD) as Doc<N>
    },
    doc<N extends ModelName>(model: AnyModel<N> | N, at: Link | Head): Doc<N> {
      return openDoc(core, resolve(model), headOf(land, at)) as Doc<N>
    },
    of(other: LandId): Space {
      if (open === undefined) {
        throw new ModelError(
          `no one can open the neighboring land «${other.str}»: pass createSpace({open}) — the land registry lives in the node, not in the space`,
          'Space.of',
        )
      }
      return open(other)
    },
    // Одна транзакция — один flush наружу. Метку времени внутри неё держит сам
    // ленд: `Stamp` монотонен по построению, и подменять его тут значило бы
    // завести второй источник правды о часах.
    edit: <R>(fn: () => R): R => batch(fn),
    onIssue(handle: (issue: Issue) => void): () => void {
      listeners.add(handle)
      return () => {
        listeners.delete(handle)
      }
    },
    [CORE]: core,
  }

  // unsafe: замыкание кольца `core ↔ space`, см. комментарий у поля `space`.
  ;(core as { space: Space }).space = space

  return space
}

/**
 * Модель по имени или по самой модели.
 *
 * Промах карты значит ровно одно — файл модели не загружен, и сообщение говорит
 * именно это. Соврать чужим именем тип уже не даст: `ModelName` его отвергнет.
 */
function resolve<N extends ModelName>(model: AnyModel<N> | N): AnyModel<N> {
  if (typeof model !== 'string') return model
  const found = modelOf(model)
  if (found === undefined) {
    throw new ModelError(
      `model «${model}» is not declared in this process: import the file with its model(...)`,
      'Space.doc',
    )
  }
  return found as AnyModel<N>
}

/** Адрес документа: номер узла или абсолютная ссылка на пешку. */
function headOf(land: Land, at: Link | Head): Head {
  if (typeof at === 'number') return at
  const bin = at.bin
  if (bin.length !== 22) {
    throw new ModelError(`link «${at.str}» is not a pawn: a pawn has 22 bytes, here ${bin.length}`, 'Space.doc')
  }
  return land.nodeOf(bin.subarray(16, 22))
}

/** Внутренняя ручка пространства. Точка входа следующего слоя. */
export function coreOf(space: Space): SpaceCore {
  const core = space[CORE]
  if (core === undefined) throw new ModelError('this is not an @sync/core space', 'coreOf')
  return core
}
