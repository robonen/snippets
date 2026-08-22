// v8:hot — интернирование зовётся трижды на каждый принятый юнит (`self`, `head`,
// `lead`) и потому лежит прямо на пути `applyUnits` из PRINCIPLES.md.

/** «Такого id ленд не знает». Один сентинел на API (правило 3 горячего пути). */
export const NO_NODE = -1

/**
 * Корень ленда: шесть нулевых байт `head` — тот же сентинел, что `ROOT === ''`
 * у слоя на объектах. Ему навсегда отдан узел №0.
 */
export const ROOT_ID = 0
export const ROOT_NODE = 0

/**
 * Предельное заполнение таблицы. 0.7 — замеренный компромисс: при 0.5 десять
 * тысяч id занимали 32 768 слотов, и это стоило 20 Б на юнит чистого запаса, а
 * цепочки линейного пробирования при 0.7 всё ещё короткие.
 */
const LOAD = 0.7

/** Начальная ёмкость: степень двойки, иначе маска пробирования перестаёт работать. */
const SEED = 64

/**
 * Перемешивание 48-битного id в 32-битный хэш. Два `imul` по половинам: ключ
 * приходит из шести произвольных байт, и у соседних id младшие биты часто
 * совпадают — без перемешивания линейное пробирование выродилось бы в список.
 */
function hash48(id: number): number {
  const high = (id / 0x1_0000_0000) | 0
  const low = id >>> 0
  return (Math.imul(high ^ 0x9e37_79b9, 0x85eb_ca6b) ^ Math.imul(low ^ 0x27d4_eb2f, 0xc2b2_ae35)) >>> 0
}

/**
 * Двусторонний интернер локальных идентификаторов: 48-битный id ↔ плотный номер
 * узла.
 *
 * Плотный номер — это SMI, он ложится в `Int32Array` и в карты без бокса. Сам
 * 48-битный id так не умеет: он точно представим в double, но не в SMI, поэтому
 * V8 боксирует его в `HeapNumber` на КАЖДОМ обращении к карте. В `order` таких
 * обращений выходило шесть на ребёнка.
 *
 * ПОЧЕМУ не `Map`, замер на 10 000 id (ADR-016, прототип «бинарный»):
 *
 * | | `Map` | эта таблица |
 * |---|---:|---:|
 * | `get` | 30.4 нс | **5.4 нс** |
 * | вставка | 62.8 нс | **14.8 нс** |
 * | память | 61.8 Б/узел | **39.4 Б/узел** |
 *
 * Ключ `0` служит признаком пустого слота, и это не ограничение: нулевой id —
 * это корень ленда, у которого свой номер узла и который в хэш-таблицу не
 * попадает вовсе.
 *
 * @example
 * ```ts
 * const ids = new Ids()
 * const node = ids.put(0x1234_5678_9abc)   // 1 — нулевой номер занят корнем
 * ids.get(0x1234_5678_9abc)                // 1
 * ids.key(node)                            // 0x1234_5678_9abc
 * ```
 */
export class Ids {
  /** Сколько номеров роздано, включая корень. Он же следующий свободный номер. */
  count: number

  /** Слот → id. `0` — слот свободен. */
  #keys: Float64Array
  /** Слот → номер узла. */
  #vals: Int32Array
  /** Номер узла → id. Обратная сторона: без неё локальная запись не соберёт байты. */
  #back: Float64Array
  #mask: number
  #used: number
  #limit: number

  constructor() {
    this.#keys = new Float64Array(SEED)
    this.#vals = new Int32Array(SEED)
    this.#back = new Float64Array(SEED)
    this.#mask = SEED - 1
    this.#used = 0
    this.#limit = (SEED * LOAD) | 0
    // Корень занимает номер 0 сразу: `#back[0] === ROOT_ID` и без вставки в
    // хэш-таблицу, где нулевой ключ означает пустой слот.
    this.count = ROOT_NODE + 1
  }

  /** Номер узла или {@link NO_NODE}. */
  get(id: number): number {
    const keys = this.#keys
    const mask = this.#mask
    let at = hash48(id) & mask
    for (;;) {
      const key = keys[at] as number
      if (key === id) return this.#vals[at] as number
      if (key === 0) return NO_NODE
      at = (at + 1) & mask
    }
  }

  /**
   * Заводит НОВЫЙ id и возвращает его плотный номер. Зовётся только после
   * промаха {@link Ids.get} — повторная вставка того же id завела бы второй узел.
   */
  put(id: number): number {
    if (this.#used >= this.#limit) this.#rehash()

    const node = this.count
    this.count = node + 1
    if (node >= this.#back.length) this.#regrow()
    this.#back[node] = id

    this.#insert(id, node)
    this.#used += 1
    return node
  }

  /** Id узла. Нужен локальной записи: в байты юнита уезжает id, а не номер. */
  key(node: number): number {
    return this.#back[node] as number
  }

  #insert(id: number, node: number): void {
    const keys = this.#keys
    const mask = this.#mask
    let at = hash48(id) & mask
    while (keys[at] !== 0) at = (at + 1) & mask
    keys[at] = id
    this.#vals[at] = node
  }

  #rehash(): void {
    const keys = this.#keys
    const vals = this.#vals
    const size = keys.length * 2

    this.#keys = new Float64Array(size)
    this.#vals = new Int32Array(size)
    this.#mask = size - 1
    this.#limit = (size * LOAD) | 0

    for (let at = 0; at < keys.length; at++) {
      const key = keys[at] as number
      if (key !== 0) this.#insert(key, vals[at] as number)
    }
  }

  /**
   * Обратный массив растёт в полтора раза, а не вдвое: при 10 000 узлах
   * удвоение оставляет 6 384 пустых слота — 18 Б на юнит чистого запаса
   * (замер `memory/per-unit` в прототипе «бинарный»).
   */
  #regrow(): void {
    const back = new Float64Array(Math.ceil(this.#back.length * 1.5))
    back.set(this.#back)
    this.#back = back
  }
}
