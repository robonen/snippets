// v8:hot — `order()` числится горячим в PRINCIPLES.md, и здесь лежит вся его
// работа. Правила действуют на весь файл: плотные типизированные массивы, ни
// одной аллокации на ребёнка, ни одной карты внутри цикла.
//
// ─── Что это ─────────────────────────────────────────────────────────────────
//
// Плотный граф узлов ленда и раскладка по цепочке `lead` (docs/04 §2). Отделён
// от самого ленда по оси изменения: здесь живёт АЛГОРИТМ, у которого есть
// наивный оракул и дифференциальный тест, а в `land.ts` — приём, хранение и
// реактивность. Граф не знает ни про пиров, ни про сигналы, ни про часы.
//
// ─── Почему всё в Int32Array ─────────────────────────────────────────────────
//
// Номер узла — SMI, и он ложится в типизированный массив без бокса. Тот же
// индекс на картах стоил бы 6.4 нс на обращение против 1 нс у массива, а
// обращений в раскладке выходит по несколько на ребёнка. Метка обхода — эпоха в
// `Int32Array`, а не множество: `Set` из 48-битных ключей стоил 19.6 нс на
// проверку.

import { SAND_AT } from '../binary/unit'
import { Arena, CHUNK_MASK, NO_REF } from './arena'
import { NO_NODE, ROOT_NODE } from './ids'
import { cmpAt, deadAt, id48 } from './view'

/** Начальная ёмкость плотных массивов. Растут в полтора раза (см. {@link Graph.born}). */
const SEED = 64

const NO_NODES: readonly number[] = Object.freeze([])

/**
 * Узлы ленда: победитель, связь `lead`, принадлежность голове и раскладка.
 *
 * Победителя и его `lead` кладёт {@link Graph.crown}; порядок восстанавливает
 * {@link Graph.layout}. Порядок нигде не хранится — он вычисляется из цепочки
 * `lead` при каждом чтении, и именно отсюда берётся interleaving-free.
 *
 * @example
 * ```ts
 * graph.born(node)
 * graph.crown(node, head, ref, lead)
 * graph.layout(head)   // номера живых детей в порядке чтения
 * ```
 */
export class Graph {
  readonly #arena: Arena

  /** Номер узла → офсет победителя LWW ({@link NO_REF} — юнита нет). */
  #refs: Int32Array
  /** Номер узла → его `lead` номером узла. Кэш: раскладка не лезет за ним в байты. */
  #leads: Int32Array
  /** Номер узла → голова, под которой он числится в {@link Graph.kids}. */
  #listed: Int32Array
  /** Метка обхода: эпоха монотонна, поэтому чистить массив между вызовами не нужно. */
  #seen: Int32Array
  /** Группировка по `lead` на время одного вызова: первый ребёнок и следующий сосед. */
  #gHead: Int32Array
  #gNext: Int32Array
  #epoch: number

  /** Голова → её дети плотным списком. */
  readonly #kids: Map<number, number[]>

  readonly #cmp: (a: number, b: number) => number

  constructor(arena: Arena) {
    this.#arena = arena
    this.#refs = new Int32Array(SEED).fill(NO_REF)
    this.#leads = new Int32Array(SEED)
    this.#listed = new Int32Array(SEED).fill(NO_NODE)
    this.#seen = new Int32Array(SEED)
    this.#gHead = new Int32Array(SEED).fill(NO_NODE)
    this.#gNext = new Int32Array(SEED)
    this.#epoch = 0
    this.#kids = new Map()

    // Замыкание одно на граф, а не на вызов `sort` (правило 7 горячего пути).
    this.#cmp = (a: number, b: number): number => {
      const left = this.#refs[a] as number
      const right = this.#refs[b] as number
      const binA = this.#arena.bin(left)
      const binB = this.#arena.bin(right)
      const atA = left & CHUNK_MASK
      const atB = right & CHUNK_MASK

      const lww = cmpAt(binA, atA, binB, atB)
      if (lww !== 0) return lww

      // Ничья по `(time, peer, tick)` — арбитр по `self`, порт `rank()` из
      // `order.ts` (S3). Он нужен не ради таких входов, а ради того, чтобы
      // порядок раскладки ВООБЩЕ не зависел от порядка доставки: `sort`
      // стабильна, на ничьих она сохранила бы порядок группировки, а тот идёт
      // от порядка приёма — и две реплики с одним набором юнитов прочитали бы
      // разное. Воспроизведение до этой строки: три брата с одной меткой
      // читались как `v3 v2 v1`, `v1 v2 v3` и `v1 v3 v2` в зависимости от
      // очерёдности доставки.
      //
      // По БАЙТАМ (как `peer` в ADR-015): `id48` — big-endian, поэтому
      // числовой порядок 48-битных значений и есть лексикографический
      // побайтовый. Ветка холодная — `cmpAt` отдаёт ноль только на юнитах с
      // совпавшими меткой, пиром и тиком.
      const selfA = id48(binA, atA + SAND_AT.self)
      const selfB = id48(binB, atB + SAND_AT.self)
      if (selfA === selfB) return 0
      return selfA < selfB ? -1 : 1
    }
  }

  /** Дать место новому номеру узла. */
  born(node: number): void {
    if (node < this.#refs.length) return

    // В полтора раза, а не вдвое: при 10 000 узлах удвоение оставляет 6 384
    // пустых слота — 18 Б на юнит чистого запаса.
    const size = Math.ceil(this.#refs.length * 1.5)

    const refs = new Int32Array(size).fill(NO_REF)
    refs.set(this.#refs)
    this.#refs = refs

    const leads = new Int32Array(size)
    leads.set(this.#leads)
    this.#leads = leads

    const listed = new Int32Array(size).fill(NO_NODE)
    listed.set(this.#listed)
    this.#listed = listed

    // Метки обхода переносить незачем: эпоха монотонна, а нули заведомо не
    // совпадут с текущей. Группировка живёт внутри одного `layout` и к моменту
    // роста уже разобрана.
    this.#seen = new Int32Array(size)
    this.#gHead = new Int32Array(size).fill(NO_NODE)
    this.#gNext = new Int32Array(size)
  }

  /** Офсет победителя узла или {@link NO_REF}. */
  ref(node: number): number {
    return this.#refs[node] as number
  }

  /** `lead` победителя номером узла. */
  lead(node: number): number {
    return this.#leads[node] as number
  }

  /**
   * Новый победитель узла.
   *
   * @returns прежняя голова узла, если он переехал к другому родителю, иначе
   * {@link NO_NODE}: разбудить читателей старой головы обязан ленд, а сигналов
   * граф не знает.
   */
  crown(node: number, head: number, ref: number, lead: number): number {
    this.#refs[node] = ref
    this.#leads[node] = lead

    const listed = this.#listed[node] as number
    if (listed === head) return NO_NODE

    if (listed !== NO_NODE) {
      // Переезд узла к другому родителю: `Replica` его не делает, но чужой ленд
      // не обязан вести себя как она — иначе список детей старой головы соврёт.
      const from = this.#kids.get(listed)
      if (from !== undefined) {
        const where = from.indexOf(node)
        if (where >= 0) from.splice(where, 1)
      }
    }

    const into = this.#kids.get(head)
    if (into === undefined) this.#kids.set(head, [node])
    else into.push(node)
    this.#listed[node] = head

    return listed
  }

  /**
   * Номера живых детей головы в порядке чтения. Надгробия из выдачи уходят, но
   * из обхода нет: на мёртвый узел ссылаются по `lead` те, кто встал за ним.
   */
  layout(head: number): readonly number[] {
    const kids = this.#kids.get(head)
    if (kids === undefined || kids.length === 0) return NO_NODES

    const leads = this.#leads
    const gHead = this.#gHead
    const gNext = this.#gNext
    const count = kids.length

    // 1. Группировка по `lead` — односвязные списки в двух `Int32Array`, а не
    //    `Map<lead, node[]>`. Карта стоила обращения на ребёнка и, главное,
    //    ОТДЕЛЬНОГО МАССИВА на каждую группу: в плоском списке у каждого `lead`
    //    ровно один ребёнок, то есть тысяча групп — это тысяча аллокаций на
    //    каждый вызов. Замер: 65.0 → 21.8 мкс на тысяче детей.
    //
    //    Свёртка LWW тут уже не нужна: победителя посчитал приём, тогда как
    //    наивная раскладка делает её на каждом чтении (около 28 % её времени).
    for (let i = 0; i < count; i++) {
      const node = kids[i] as number
      const lead = leads[node] as number
      gNext[node] = gHead[lead] as number
      gHead[lead] = node
    }

    // 2. Обход в глубину от начала списка: спуск в глубину и даёт
    //    interleaving-free — блок, вставленный цепочкой, выкладывается целиком,
    //    прежде чем начнётся соседний. Конкуренты за одну позицию сортируются в
    //    момент спуска, там, где их больше одного.
    const epoch = ++this.#epoch
    const out: number[] = []
    const seen = this.#walk(epoch, out, ROOT_NODE)

    // 3. Сироты — кольца из конкурентных `move` и юниты с недоехавшим `lead`.
    //    Без этого шага живые по LWW элементы молча пропадали бы из чтения, а
    //    сходимость этого не ловит: реплики теряют их согласованно.
    if (seen < count) this.#strays(epoch, out, kids)

    // 4. Группировка живёт ровно один вызов. Чистится по тем же `lead`, по
    //    которым заполнялась, — это дешевле отдельного массива меток.
    for (let i = 0; i < count; i++) gHead[leads[kids[i] as number] as number] = NO_NODE

    return out
  }

  /** Обход поддерева. Возвращает, сколько узлов посетил. */
  #walk(epoch: number, out: number[], from: number): number {
    const seen = this.#seen
    const refs = this.#refs
    let count = 0

    // Обход итеративный: цепочка из 10 000 последовательных вставок — обычный
    // текст, а не патология, и рекурсия на ней ложится по стеку.
    const stack: number[] = []
    this.#push(stack, from)

    while (stack.length > 0) {
      const node = stack.pop() as number
      // Кольцо в цепочке `lead` не должно вешать обход: оно возникает при
      // конкурентных `move` и является штатным итогом независимых правок.
      if (seen[node] === epoch) continue
      seen[node] = epoch
      count += 1

      const ref = refs[node] as number
      if (!deadAt(this.#arena.bin(ref), ref & CHUNK_MASK)) out.push(node)

      this.#push(stack, node)
    }

    return count
  }

  /**
   * Кладёт детей `from` в стек так, чтобы снимались они по порядку LWW.
   *
   * Один ребёнок — самый частый случай (в плоском списке он единственный), и он
   * не стоит ни аллокации, ни сравнения. Массив и сортировка появляются только
   * там, где за одну позицию конкурируют несколько юнитов; сортировка, а не
   * вставка в упорядоченный список, потому что «все вставляют в начало» —
   * обычный сценарий (лента, чат), и вставка выродилась бы в O(k²).
   */
  #push(stack: number[], from: number): void {
    const gHead = this.#gHead
    const gNext = this.#gNext

    const first = gHead[from] as number
    if (first === NO_NODE) return

    const second = gNext[first] as number
    if (second === NO_NODE) {
      stack.push(first)
      return
    }

    const group: number[] = [first, second]
    for (let at = gNext[second] as number; at !== NO_NODE; at = gNext[at] as number) group.push(at)
    group.sort(this.#cmp)
    for (let i = group.length - 1; i >= 0; i--) stack.push(group[i] as number)
  }

  /** Дописывает в хвост всё, до чего не дотянулась ни одна связь, — по порядку LWW. */
  #strays(epoch: number, out: number[], kids: readonly number[]): void {
    const seen = this.#seen
    const refs = this.#refs

    const strays: number[] = []
    for (let i = 0; i < kids.length; i++) {
      const node = kids[i] as number
      if (seen[node] !== epoch) strays.push(node)
    }
    strays.sort(this.#cmp)

    for (let i = 0; i < strays.length; i++) {
      const node = strays[i] as number
      // Сироту мог утащить за собой предыдущий каскад: внутри кольца у каждого
      // узла есть свой `lead`, просто ни один из них не достижим снаружи.
      if (seen[node] === epoch) continue
      seen[node] = epoch

      const ref = refs[node] as number
      if (!deadAt(this.#arena.bin(ref), ref & CHUNK_MASK)) out.push(node)
      this.#walk(epoch, out, node)
    }
  }
}
