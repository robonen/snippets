// v8:hot — `order()`, `apply()` и индексные lookup'ы числятся горячими в
// PRINCIPLES.md. Правила действуют на весь файл: все поля объявлены в
// конструкторе, один сентинел на API, константы в модульной области, массивы
// плотные, строк на пути приёма и чтения нет ни одной.
//
// ─── Что это ─────────────────────────────────────────────────────────────────
//
// Ленд, у которого ИСТОЧНИК ИСТИНЫ — БАЙТЫ ([ADR-016](../../../../docs/00-decisions.md)).
// Юниты лежат в арене, индексы состоят из чисел, а объект на юнит не заводится,
// пока юнит не прочитают. Решение принято не по скорости (в приёме
// представления ровные), а по функциональности: обычный объект не выражает
// формат провода — конверсия теряет `tag`, `big`, `shot` и `kind`, а подпись в
// S6 считается по байтам.
//
// ─── Раскладка и соседи ──────────────────────────────────────────────────────
//
//   heads   head → peer → self → ref     ПЕРВИЧНОЕ хранилище (docs/04 §1)
//   cells   (Cell|null)[]                вид и сигнал — ТОЛЬКО на читанный узел
//   shapes  Map<head, RefNode>           сигнал состава детей головы
//   peers   hi32 → lo32 → слот           интернирование пиров, ни одной строки
//
//   `arena.ts` — байты юнитов, `ids.ts` — id ↔ плотный номер узла, `graph.ts` —
//   победители, связи `lead` и сама раскладка, `view.ts` — ленивый вид,
//   `clock.ts` — монотонная метка. Здесь остались приём, хранение, запись и
//   реактивность: всё, что меняется вместе.
//
// ПОЧЕМУ уровень пиров — первичное хранилище, а не дубликат индекса. Дубликат со
// строковым ключом стоил +47 Б/юнит, а тот же уровень с интернированным целым в
// роли основного хранилища — около нуля (167.2 Б с ним и без него, ADR-016).
// Он обязателен: `size()` считает юниты ПО ПИРАМ, и на это обопрутся `diff`/`summ`
// из S7, а чистка при отзыве прав без него становится обходом всех детей.
//
// ПОЧЕМУ рядом с ним в `graph.ts` ещё и плотный список детей. Обход
// трёхуровневого индекса ради `order` — это итератор на каждую карту второго
// уровня и по обращению на ребёнка; группировка же, ради которой всё затевалось,
// стоит 21.8 мкс на тысяче детей и работает по плотному массиву за одно чтение
// на ребёнка. Список производный: узел числится под головой СВОЕГО ПОБЕДИТЕЛЯ,
// поэтому дедупликация версий разных пиров не нужна вовсе.
//
// ПОЧЕМУ `order` подписывается на ОДИН сигнал головы, а не на ключи всех детей:
// её результат зависит от всех детей сразу, поэтому подписка на каждого и
// подписка на «что-то у детей изменилось» инвалидируют её в одних и тех же
// случаях — точность одинаковая, цена разная (10 000 узлов версий это больше
// мегабайта и 10 000 линковок на каждый пересчёт).

import { align8, readU16, readU32, writeU16, writeU32 } from '../binary/bytes'
import { Link } from '../binary/link'
import { shotInto } from '../binary/sha256'
import {
  type AnyUnit,
  SAND_AT,
  SAND_TAG_CODE,
  type SandTag,
  SandUnit,
  UNIT_AT,
  UNIT_BYTES,
  UnitError,
  parseUnit,
  shotKey,
  unitKeyAt,
  unitLengthAt,
  unitSpanAt,
} from '../binary/unit'
import { type Vary, varyEncode } from '../binary/vary'
import { RefNode } from '@sync/fiber'
import { Arena, CHUNK_MASK, NO_REF, refIn } from './arena'
import { type Clock, Stamp } from './clock'
import { Graph } from './graph'
import { Ids, NO_NODE, ROOT_ID } from './ids'
import { PACK_BYTES, PACK_STEP, PackCursor, type PackPart, packEncode, packHead, packPart } from '../binary/pack'
import {
  type LocalId,
  type Interner,
  ROOT,
  SandView,
  cmpAt,
  cmpBytesAt,
  deadAt,
  id48,
  isSand,
  putId48,
  sameBytesAt,
  sizeAt,
  tagAt,
  valueAt,
} from './view'

const KIND_SAND = 1
/** Потолок значения внутри юнита: 63 занято маркером выноса в `ball` (docs/03 §2). */
const INLINE_MAX = 62
/** `inlineSize == 63` — маркер выноса значения в `ball`. */
const INLINE_BIG = UNIT_BYTES.inlineBig
/** Потолок выносного значения: `sizeBig` — два байта. */
const BALL_MAX = UNIT_BYTES.ballMax
const ID_BYTES = 6
const PEER_BYTES = 8

/**
 * Как режется 48-битный локальный id при чеканке: 24 бита пира и 24 бита
 * счётчика.
 *
 * Пополам, а не 16/32, как в прототипах: при 16-битной метке два пира из ста
 * совпадают префиксом с вероятностью около 0.7 %, а счётчики у обоих начинаются
 * с единицы — то есть коллизия `self` наступала бы сразу. С 24 битами та же
 * вероятность 0.03 %, а 16.7 млн юнитов на пира в одном ленде — потолок, до
 * которого раньше упрётся всё остальное.
 */
const SERIAL_BITS = 0x100_0000

/** Пустая выдача: одна на модуль, чтобы чтение пустой головы не аллоцировало (правило 7). */
const NO_VIEWS: readonly SandView[] = Object.freeze([])
const NO_UNITS: readonly AnyUnit[] = Object.freeze([])

/**
 * Всё, что заводится на узел ПО ЧТЕНИЮ: ленивый вид и сигнал значения.
 *
 * Один объект, а не два массива: узел, которого никто не читал, стоит один
 * `null` в плотном массиве (замер прототипа: раздельные массивы стоили +8 Б на
 * узел и ничего не давали). `ref` нужен, чтобы отличить протухший вид — приехала
 * свежая версия узла, значит офсет другой.
 */
class Cell {
  ref: number
  view: SandView | null
  bell: RefNode<number> | null

  constructor() {
    this.ref = NO_REF
    this.view = null
    this.bell = null
  }
}

export interface LandOptions {
  /**
   * Сеанс чеканки `self` — 24-битное начало кольца счётчика (ADR-017).
   *
   * Ноль (по умолчанию) — детерминированный режим: счётчик идёт с единицы, при
   * гидрации отматывается вперёд по собственным юнитам. Годится для тестов и для
   * единственного экземпляра ленда на пира.
   *
   * Несколько ОДНОВРЕМЕННО живых экземпляров одного пира — две вкладки, окно и
   * воркер — обязаны получить РАЗНЫЕ сеансы (например `randomSession()` из
   * `wire/tabs`), иначе они чеканят одинаковые `self`, юниты складываются в один
   * слот, и правка одной вкладки молча проигрывает арбитраж. Энтропию даёт
   * обвязка, а не ленд — по той же причине, по которой часы инжектятся снаружи:
   * ядро обязано оставаться воспроизводимым.
   */
  readonly session?: number
}

/**
 * Ленд: плоский набор юнитов, индексы над ними и реактивность по узлу.
 *
 * @example
 * ```ts
 * const land = new Land(Link.peer(bytes), fixedClock(1000))
 * const first = land.post(ROOT, ROOT, 'привет')
 * const second = land.post(ROOT, first.self, 'мир')
 * land.order(ROOT).map(view => view.value)   // ['привет', 'мир']
 * land.read(first.self)                      // 'привет', с подпиской на ЭТОТ узел
 * ```
 */
export class Land implements Interner {
  readonly #clock: Clock
  /** Свой пир — восемь байт. `Link` внутри не нужен нигде: его текст стоит 147.9 нс. */
  readonly #peer: Uint8Array
  readonly #peerHigh: number
  readonly #peerLow: number
  /** Старшие 24 бита пира — метка в чеканном `self`. */
  readonly #mark: number

  readonly #arena: Arena
  readonly #ids: Ids
  readonly #stamp: Stamp
  /** Плотный граф узлов и раскладка. Про пиров, часы и сигналы он не знает. */
  readonly #graph: Graph

  readonly #cells: (Cell | null)[]
  readonly #heads: Map<number, Map<number, Map<number, number>>>
  readonly #shapes: Map<number, RefNode<number>>
  /** Интернирование пиров: hi32 → lo32 → слот. Ни одной строки. */
  readonly #peers: Map<number, Map<number, number>>
  #peerCount: number

  #units: number
  #live: number
  readonly #total: RefNode<number>
  readonly #alive: RefNode<number>

  /**
   * Спутники графа — seal/pass/gift (S6-подписи, docs/07). Ключ {@link unitKeyAt}
   * → ref в арене. Ни порядка, ни надгробий: их работа — доехать до получателя
   * вместе с сандами и там подтвердить авторство. Отдельная карта, а не индекс
   * санд, потому что у них нет ни `self`, ни `head`, ни `lead`.
   */
  readonly #extra: Map<string, number>

  /**
   * Ссылки на юниты, ещё не отданные хранилищу, — `null`, пока хранилища нет.
   *
   * Именно `null`, а не всегда живой `Set`: ленду без хранилища журнал стоил бы
   * 8 Б на юнит (при бюджете 200 и замере 181.6 это заметная доля) и рос бы
   * бесконечно, потому что дренировать его было бы некому. Включает журнал
   * {@link Land.track}.
   */
  #journal: Set<number> | null
  /** Слоты перекрытых версий: пары `ref, span`. Освобождаются в конце пачки. */
  readonly #trash: number[]
  /** Сколько юнитов ждёт сохранения — реактивно, будит хранилище. */
  readonly #waiting: RefNode<number>

  /** Головы, у которых сменился победитель. Поколение бьётся раз на пачку. */
  #dirty: number
  #dirtyMore: Set<number> | null

  /** Начало кольца счётчика этого сеанса (ADR-017). Ноль — детерминизм по умолчанию. */
  #session: number
  #serial: number
  /** Сколько чеканок сделано — сторож исчерпания, независимый от кольца. */
  #minted: number

  /** Краны исходящего: свежие СВОИ юниты уезжают пачкой на микрозадаче. */
  #taps: Set<{ readonly id: Link; readonly sink: (pack: Uint8Array) => void }> | null
  /** Слоты собственных записей с последней отправки. Только при живых кранах. */
  #fresh: number[]
  #tapQueued: boolean

  constructor(peer: Link, clock: Clock, options?: LandOptions) {
    const bin = peer.bin
    if (bin.length < PEER_BYTES) {
      throw new UnitError(`peer — ${PEER_BYTES} Б, а в ссылке «${peer.str}» ${bin.length}`, 'поле peer')
    }

    this.#clock = clock
    this.#peer = bin.slice(0, PEER_BYTES)
    this.#peerHigh = readU32(this.#peer, 0)
    this.#peerLow = readU32(this.#peer, 4)
    this.#mark = readU32(this.#peer, 0) >>> 8

    this.#arena = new Arena()
    this.#ids = new Ids()
    this.#stamp = new Stamp()
    this.#graph = new Graph(this.#arena)

    // Корень — узел №0. Ячейка ему заводится сразу, чтобы номера узлов и индексы
    // массива не разъезжались.
    this.#cells = [null]
    this.#heads = new Map()
    this.#shapes = new Map()
    this.#peers = new Map()
    this.#peerCount = 0

    this.#units = 0
    this.#live = 0
    this.#total = new RefNode(0)
    this.#alive = new RefNode(0)
    this.#extra = new Map()

    this.#journal = null
    this.#trash = []
    this.#waiting = new RefNode(0)

    this.#dirty = NO_NODE
    this.#dirtyMore = null

    this.#session = (options?.session ?? 0) & (SERIAL_BITS - 1)
    this.#serial = this.#session
    this.#minted = 0

    this.#taps = null
    this.#fresh = []
    this.#tapQueued = false
  }

  // ── Приём ──────────────────────────────────────────────────────────────────

  /**
   * Приём юнитов извне с разрешением LWW.
   *
   * Байты копируются в арену: юниты приходят окнами в чужой буфер, который может
   * пережить нас или не пережить. Пачку целиком дешевле принять {@link Land.adopt}.
   *
   * `gift`/`seal`/`pass` пропускаются и в счёт не идут — права и подписи это
   * работа S6/S7. Пропуск не проглатывание: в одном формате едут все четыре вида
   * (ADR-005), и отвергать пачку из-за вида, до которого стадия не дошла, значило
   * бы ломать доставку тому, кто ни при чём.
   *
   * @returns сколько юнитов реально изменили состояние. Ноль означает «доставка
   * ничего не дала» и служит условием остановки сходимости.
   */
  apply(units: Iterable<AnyUnit>, balls?: ReadonlyMap<string, Uint8Array>): number {
    let taken = 0
    for (const unit of units) {
      const bin = unit.bin
      // Не-санд (seal/pass/gift, S6-подписи) — плоский спутник графа: ни
      // порядка, ни надгробий, только хранение и ретрансляция. Их держит
      // отдельный набор, горячий путь санд не задет (docs/07).
      if (!isSand(bin, 0)) {
        taken += this.#keep(bin, 0, NO_REF)
        continue
      }
      if (((bin[UNIT_AT.meta] as number) & 0b111111) === INLINE_BIG) {
        taken += this.#big(unit as SandUnit, balls)
        continue
      }
      taken += this.#accept(bin, 0, NO_REF)
    }
    this.#settle()
    return taken
  }

  /**
   * Приём санда с выносным значением: юнит и `ball` кладутся в ОДИН слот арены,
   * в той же раскладке, что и в пачке.
   *
   * ПОЧЕМУ `balls` отдельным аргументом, а не полем юнита: окно `SandUnit`
   * кончается на 48-м байте (иначе не сойдётся проверка длины), а дописать виду
   * поле нельзя — юнит иммутабелен. Ровно поэтому `PackPart` тоже везёт баллы
   * отдельной картой.
   *
   * @throws {UnitError} если балл не приложен. Молчать нельзя: в формате нет
   * маркера «балл отделён» (docs/03 §2, «Открытый вопрос»), поэтому санд без
   * значения ленду негде представить — он занял бы слот, из которого читается
   * мусор. Развилка ждёт S7 вместе с тем, как узел запрашивает недостающие баллы.
   */
  #big(sand: SandUnit, balls: ReadonlyMap<string, Uint8Array> | undefined): number {
    const src = sand.bin
    const size = readU16(src, SAND_AT.size)
    const key = shotKey(src.subarray(SAND_AT.shot, SAND_AT.shot + UNIT_BYTES.shot))
    const ball = balls?.get(key)

    if (ball === undefined) {
      throw new UnitError(
        `санд несёт выносное значение ${key} (${size} Б), а ball не приложен — ленду негде хранить санд без значения`,
        'поле value',
      )
    }
    if (ball.length !== size) {
      throw new UnitError(`ball ${key}: юнит объявил ${size} Б, приложено ${ball.length}`, 'поле value')
    }

    const span = SAND_AT.payload + align8(size)
    const ref = this.#arena.alloc(span)
    const bin = this.#arena.bin(ref)
    const at = ref & CHUNK_MASK
    bin.set(src, at)
    bin.set(ball, at + SAND_AT.payload)

    const taken = this.#accept(bin, at, ref)
    // Юнит проиграл LWW — слот не нужен никому и возвращается в оборот сразу:
    // ссылок на него нет ни у индекса, ни у графа.
    if (taken === 0) this.#arena.free(ref, span)
    return taken
  }

  /**
   * Принять буфер пачки главой арены — без копии.
   *
   * Ровно то, ради чего источником истины сделаны байты: `packDecode` уже
   * разложил юниты внутри одного буфера, и ленду остаётся запомнить офсеты
   * (2.87 мс на 10 000 юнитов против 3.9–4.7 у копирующих путей, ADR-016).
   * Плата — буфер удерживается целиком, включая проигравшие по LWW юниты.
   *
   * @throws {PackError} на битой пачке — разбор идёт до первого изменения
   * состояния, поэтому ленд остаётся нетронутым.
   */
  adopt(bin: Uint8Array): number {
    // ДВА ПРОХОДА КУРСОРОМ, и первый не лишний: контракт обещает, что битая
    // пачка оставляет ленд нетронутым, а ленивый разбор идёт вперемешку с
    // приёмом. Раньше эту роль исполнял `packDecode`, но он платил `SandUnit` на
    // каждый юнит (192 Б сверх байтов, долг S2) — ровно те виды, которые ленд
    // тут же выбрасывал, забрав офсет. Проверочный проход стоит второго обхода
    // байтов и ни одной аллокации.
    const check = new PackCursor(bin)
    while (check.next() !== PACK_STEP.end) {
      // Тело пустое намеренно: вся проверка раскладки живёт в `next()`.
    }

    const base = this.#arena.adopt(bin)

    let taken = 0
    const cursor = new PackCursor(bin)
    for (let step = cursor.next(); step !== PACK_STEP.end; step = cursor.next()) {
      if (step !== PACK_STEP.unit) continue
      const at = cursor.at
      // Не-санд юниты (seal/pass/gift) едут спутником — принимаем в плоский
      // набор без графа (docs/07).
      taken += cursor.kind === KIND_SAND
        ? this.#accept(bin, at, refIn(base, at))
        : this.#keep(bin, at, refIn(base, at))
    }

    // Ни одного юнита не взято — значит в буфер не смотрит ни одна ссылка, и
    // держать его незачем. Повторная доставка известной пачки — не редкость, а
    // штатный исход досылки, и без возврата глав она стоила +56 КБ на каждую
    // (замер: 200 доставок → arrayBuffers 0.7 → 11.6 МБ при неизменном `size()`).
    if (taken === 0) this.#arena.release(base, bin.byteLength)

    this.#settle()
    return taken
  }

  // ── Чтение ─────────────────────────────────────────────────────────────────

  /**
   * Дети узла в вычисленном порядке, живые (без надгробий).
   *
   * Подписывает текущий файбер на СОСТАВ ДЕТЕЙ этой головы: правка узла под
   * другой головой читателя не будит.
   */
  order(head: LocalId): readonly SandView[] {
    this.#shape(head).get()
    return this.#views(this.#graph.layout(head))
  }

  /**
   * То же, но номерами узлов — без материализации видов.
   *
   * Слою моделей от порядка часто нужны идентификаторы, а не значения: он читает
   * поля своими каналами по номеру, и вид ему по дороге не нужен.
   */
  nodes(head: LocalId): readonly LocalId[] {
    this.#shape(head).get()
    return this.#graph.layout(head) as readonly LocalId[]
  }

  /**
   * Реактивное чтение значения узла. Подписывает текущий файбер на ЭТОТ узел, а
   * не на карту целиком: правка соседа читателя не будит.
   *
   * `null` — и надгробие, и «юнита ещё нет»: хранимого `null` в модели не
   * существует (docs/05 §6), поэтому сентинел один (правило 3 горячего пути).
   */
  read(node: LocalId): Vary {
    const cell = this.#cell(node)

    let bell = cell.bell
    if (bell === null) {
      // Заводится первым чтением: узел, которого никто не читает, сигнала не
      // имеет, и приём его правки никого не будит.
      bell = new RefNode(0)
      cell.bell = bell
    }
    bell.get()

    const ref = this.#graph.ref(node)
    if (ref === NO_REF) return null
    if (cell.ref !== ref) this.#refresh(cell, node, ref)
    return (cell.view as SandView).value
  }

  /** Юнитов всего, включая проигравших по LWW: считает `diff`/`summ` из S7. */
  size(): number {
    return this.#total.get()
  }

  /** Живых узлов: у скольких победитель не надгробие. */
  count(): number {
    return this.#alive.get()
  }

  /**
   * Всё, что уезжает собеседнику, — включая проигравшие по LWW версии.
   *
   * Виды здесь одноразовые и в кэш не кладутся: пачка уходит в сокет, читать её
   * поля никто не будет.
   */
  units(): readonly AnyUnit[] {
    if (this.#units === 0) return NO_UNITS

    const out: AnyUnit[] = []
    for (const peers of this.#heads.values()) {
      for (const kids of peers.values()) {
        for (const ref of kids.values()) out.push(this.#unitAt(ref))
      }
    }
    for (const ref of this.#extra.values()) {
      const bin = this.#arena.bin(ref)
      const at = ref & CHUNK_MASK
      out.push(parseUnit(bin.subarray(at, at + unitLengthAt(bin, at))))
    }
    return out
  }

  /**
   * Пачка ленда целиком: юниты и приложенные к ним ВЫНОСНЫЕ ЗНАЧЕНИЯ.
   *
   * То, чего не умел {@link Land.units}: у санда с `ball` байты значения лежат
   * рядом с юнитом, но `SandUnit` о них не знает — его окно кончается на 48-м
   * байте, потому что иначе не сойдётся проверка длины. Поэтому пачку собирает
   * отдельный метод, и он же закрывает дыру «ленд с большим сандом не
   * пересобирает свою пачку», записанную в docs/11.
   */
  part(): PackPart {
    if (this.#units === 0) return packPart()

    const units: AnyUnit[] = []
    const balls = new Map<string, Uint8Array>()

    for (const peers of this.#heads.values()) {
      for (const kids of peers.values()) {
        for (const ref of kids.values()) {
          const bin = this.#arena.bin(ref)
          const at = ref & CHUNK_MASK
          const size = unitLengthAt(bin, at)
          units.push(SandUnit.wrap(bin.subarray(at, at + size)))

          if (((bin[at + UNIT_AT.meta] as number) & 0b111111) === INLINE_BIG) {
            const from = at + SAND_AT.payload
            balls.set(shotKey(bin.subarray(at + SAND_AT.shot, at + SAND_AT.shot + UNIT_BYTES.shot)),
              bin.subarray(from, from + sizeAt(bin, at)))
          }
        }
      }
    }

    // Спутники (seal/pass/gift) — после сандов: получатель собирает их в карты
    // до проверки, порядок в секции значения не имеет.
    for (const ref of this.#extra.values()) {
      const bin = this.#arena.bin(ref)
      const at = ref & CHUNK_MASK
      units.push(parseUnit(bin.subarray(at, at + unitLengthAt(bin, at))))
    }

    return packPart({ units, balls })
  }

  // ── Хранилище ──────────────────────────────────────────────────────────────

  /**
   * Начать вести журнал несохранённых юнитов (docs/06 §6).
   *
   * Зовёт хранилище при подключении. Без этого вызова журнал не ведётся вовсе —
   * ленду без хранилища он стоил бы память на юнит и рос бы бесконечно, потому
   * что забирать из него было бы некому.
   *
   * Идемпотентен: повторный вызов журнал не сбрасывает.
   */
  track(): void {
    if (this.#journal === null) this.#journal = new Set()
  }

  /**
   * Сколько юнитов ждёт сохранения. Читается РЕАКТИВНО: хранилище подписывается
   * на это число и просыпается микрозадачей, а не по юниту (docs/06 §6).
   */
  unsaved(): number {
    return this.#waiting.get()
  }

  /**
   * Забрать несохранённое пачкой и очистить журнал.
   *
   * Байты копируются одним `set` на юнит прямо из арены — вместе с выносным
   * значением, потому что слот арены и есть раскладка пачки. Ни одного
   * `SandUnit` при этом не создаётся: путь сохранения на них не смотрит.
   */
  flush(id: Link): Uint8Array {
    const journal = this.#journal
    if (journal === null || journal.size === 0) return packEncode([[id, packPart()]])

    const out = this.#packOf(journal, id)
    journal.clear()
    this.#waiting.set(0)
    return out
  }

  /**
   * Кран исходящего: пачки СОБСТВЕННЫХ записей, по одной на микрозадачу.
   *
   * Это второй потребитель рядом с журналом хранилища, и он нарочно отдельный.
   * Журнал (`flush`) собирает ВСЁ принятое — своё и чужое, — потому что писатель
   * обязан сохранить и то, что услышал; кран отдаёт только СВОЁ, потому что на
   * общем канале вкладок каждый уже слышал оригинал, и пересылка чужого была бы
   * эхом: пачка A вернулась бы ей же от каждой вкладки-соседа.
   *
   * Пачка включает выносные значения: слот арены хранит юнит вместе с его
   * `ball`, и копия одним `set` уносит оба (та же раскладка, что у `flush`).
   */
  tap(id: Link, sink: (pack: Uint8Array) => void): () => void {
    if (this.#taps === null) this.#taps = new Set()
    const entry = { id, sink }
    this.#taps.add(entry)
    return () => {
      this.#taps?.delete(entry)
    }
  }

  /** Собрать пачку из слотов арены: заголовок ленда плюс юниты как лежат. */
  #packOf(refs: Iterable<number>, id: Link): Uint8Array {
    let size = PACK_BYTES.head
    for (const ref of refs) size += unitSpanAt(this.#arena.bin(ref), ref & CHUNK_MASK)

    const out = new Uint8Array(size)
    packHead(out, 0, id)

    let at = PACK_BYTES.head
    for (const ref of refs) {
      const bin = this.#arena.bin(ref)
      const from = ref & CHUNK_MASK
      const span = unitSpanAt(bin, from)
      out.set(bin.subarray(from, from + span), at)
      at += span
    }
    return out
  }

  /** Отдать кранам накопленное. Зовётся микрозадачей после собственной записи. */
  #drip(): void {
    this.#tapQueued = false
    const taps = this.#taps
    const fresh = this.#fresh
    if (fresh.length === 0) return
    if (taps === null || taps.size === 0) {
      fresh.length = 0
      return
    }

    for (const tap of taps) tap.sink(this.#packOf(fresh, tap.id))
    fresh.length = 0
  }

  /** Вид победителя БЕЗ подписки — для обходов, дампов и тестов. */
  peek(node: LocalId): SandView | null {
    const ref = this.#graph.ref(node)
    if (ref === NO_REF) return null
    return this.#viewOf(node, ref)
  }

  // ── Запись ─────────────────────────────────────────────────────────────────

  /** Локальная запись: новый юнит за указанным соседом. */
  post(head: LocalId, lead: LocalId, value: Vary, tag?: SandTag): SandView {
    return this.write(head, lead, this.#mint(), value, tag)
  }

  /**
   * Запись с ЯВНЫМ `self` — единственная точка записи.
   *
   * Явный `self` нужен трижды: перезапись значения сохраняет поддерево,
   * контентные адреса из S4 считаются заранее, а `remove`/`move` постят тот же
   * узел заново.
   *
   * Байты собираются прямо в арене: `SandUnit.make` потребовал бы четырёх
   * `Link`, а каждая стоит 147.9 нс — до 40 % локальной записи. Формат при этом
   * общий: офсеты и таблица `tag` берутся из `binary/unit.ts`, а сторожевой тест
   * сверяет собранные здесь байты с `SandUnit.make` побайтово.
   *
   * ЗНАЧЕНИЕ ЛЮБОЙ ДЛИНЫ. До S5 запись отказывала на 63 байтах — на 32
   * кириллических буквах, то есть на обычном заголовке. Теперь длинное значение
   * уезжает в `ball`, который лежит в ТОМ ЖЕ слоте арены сразу за юнитом, как
   * лежал бы в пачке (docs/03 §3). Отсюда три следствия, каждое из которых
   * закрывает свою дыру: `SandView.value` читает его без всякого хранилища;
   * `Land.part()` пересобирает свою пачку копией байт; `adopt` получает баллы
   * даром, потому что в принятом буфере они уже лежат там, где надо.
   */
  write(head: LocalId, lead: LocalId, self: LocalId, value: Vary, tag?: SandTag): SandView {
    // Корень — сентинел, а не узел, и `ROOT` наружу торчит обычным `LocalId`,
    // поэтому такой вызов компилируется. Приём его отвергает молча (там это
    // чужой юнит и портить пачку из-за него нельзя), а здесь молчать нечестно:
    // локальная запись вернула бы вид на юнит, которого в ленде нет.
    if (self === ROOT || self === head) {
      throw new UnitError(`self = ${self}: юнит не может быть ни корнем, ни собственным родителем`, 'поле self')
    }

    const payload = varyEncode(value)
    const big = payload.length > INLINE_MAX
    if (payload.length > BALL_MAX) {
      throw new UnitError(
        `значение занимает ${payload.length} Б, а потолок выносного — ${BALL_MAX} (два байта sizeBig)`,
        'поле value',
      )
    }

    this.#stamp.next(this.#clock.now())

    // Слот один и на юнит, и на его значение: у большого санда длина ровно 48, то
    // есть значение начинается там же, где начиналась бы inline-нагрузка.
    const span = big ? SAND_AT.payload + align8(payload.length) : align8(SAND_AT.payload + payload.length)
    const ref = this.#arena.alloc(span)
    const bin = this.#arena.bin(ref)
    const at = ref & CHUNK_MASK

    bin[at + UNIT_AT.kind] = KIND_SAND
    bin[at + UNIT_AT.meta] = (SAND_TAG_CODE[tag ?? 'term'] << 6) | (big ? INLINE_BIG : payload.length)
    writeU32(bin, at + UNIT_AT.time, this.#stamp.time)
    writeU16(bin, at + UNIT_AT.tick, this.#stamp.tick)
    bin.set(this.#peer, at + UNIT_AT.peer)
    putId48(bin, at + SAND_AT.self, this.#ids.key(self))
    putId48(bin, at + SAND_AT.head, this.#ids.key(head))
    putId48(bin, at + SAND_AT.lead, this.#ids.key(lead))
    if (big) {
      writeU16(bin, at + SAND_AT.size, payload.length)
      // Хэш считается СИНХРОННО (`binary/sha256.ts`), потому что запись
      // синхронна, а `crypto.subtle.digest` — нет. Разбор развилки там же.
      shotInto(bin, at + SAND_AT.shot, payload, 0, payload.length)
    }
    bin.set(payload, at + SAND_AT.payload)

    const taken = this.#accept(bin, at, ref)
    // Кран получает только СВОИ записи, и метка ставится здесь — в единственной
    // точке собственной записи. Приём (`apply`/`adopt`) сюда не попадает, поэтому
    // услышанное по каналу не уезжает обратно в канал.
    if (taken !== 0 && this.#taps !== null && this.#taps.size > 0) {
      this.#fresh.push(ref)
      if (!this.#tapQueued) {
        this.#tapQueued = true
        queueMicrotask(() => this.#drip())
      }
    }
    this.#settle()

    // Вид СВЕЖИЙ, а не из ячейки: запись — не чтение. Класть его в ячейку
    // значило бы, что ленд из 10 000 локальных записей держит 10 000 видов и
    // ячеек, которых никто не просил. Замер: сборка 10 000 узлов 4.09 → 3.47 мс,
    // худший прогон 11.06 → 5.55 (мусор перестал доживать до старшего
    // поколения), а память локально собранного ленда сравнялась с принятым по
    // проводу — 184.2 против 181.6 Б на юнит, и `views()` у него ноль.
    return new SandView(this, bin, at, self)
  }

  /**
   * Надгробие поверх живого элемента. `false` — узла нет или он уже мёртв.
   *
   * `lead` сохраняется прежним: у удаляемого узла могут быть дети, и переезд
   * надгробия утащил бы за собой всё поддерево.
   */
  remove(self: LocalId): boolean {
    const ref = this.#graph.ref(self)
    if (ref === NO_REF) return false

    const bin = this.#arena.bin(ref)
    const at = ref & CHUNK_MASK
    if (deadAt(bin, at)) return false

    // `tag` переносится с прежней версии: надгробие держит своё поддерево
    // (`lead` детей продолжает указывать на него), а `tag` — это и есть то, как
    // поддерево читается, `vals` против `keys`. Потеряв его, ленд отдал бы S4
    // список, объявленный атомом.
    this.write(
      this.nodeAt(id48(bin, at + SAND_AT.head)),
      this.#graph.lead(self) as LocalId,
      self,
      null,
      tagAt(bin, at),
    )
    return true
  }

  /**
   * Перемещение узла за соседа `lead` ({@link ROOT} — в начало).
   *
   * Переносится не значение, а связь. Последователь переподвешивается
   * БЕЗУСЛОВНО — так же, как `next` в `sand_move` из baza: `lead`-детей у
   * переезжающего узла бывает несколько, и следующий в порядке чтения не
   * обязательно тот, чей `lead` на него указывает. Пропущенный репойнт замыкает
   * цепочку в кольцо, и живые элементы молча исчезают из чтения.
   */
  move(self: LocalId, lead: LocalId): boolean {
    // Встать за самим собой — мгновенное кольцо из одного узла.
    if (lead === self) return false

    const ref = this.#graph.ref(self)
    if (ref === NO_REF) return false

    const bin = this.#arena.bin(ref)
    const at = ref & CHUNK_MASK
    const back = this.#graph.lead(self) as LocalId
    if (back === lead) return false

    const head = this.nodeAt(id48(bin, at + SAND_AT.head))
    // Раскладка НОМЕРАМИ и без подписки. Без подписки — потому что `move` это
    // запись, и подписывать пишущего на то, что он сам меняет, значит будить его
    // собственной правкой. Номерами — потому что запись не имеет права заводить
    // ленивые виды: до этой правки один `move` на голове из 10 000 детей поднимал
    // `views()` с 0 до 10 000, то есть платил те самые +194 Б/юнит, ради отказа
    // от которых источником истины и сделаны байты (ADR-016). `move` нужны ровно
    // две вещи — позиция узла и его последователь, и обе есть в номерах.
    const items = this.#graph.layout(head)

    let index = -1
    for (let i = 0; i < items.length; i++) {
      if (items[i] === self) {
        index = i
        break
      }
    }
    if (index < 0) return false

    // `tag` обоих переписываемых узлов переносится с их прежних версий. Ровно
    // эту потерю ADR-016 вменил обычным объектам («конверсия теряет tag»), и
    // байтовый ленд обязан не завести её у себя: `move` списка, чей элемент —
    // словарь, иначе объявлял бы словарь атомом. Дифференциальная сверка с
    // `Replica` этого не увидит никогда: у `Sand` поля `tag` нет вовсе.
    const value = valueAt(bin, at)
    const tag = tagAt(bin, at)

    const follower = items[index + 1]
    if (follower !== undefined) {
      const next = this.#graph.ref(follower)
      const nextBin = this.#arena.bin(next)
      const nextAt = next & CHUNK_MASK
      this.write(head, back, follower as LocalId, valueAt(nextBin, nextAt), tagAt(nextBin, nextAt))
    }

    // `bin`/`at` по-прежнему указывают на прежнего победителя `self`: главы арены
    // не переезжают, а уже занятые байты не переписываются.
    this.write(head, lead, self, value, tag)
    return true
  }

  // ── Граница с идентификаторами формата ─────────────────────────────────────

  /**
   * Плотный номер узла по 48-битному локальному id, заводя узел при первой
   * встрече. Заводя, а не находя: подписаться надо и на ЕЩЁ НЕ ПРИЕХАВШИЙ узел,
   * иначе его появление читателя не разбудит.
   */
  nodeAt(id: number): LocalId {
    if (id === ROOT_ID) return ROOT
    const known = this.#ids.get(id)
    if (known !== NO_NODE) return known as LocalId

    const node = this.#ids.put(id)
    this.#graph.born(node)
    this.#cells.push(null)
    return node as LocalId
  }

  /** Граница: локальный id (6 байт) → номер узла. Холодный путь. */
  nodeOf(id: Uint8Array): LocalId {
    return this.nodeAt(id48(id, 0))
  }

  /** Граница: номер узла → локальный id (6 байт, копия). Холодный путь. */
  idOf(node: LocalId): Uint8Array {
    const out = new Uint8Array(ID_BYTES)
    putId48(out, 0, this.#ids.key(node))
    return out
  }

  /** Сколько байт выделено под арену. Для замера памяти и devtools. */
  bytes(): number {
    return this.#arena.bytes()
  }

  /**
   * Сколько байт ЧУЖИХ пачек удерживает ленд, приняв их {@link Land.adopt} без
   * копии. Отдельным числом от {@link Land.bytes}: это цена отказа от копии, и
   * складывать её с ценой хранения значило бы прятать одну за другой.
   */
  /** Свой пир — ссылкой. Идентичность ленда, нужна рукопожатию канала. */
  peer(): Link {
    return Link.peer(this.#peer)
  }

  held(): number {
    return this.#arena.held()
  }

  /** Сколько узлов обзавелось ленивым видом. Для тестов ленивости и devtools. */
  views(): number {
    let live = 0
    for (const cell of this.#cells) {
      if (cell !== null && cell.view !== null) live += 1
    }
    return live
  }

  // ── Приём одного юнита ─────────────────────────────────────────────────────

  /**
   * `ready !== NO_REF` — байты уже лежат в арене по этому офсету (пути `adopt` и
   * `write`), иначе копируются. Возвращает 1, если состояние изменилось.
   */
  #accept(src: Uint8Array, at: number, ready: number): number {
    const mine = this.#mine(src, at)
    this.#stamp.hear(readU32(src, at + UNIT_AT.time), readU16(src, at + UNIT_AT.tick), mine)

    const id = id48(src, at + SAND_AT.self)
    const over = id48(src, at + SAND_AT.head)
    // Корень — сентинел, а не узел. Юнит, объявивший себя корнем (шесть нулевых
    // байт в `self`), в формате представим и по проводу доедет, а в ленде делает
    // корень СВОИМ ЖЕ ребёнком: `order(ROOT)` начинает содержать `ROOT`, и
    // рекурсивный обход слоя моделей уходит в бесконечность. То же у юнита,
    // объявившего родителем самого себя. Сходимость этого не ловит — реплики
    // зацикливаются согласованно, и падает уже потребитель.
    if (id === ROOT_ID || id === over) return 0

    const self = this.nodeAt(id)
    const head = this.nodeAt(over)

    // Перезапуск процесса: счётчик живёт только в памяти, а `self` обязан
    // остаться уникальным. Поэтому при гидрации генератор отматывается вперёд по
    // собственным юнитам — иначе новая запись столкнётся со старой ключ в ключ.
    //
    // ТОЛЬКО в детерминированном режиме (сеанс 0). При сеансовой чеканке
    // (ADR-017) отмотка вредна: обе вкладки отмотались бы к ОДНОМУ максимуму и
    // дальше чеканили бы синхронно — ровно та коллизия, ради которой сеанс и
    // заведён. Уникальность там держит пропуск занятых в `#mint`.
    if (mine && this.#session === 0) {
      const serial = id - this.#mark * SERIAL_BITS
      if (serial > this.#serial && serial < SERIAL_BITS) this.#serial = serial
    }

    let peers = this.#heads.get(head)
    if (peers === undefined) {
      peers = new Map()
      this.#heads.set(head, peers)
    }
    const slot = this.#peerSlot(src, at)
    let kids = peers.get(slot)
    if (kids === undefined) {
      kids = new Map()
      peers.set(slot, kids)
    }

    const prev = kids.get(self)
    if (prev !== undefined) {
      const order = cmpAt(src, at, this.#arena.bin(prev), prev & CHUNK_MASK)
      if (order > 0) return 0
      if (order === 0) {
        // Ничья по `(time, peer, tick)` в ОДНОМ слоте `(head, peer, self)`.
        //
        // Обычно это повторная доставка того же юнита — тогда «не перекрывает»
        // верно, и считать её изменением нельзя, иначе сходимость никогда не
        // встанет. Но байты при совпавшей метке бывают и РАЗНЫМИ: один пир
        // записал в ту же секунду и тот же тик два разных значения. Это не
        // выдумка — ровно так ведут себя две вкладки одного пира (ADR-006
        // против ADR-007, см. `известные дефекты` в тестах), и так же выглядит
        // недобросовестный пир.
        //
        // Оставить прежнего значило бы решать по ПОРЯДКУ ПРИХОДА: две реплики с
        // одним набором юнитов сошлись бы к разным значениям, а цикл «применять,
        // пока `apply` не вернёт 0» встал бы, ничего не заподозрив. Поэтому
        // добираем порядок байтами — тем же каноном, что и `peer` в ADR-015:
        // меньший побайтово выигрывает. Правило произвольно ровно настолько,
        // насколько произвольно `peer ↑`; важно, что оно ОДНО у всех реплик.
        //
        // Ветка холодная: сюда попадают только юниты с совпавшими меткой, пиром
        // и тиком, поэтому сравнение идёт по всей длине, без бережливости.
        if (sameBytesAt(src, at, this.#arena.bin(prev), prev & CHUNK_MASK)) return 0
        if (cmpBytesAt(src, at, this.#arena.bin(prev), prev & CHUNK_MASK) > 0) return 0
      }
    }

    const ref = ready !== NO_REF ? ready : this.#arena.store(src, at, unitSpanAt(src, at))
    kids.set(self, ref)
    this.#journal?.add(ref)

    if (prev === undefined) this.#units += 1
    else {
      // Перекрытая своим же пиром версия больше не нужна НИКОМУ: в индексе её
      // заменили, победителем она быть перестала. Её слот уходит в мусор и
      // освобождается разом в конце пачки — до тех пор байты целы, и вид,
      // выданный до перезаписи, дочитывает прежнее значение.
      //
      // Длина считается СЕЙЧАС, а не при освобождении: к тому моменту слот уже
      // может быть отдан под новый юнит, и `unitSpanAt` прочтёт чужую раскладку.
      this.#trash.push(prev, unitSpanAt(this.#arena.bin(prev), prev & CHUNK_MASK))
      this.#journal?.delete(prev)
      // И из крана: слот перекрытой версии освободится в конце пачки, и к
      // микрозадаче отправки в нём могут лежать чужие байты. Перекрывшая версия
      // уже добавлена или добавится своей записью — терять нечего.
      if (this.#fresh.length > 0) {
        const stale = this.#fresh.indexOf(prev)
        if (stale >= 0) this.#fresh.splice(stale, 1)
      }
    }

    // Победитель узла. Полный перебор пиров не нужен: новый юнит уже перекрыл
    // версию СВОЕГО пира, значит хуже прежнего победителя ленд стать не может.
    const cur = this.#graph.ref(self)
    if (cur === NO_REF || cur === prev) this.#crown(self, head, ref, cur)
    else if (cmpAt(src, at, this.#arena.bin(cur), cur & CHUNK_MASK) < 0) this.#crown(self, head, ref, cur)

    return 1
  }

  /**
   * Принять спутник — seal/pass/gift. Без графа: LWW по заголовку
   * `(time, peer, tick)`, ключ — {@link unitKeyAt}. Идемпотентно (повторная
   * печать не меняет состояния), поэтому годится условием остановки сходимости.
   *
   * @returns 1, если набор изменился.
   */
  #keep(src: Uint8Array, at: number, ready: number): number {
    this.#stamp.hear(readU32(src, at + UNIT_AT.time), readU16(src, at + UNIT_AT.tick), this.#mine(src, at))

    const key = unitKeyAt(src, at)
    const prev = this.#extra.get(key)
    if (prev !== undefined) {
      // Свежее побеждает; ничья (та же печать) или старее — не трогаем.
      if (cmpAt(src, at, this.#arena.bin(prev), prev & CHUNK_MASK) >= 0) return 0
      this.#trash.push(prev, unitSpanAt(this.#arena.bin(prev), prev & CHUNK_MASK))
      this.#journal?.delete(prev)
    }

    const ref = ready !== NO_REF ? ready : this.#arena.store(src, at, unitSpanAt(src, at))
    this.#extra.set(key, ref)
    this.#journal?.add(ref)
    if (prev === undefined) this.#units += 1
    return 1
  }

  /** Смена победителя узла: счётчики, список детей, сигналы. */
  #crown(self: number, head: number, ref: number, cur: number): void {
    const bin = this.#arena.bin(ref)
    const at = ref & CHUNK_MASK

    const now = deadAt(bin, at) ? 0 : 1
    let was = 0
    if (cur !== NO_REF) was = deadAt(this.#arena.bin(cur), cur & CHUNK_MASK) ? 0 : 1
    this.#live += now - was

    const moved = this.#graph.crown(self, head, ref, this.nodeAt(id48(bin, at + SAND_AT.lead)))
    // Узел переехал к другому родителю: у прежней головы состав детей тоже
    // изменился, и её читателей будить обязан ленд — граф про сигналы не знает.
    if (moved !== NO_NODE) this.#dirt(moved)

    // Сигнал значения — только тому узлу, который правда изменился. Равное
    // значение сигналит ТОЖЕ: гасить равенство — работа файбера, у него
    // структурное сравнение, и решать это в двух местах значит развести их.
    const cell = this.#cells[self]
    if (cell !== null && cell !== undefined) {
      const bell = cell.bell
      if (bell !== null) bell.set(bell.value + 1)
    }

    this.#dirt(head)
  }

  /** Пир → маленькое целое. Две карты чисел вместо строкового ключа, ни одной строки. */
  #peerSlot(bin: Uint8Array, at: number): number {
    // `| 0` вместо `>>> 0`: беззнаковое слово выше 2³¹ перестаёт быть SMI, и
    // карта начинает боксировать ключ. Знаковая форма биективна, порядок пиров
    // на ней не строится — она только ключ.
    const high = readU32(bin, at + UNIT_AT.peer) | 0
    const low = readU32(bin, at + UNIT_AT.peer + 4) | 0

    let lows = this.#peers.get(high)
    if (lows === undefined) {
      lows = new Map()
      this.#peers.set(high, lows)
    }
    const known = lows.get(low)
    if (known !== undefined) return known

    const slot = this.#peerCount
    this.#peerCount = slot + 1
    lows.set(low, slot)
    return slot
  }

  /** Наш ли пир — сравнением байт, без построения текста ссылки. */
  #mine(bin: Uint8Array, at: number): boolean {
    return readU32(bin, at + UNIT_AT.peer) === this.#peerHigh
      && readU32(bin, at + UNIT_AT.peer + 4) === this.#peerLow
  }

  /** Свежий локальный id: метка пира и счётчик. */
  #mint(): LocalId {
    // Кольцо со случайным началом и пропуском занятых (ADR-017). Начало задаёт
    // сеанс: две вкладки одного пира держат ОДИН пир (ADR-007), и без сеансового
    // разведения обе чеканили бы одинаковый `self` — юниты складывались бы в
    // один слот, и правка одной вкладки молча пропадала. Пропуск занятых —
    // страховка на пересечение территорий: он превращает столкновение в
    // чересполосицу id, а не в потерю.
    let guard = 0
    let id = 0
    do {
      if (++guard > SERIAL_BITS) {
        throw new UnitError(`счётчик id исчерпан: ${SERIAL_BITS} узлов на пира в одном ленде`, 'поле self')
      }
      this.#serial = (this.#serial + 1) & (SERIAL_BITS - 1)
      id = this.#mark * SERIAL_BITS + this.#serial
      // `id === 0` — сентинел корня: достижим у пира с нулевым старшим словом.
    } while (id === 0 || this.#ids.get(id) !== NO_NODE)

    this.#minted += 1
    if (this.#minted >= SERIAL_BITS) {
      throw new UnitError(`счётчик id исчерпан: ${SERIAL_BITS} узлов на пира в одном ленде`, 'поле self')
    }
    return this.nodeAt(id)
  }

  // ── Реактивность ───────────────────────────────────────────────────────────

  #shape(head: number): RefNode<number> {
    let node = this.#shapes.get(head)
    if (node === undefined) {
      node = new RefNode(0)
      this.#shapes.set(head, node)
    }
    return node
  }

  /**
   * Пометить голову изменившейся. Поколение бьётся раз на пачку, а не на юнит:
   * пачка — одна транзакция, и будить читателя `order` тысячу раз на приём
   * тысячи юнитов незачем (замер прототипа: приём 10 000 юнитов 3.36 → 2.86 мс).
   * Гранулярность по узлу при этом остаётся поюнитной — её держат сигналы ячеек.
   */
  #dirt(head: number): void {
    const first = this.#dirty
    if (first === NO_NODE) {
      this.#dirty = head
      return
    }
    if (first === head) return

    let more = this.#dirtyMore
    if (more === null) {
      more = new Set()
      this.#dirtyMore = more
    }
    more.add(head)
  }

  /** Разбудить читателей `order`, `size` и `count` — по разу на пачку. */
  #settle(): void {
    // Перекрытые слоты возвращаются в оборот в конце пачки, а не в середине:
    // приём пачки — одна транзакция, и переиспользовать слот, из которого в этой
    // же пачке ещё читает арбитраж LWW, нельзя.
    const trash = this.#trash
    if (trash.length > 0) {
      for (let i = 0; i < trash.length; i += 2) {
        this.#arena.free(trash[i] as number, trash[i + 1] as number)
      }
      trash.length = 0
    }

    const journal = this.#journal
    if (journal !== null) this.#waiting.set(journal.size)

    const first = this.#dirty
    if (first !== NO_NODE) {
      this.#dirty = NO_NODE
      this.#stir(first)

      const more = this.#dirtyMore
      if (more !== null && more.size > 0) {
        for (const head of more) this.#stir(head)
        more.clear()
      }
    }

    // Числа кладутся как есть: равную запись гасит сам файбер (`Object.is` в
    // `RefNode.set`), и ленду не приходится решать равенство вторым местом.
    this.#total.set(this.#units)
    this.#alive.set(this.#live)
  }

  #stir(head: number): void {
    const node = this.#shapes.get(head)
    // Сигнала нет — значит порядок этой головы никто не читал, и будить некого.
    if (node !== undefined) node.set(node.value + 1)
  }

  // ── Виды ───────────────────────────────────────────────────────────────────

  /** Номера узлов в виды. Отдельным проходом: раскладка о видах ничего не знает. */
  #views(nodes: readonly number[]): readonly SandView[] {
    const count = nodes.length
    if (count === 0) return NO_VIEWS

    const out: SandView[] = []
    for (let i = 0; i < count; i++) {
      const node = nodes[i] as number
      out.push(this.#viewOf(node, this.#graph.ref(node)))
    }
    return out
  }

  #cell(node: number): Cell {
    let cell = this.#cells[node]
    if (cell === null || cell === undefined) {
      cell = new Cell()
      this.#cells[node] = cell
    }
    return cell
  }

  /** Ленивый вид с кэшем на узел: живёт до смены победителя. */
  #viewOf(node: number, ref: number): SandView {
    const cell = this.#cell(node)
    if (cell.ref !== ref) this.#refresh(cell, node, ref)
    return cell.view as SandView
  }

  #refresh(cell: Cell, node: number, ref: number): void {
    cell.ref = ref
    cell.view = new SandView(this, this.#arena.bin(ref), ref & CHUNK_MASK, node as LocalId)
  }

  /** Юнит бинарным слоем по офсету. Окно в арену, не копия. */
  #unitAt(ref: number): SandUnit {
    const bin = this.#arena.bin(ref)
    const at = ref & CHUNK_MASK
    return SandUnit.wrap(bin.subarray(at, at + unitLengthAt(bin, at)))
  }

}

export { ROOT, SandView, type LocalId } from './view'
