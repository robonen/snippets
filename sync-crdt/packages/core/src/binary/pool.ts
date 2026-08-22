// Аллокатор свободного места в линейном образе — то, чем «файл хранилища
// одновременно является ареной аллокатора» (docs/06 §4) перестаёт быть словами.
//
// ─── Зачем он вообще ─────────────────────────────────────────────────────────
//
// Долг, записанный в docs/11 («Ленд S4»): арена не переиспользует байты
// перекрытых версий, поэтому память растёт по ЧИСЛУ ПРАВОК, а не по объёму живых
// данных — ровно на сценарии «правят текст», ради которого затевается
// local-first. Тот же долг у файла: бюджет S5 требует, чтобы после 10 000
// save/delete файл остался ≤ 1.3× от полезного объёма.
//
// ─── Почему ОДИН класс на два места ──────────────────────────────────────────
//
// Правило трёх повторений говорит «два похожих места — копипаста и комментарий».
// Здесь сознательное исключение, и вот основание: у арены ленда и у образа
// хранилища совпадает не форма, а СУЩНОСТНАЯ сложность — склейка соседей и
// раскол блока под меньший запрос. Скопировать её дважды значит получить два
// аллокатора, которые разойдутся в углах (склейка через границу, устаревшая
// запись корзины) и оба будут неверны по-своему.
//
// ─── Что здесь сделано и чего нет ────────────────────────────────────────────
//
//  ✓ склейка с соседями слева и справа — без неё удаление санда на 56 байт
//    оставляет семь восьмёрок, в которые следующий санд не влезет;
//  ✓ раскол блока побольше — без него склейка сама себе враг: слипшиеся соседи
//    перестают подходить под точный запрос и становятся мёртвым местом;
//  ✗ ни поиска «лучшего» блока, ни дефрагментации. Точный класс размера покрывает
//    почти всё: длина юнита кратна 8 и лежит в узком наборе (48…112 для
//    inline-санда), поэтому перезапись поля почти всегда попадает в свой же класс.
//
// ─── Граница глав ────────────────────────────────────────────────────────────
//
// Арена ленда режет адресное пространство на главы по 64 КиБ (`land/arena.ts`), и
// блок не имеет права пересечь границу: соседние по адресу байты лежат в разных
// буферах. Отсюда `bound`: склейка запрещена ровно там, где стык приходится на
// границу. Образу хранилища граница не нужна — он один сплошной буфер.

/** «Места нет» — один сентинел на API (правило 3 горячего пути). */
export const NO_ROOM = -1

/**
 * Свободное место линейного образа: карта блоков, склейка соседей, корзины по
 * размеру.
 *
 * @example
 * ```ts
 * const pool = new Pool()
 * pool.release(64, 128)      // освободили [64, 192)
 * pool.alloc(48)             // 64 — остаток [112, 192) вернулся в пул
 * ```
 */
export class Pool {
  /** Начало блока → его длина. Каноническое множество свободных блоков. */
  readonly #at: Map<number, number>
  /** Конец блока → его начало. Нужен склейке слева: соседа иначе не найти. */
  readonly #end: Map<number, number>
  /**
   * Длина → начала блоков этой длины.
   *
   * Записи бывают УСТАРЕВШИМИ: блок, слипшийся с соседом, остаётся в корзине
   * прежней длины. Чистить корзины на каждой склейке значило бы искать в массиве;
   * вместо этого запись проверяется по {@link Pool.#at} в момент выдачи. Мусор
   * ограничен числом освобождений и рассасывается сам.
   */
  readonly #bins: Map<number, number[]>
  /** Длины, под которые есть корзины, по возрастанию — для поиска блока побольше. */
  readonly #sizes: number[]
  readonly #bound: number
  #bytes: number

  /**
   * @param bound размер сегмента, через границу которого блоки не склеиваются
   * (глава арены). `0` — сплошное адресное пространство.
   */
  constructor(bound = 0) {
    this.#at = new Map()
    this.#end = new Map()
    this.#bins = new Map()
    this.#sizes = []
    this.#bound = bound
    this.#bytes = 0
  }

  /** Сколько байт лежит в свободных блоках. Знаменатель бюджета «файл ≤ 1.3×». */
  bytes(): number {
    return this.#bytes
  }

  /** Сколько свободных блоков — диагностика фрагментации, не бюджет. */
  count(): number {
    return this.#at.size
  }

  /**
   * Пометить `[at, at + size)` свободным, склеив с соседями.
   *
   * Реализует `PackPool` из `binary/pack.ts`: парсер сдаёт сюда прогоны
   * зачищенных слотов при разборе образа хранилища.
   */
  release(at: number, size: number): void {
    if (size <= 0) return

    let from = at
    let span = size
    this.#bytes += size

    // Слева: сосед, чей конец приходится ровно на наше начало. Через границу
    // главы не склеиваем — за ней другой буфер.
    if (this.#bound === 0 || from % this.#bound !== 0) {
      const left = this.#end.get(from)
      if (left !== undefined) {
        const leftSize = this.#at.get(left) as number
        this.#at.delete(left)
        this.#end.delete(from)
        from = left
        span += leftSize
      }
    }

    // Справа: блок, начинающийся ровно там, где мы кончаемся.
    const rightAt = from + span
    if (this.#bound === 0 || rightAt % this.#bound !== 0) {
      const rightSize = this.#at.get(rightAt)
      if (rightSize !== undefined) {
        this.#at.delete(rightAt)
        this.#end.delete(rightAt + rightSize)
        span += rightSize
      }
    }

    this.#put(from, span)
  }

  /**
   * Место под `size` байт из свободных блоков или {@link NO_ROOM}.
   *
   * Сначала точный класс — он покрывает перезапись поля тем же по длине
   * значением, а это самый частый вход. Потом наименьший блок, который больше
   * запроса; остаток немедленно возвращается в пул.
   */
  alloc(size: number): number {
    if (size <= 0) return NO_ROOM

    const exact = this.#take(size)
    if (exact !== NO_ROOM) {
      this.#bytes -= size
      return exact
    }

    const sizes = this.#sizes
    // Двоичный поиск первой длины строго больше запроса: равную уже пробовали.
    let low = 0
    let high = sizes.length
    while (low < high) {
      const mid = (low + high) >>> 1
      if ((sizes[mid] as number) <= size) low = mid + 1
      else high = mid
    }

    for (let i = low; i < sizes.length; i++) {
      const bigger = sizes[i] as number
      const at = this.#take(bigger)
      if (at === NO_ROOM) {
        // Корзина оказалась пустой — её длина ушла из `#sizes`, и индекс сдвинулся.
        i -= 1
        continue
      }
      // Учёт свободных байт меняется ровно на выданное: остаток блока
      // возвращается в пул и продолжает считаться свободным.
      this.#bytes -= size
      this.#put(at + size, bigger - size)
      return at
    }

    return NO_ROOM
  }

  /** Забыть всё: образ пересобран заново. */
  clear(): void {
    this.#at.clear()
    this.#end.clear()
    this.#bins.clear()
    this.#sizes.length = 0
    this.#bytes = 0
  }

  #put(at: number, size: number): void {
    if (size <= 0) return
    this.#at.set(at, size)
    this.#end.set(at + size, at)

    let bin = this.#bins.get(size)
    if (bin === undefined) {
      bin = []
      this.#bins.set(size, bin)
      this.#insert(size)
    }
    bin.push(at)
  }

  /** Снять блок ровно этой длины, пропуская устаревшие записи корзины. */
  #take(size: number): number {
    const bin = this.#bins.get(size)
    if (bin === undefined) return NO_ROOM

    while (bin.length > 0) {
      const at = bin.pop() as number
      if (this.#at.get(at) !== size) continue
      this.#at.delete(at)
      this.#end.delete(at + size)
      if (bin.length === 0) this.#drop(size)
      return at
    }

    this.#drop(size)
    return NO_ROOM
  }

  #insert(size: number): void {
    const sizes = this.#sizes
    let low = 0
    let high = sizes.length
    while (low < high) {
      const mid = (low + high) >>> 1
      if ((sizes[mid] as number) < size) low = mid + 1
      else high = mid
    }
    sizes.splice(low, 0, size)
  }

  #drop(size: number): void {
    this.#bins.delete(size)
    const sizes = this.#sizes
    const where = sizes.indexOf(size)
    if (where >= 0) sizes.splice(where, 1)
  }
}
