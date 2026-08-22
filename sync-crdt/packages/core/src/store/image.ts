// Образ ленда: файл, который ОДНОВРЕМЕННО валидная пачка и арена аллокатора
// (docs/06 §4, ADR-005).
//
// ─── Почему это вообще возможно ──────────────────────────────────────────────
//
// Все секции формата кратны восьми байтам, а нулевой байт вида зарезервирован
// под «слот свободен» (docs/03 §3). Значит удалённый юнит можно просто занулить,
// и файл останется разбираемым: парсер такие слоты пропускает, а `PackCursor`
// отдаёт их прогонами. Отсюда три следствия, ради которых всё и затевалось:
//
//   • отдельный индекс свободных мест не нужен — его восстанавливает загрузка;
//   • перезапись значения той же длины НЕ ДВИГАЕТ файл вовсе: юнит ложится в
//     тот же слот, потому что ключ `(head, peer, self)` у него тот же;
//   • экспорт, бэкап и отправка по проводу — это тот же файл без конверсии.
//
// ─── Слот — это юнит ВМЕСТЕ с его значением ──────────────────────────────────
//
// У большого санда сразу за юнитом лежит `ball`, добитый нулями до кратности 8.
// Образ хранит их одним слотом ровно потому, что так они лежат в пачке и так же
// лежат в арене ленда: одна раскладка на три места, и копирование между ними —
// `set`, а не сборка.
//
// ─── Чего образ НЕ делает ────────────────────────────────────────────────────
//
// Не решает LWW. Хранилище — не реплика: кто победил, знает ленд, и в образ
// приезжает уже победитель. Образ отвечает на один вопрос — «где лежит юнит с
// таким ключом» — и заменяет его содержимое.

import { PACK_BYTES, PACK_STEP, PackCursor, PackError, packHead, type LandId } from '../binary/pack'
import { NO_ROOM, Pool } from '../binary/pool'
import { SAND_AT, UNIT_AT, UNIT_BYTES, shotKey, unitKeyAt, unitSpanAt } from '../binary/unit'
import { readU16 } from '../binary/bytes'
import { StoreError, type Volume } from './store'

/** Метка `LAND` первым байтом: она же признак «образ дописан до конца». */
const MAGIC = [0x4c, 0x41, 0x4e, 0x44]
const KIND_SAND = 1
const INLINE_BIG = UNIT_BYTES.inlineBig

/** Начальный размер образа: заголовок плюс место под первый батч. */
const SEED = 4096

/**
 * Образ одного ленда над носителем.
 *
 * @example
 * ```ts
 * const image = PackImage.open(volume, id)
 * image.soil()                 // пометить «пишу»
 * image.merge(pack)            // влить изменения
 * image.seal()                 // пометить «дописано»
 * ```
 */
export class PackImage {
  readonly #volume: Volume
  readonly #id: LandId
  /** Ключ юнита → офсет его слота. Восстанавливается разбором при открытии. */
  readonly #index: Map<string, number>
  /** `shotKey` выносного значения → офсет слота его санда. Только для больших сандов. */
  readonly #balls: Map<string, number>
  readonly #pool: Pool
  /** Граница, за которой файл ещё не размечен. */
  #fill: number
  /** Сумма длин живых слотов плюс заголовок — знаменатель бюджета «файл ≤ 1.3×». */
  #live: number

  private constructor(volume: Volume, id: LandId) {
    this.#volume = volume
    this.#id = id
    this.#index = new Map()
    this.#balls = new Map()
    this.#pool = new Pool()
    this.#fill = PACK_BYTES.head
    this.#live = PACK_BYTES.head
  }

  /** Дописан ли образ до конца — метка секции на месте. См. {@link PackImage.soil}. */
  static clean(volume: Volume): boolean {
    const bin = volume.bin()
    if (bin.length < PACK_BYTES.head) return false
    for (let i = 0; i < MAGIC.length; i++) {
      if (bin[i] !== MAGIC[i]) return false
    }
    return true
  }

  /**
   * Разобрать ДОПИСАННЫЙ образ: индекс ключей, карта баллов и состояние
   * аллокатора — за один проход курсором.
   *
   * Оборванный образ сюда не подаётся: решать, что с ним делать, — дело пары
   * зеркал (`mirrors.ts`), а не одного образа. Молча переформатировать его здесь
   * значило бы уничтожить данные ровно в том случае, ради которого зеркала и
   * заведены.
   *
   * @throws {StoreError} если образ оборван, не разбирается или несёт чужой ленд.
   */
  static open(volume: Volume, id: LandId): PackImage {
    if (!PackImage.clean(volume)) {
      throw new StoreError('образ оборван на записи — метки секции нет', `ленд ${id.str}`)
    }
    const image = new PackImage(volume, id)
    image.#scan()
    return image
  }

  /** Разметить пустой носитель под ленд: заголовок и ни одного юнита. */
  static create(volume: Volume, id: LandId): PackImage {
    const image = new PackImage(volume, id)
    image.#format()
    return image
  }

  /** Байты образа как есть — со всеми дырами. Для зеркалирования и диагностики. */
  raw(): Uint8Array {
    return this.#volume.bin()
  }

  /** Сколько байт занимает образ на носителе. */
  bytes(): number {
    return this.#volume.bin().length
  }

  /** Полезный объём: заголовок плюс живые слоты. Знаменатель бюджета «файл ≤ 1.3×». */
  live(): number {
    return this.#live
  }

  /** Сколько юнитов в образе. */
  count(): number {
    return this.#index.size
  }

  /**
   * Плотная пачка живых юнитов — то, что уезжает в {@link UnitStore.load}.
   *
   * Копия, а не окно: ленд примет её главами арены и будет держать, пока жив, а
   * образ продолжит править свои байты на месте. И копия ПЛОТНАЯ — дыры,
   * накопленные перезаписями, в память ленда не едут.
   */
  pack(): Uint8Array {
    const bin = this.#volume.bin()
    const out = new Uint8Array(this.#live)
    packHead(out, 0, this.#id)

    let at = PACK_BYTES.head
    for (const from of this.#index.values()) {
      const span = unitSpanAt(bin, from)
      out.set(bin.subarray(from, from + span), at)
      at += span
    }
    return out
  }

  /** Выносное значение по его хэшу. `undefined` — такого нет. */
  ball(shot: Uint8Array): Uint8Array | undefined {
    const at = this.#balls.get(shotKey(shot))
    if (at === undefined) return undefined
    const bin = this.#volume.bin()
    const from = at + SAND_AT.payload
    return bin.slice(from, from + readU16(bin, at + SAND_AT.size))
  }

  /**
   * Пометить образ незавершённым, стерев метку секции.
   *
   * ПОЧЕМУ ИМЕННО МЕТКА, а не отдельный флаг или mtime. Пометка обязана
   * (а) помещаться в формат, не занимая в нём места, и (б) переживать РВАНУЮ
   * запись: если носитель успел записать два байта из четырёх, результат обязан
   * читаться как «грязно», а не как «чисто». Метка `"LAND"` даёт и то, и другое:
   * места она не занимает (она уже есть), а сравнение идёт по всем четырём
   * байтам — любой недописанный вариант отличается от эталона.
   *
   * mtime для этой роли не годится вовсе: он говорит «кто новее», а нужен ответ
   * «кто ДОПИСАН». Обрыв делает файл одновременно самым новым и негодным — и
   * именно его выбрал бы алгоритм по mtime из черновика docs/06 §4.
   */
  soil(): void {
    const bin = this.#volume.bin()
    bin.fill(0, 0, MAGIC.length)
    this.#volume.wrote(0, MAGIC.length)
    this.#volume.flush()
  }

  /** Вернуть метку секции: образ дописан и им можно пользоваться. */
  seal(): void {
    const bin = this.#volume.bin()
    for (let i = 0; i < MAGIC.length; i++) bin[i] = MAGIC[i] as number
    this.#volume.wrote(0, MAGIC.length)
    this.#volume.flush()
  }

  /**
   * Влить пачку: каждый юнит замещает прежнюю версию своего ключа.
   *
   * Зовётся МЕЖДУ {@link PackImage.soil} и {@link PackImage.seal} — сама по себе
   * атомарности не даёт и не должна: атомарность это свойство пары зеркал, а не
   * одного образа (`mirrors.ts`).
   */
  merge(pack: Uint8Array): void {
    const cursor = new PackCursor(pack)
    for (let step = cursor.next(); step !== PACK_STEP.end; step = cursor.next()) {
      if (step !== PACK_STEP.unit) continue
      this.#put(pack, cursor.at, cursor.span)
    }
  }

  /** Стереть содержимое и разметить заново — ленд удалён целиком. */
  reset(): void {
    this.#format()
  }

  /**
   * Скопировать чужой образ поверх своего — восстановление зеркала.
   *
   * ПОД `soil`/`seal`, как и всякая запись. Первая редакция копировала одним
   * `wrote(0, …)` без метки, и это делало восстановление опаснее той поломки,
   * которую оно чинит: `PackImage.create` перед копией зовёт `#format()`, а тот
   * пишет метку секции и делает `flush`, — то есть сторона объявляется ЦЕЛОЙ и
   * ПУСТОЙ ещё до того, как в неё приедут данные. Обрыв в этом окне оставлял
   * валидную пустышку, а следующее открытие брало её ведущей и восстанавливало
   * по ней вторую сторону — единственную, где данные ещё были. Ленд исчезал
   * целиком, при том что на носителе он был.
   *
   * С меткой недописанная копия не выглядит целой, и открытие её отвергает.
   */
  clone(source: Uint8Array): void {
    this.soil()
    let bin = this.#volume.bin()
    if (bin.length < source.length) bin = this.#volume.grow(source.length)

    // Тело копируется МИМО метки, и это не мелочь, а суть протокола. Копия
    // содержит и первые четыре байта источника, то есть его метку; скопировав
    // их, недописанный образ сам себя объявил бы целым — `soil` перед этим не
    // помогает вовсе, потому что байты возвращаются на место той же копией.
    // Поймано собственным тестом: обрыв на копии оставлял `clean() === true`.
    bin.set(source.subarray(MAGIC.length), MAGIC.length)
    if (bin.length > source.length) bin.fill(0, source.length)
    this.#volume.wrote(MAGIC.length, bin.length - MAGIC.length)
    this.#volume.flush()

    // И только теперь — метка. До неё образ негоден и таковым выглядит.
    this.seal()
    this.#scan()
  }

  // ── Внутреннее ─────────────────────────────────────────────────────────────

  #format(): void {
    let bin = this.#volume.bin()
    if (bin.length < SEED) bin = this.#volume.grow(SEED)
    bin.fill(0)
    packHead(bin, 0, this.#id)
    this.#volume.wrote(0, bin.length)
    this.#volume.flush()

    this.#index.clear()
    this.#balls.clear()
    this.#pool.clear()
    this.#fill = PACK_BYTES.head
    this.#live = PACK_BYTES.head
  }

  /** Разбор образа: индекс, баллы и свободные слоты — за один проход курсором. */
  #scan(): void {
    const bin = this.#volume.bin()
    this.#index.clear()
    this.#balls.clear()
    this.#pool.clear()
    this.#live = PACK_BYTES.head

    const cursor = new PackCursor(bin)
    let heads = 0

    try {
      for (let step = cursor.next(); step !== PACK_STEP.end; step = cursor.next()) {
        if (step === PACK_STEP.free) {
          // Ровно то, ради чего файл сделан пачкой: состояние аллокатора
          // восстанавливается разбором, отдельного индекса дыр не существует.
          this.#pool.release(cursor.at, cursor.size)
          continue
        }
        if (step === PACK_STEP.land) {
          heads += 1
          if (!sameLand(cursor.land, this.#id)) {
            throw new StoreError(
              `образ несёт ленд ${cursor.land.str}, а открывают ${this.#id.str}`,
              `офсет ${cursor.at}`,
            )
          }
          continue
        }
        this.#index.set(unitKeyAt(bin, cursor.at), cursor.at)
        this.#live += cursor.span
        this.#reball(bin, cursor.at)
      }
    } catch (cause) {
      if (cause instanceof PackError) {
        throw new StoreError('образ не разбирается как пачка', `ленд ${this.#id.str}`, cause)
      }
      throw cause
    }

    if (heads === 0) {
      throw new StoreError('в образе нет заголовка ленда', `ленд ${this.#id.str}`)
    }
    this.#fill = bin.length
  }



  /**
   * Положить юнит со значением, заместив прежнюю версию того же ключа.
   *
   * Карта баллов правится ДО перезаписи байт: `shot` прежней версии читается из
   * тех самых байт, которые сейчас исчезнут, и снятый после записи ключ был бы
   * уже новым — прежний остался бы в карте навсегда, указывая на чужое значение.
   */
  #put(src: Uint8Array, from: number, span: number): void {
    const key = unitKeyAt(src, from)
    const known = this.#index.get(key)
    let bin = this.#volume.bin()

    if (known !== undefined) {
      const was = unitSpanAt(bin, known)
      this.#unball(bin, known)

      if (was === span) {
        // САМЫЙ ЧАСТЫЙ ВХОД: перезапись значения той же длины. Файл не растёт ни
        // на байт, аллокатор не трогается вовсе, индекс уже указывает куда надо.
        bin.set(src.subarray(from, from + span), known)
        this.#volume.wrote(known, span)
        this.#reball(bin, known)
        return
      }

      // Длина изменилась: слот зануляется (для парсера это «свободно») и уходит
      // в пул, где склеится с соседями.
      bin.fill(0, known, known + was)
      this.#volume.wrote(known, was)
      this.#index.delete(key)
      this.#pool.release(known, was)
      this.#live -= was
    }

    const at = this.#room(span)
    bin = this.#volume.bin()
    bin.set(src.subarray(from, from + span), at)
    this.#volume.wrote(at, span)
    this.#index.set(key, at)
    this.#live += span
    this.#reball(bin, at)
  }

  /** Запомнить выносное значение слота — если оно там есть. */
  #reball(bin: Uint8Array, at: number): void {
    if (bin[at + UNIT_AT.kind] !== KIND_SAND) return
    if (((bin[at + UNIT_AT.meta] as number) & 0b111111) !== INLINE_BIG) return
    this.#balls.set(shotKey(bin.subarray(at + SAND_AT.shot, at + SAND_AT.shot + UNIT_BYTES.shot)), at)
  }

  /** Забыть выносное значение слота — до того, как его байты будут переписаны. */
  #unball(bin: Uint8Array, at: number): void {
    if (bin[at + UNIT_AT.kind] !== KIND_SAND) return
    if (((bin[at + UNIT_AT.meta] as number) & 0b111111) !== INLINE_BIG) return
    this.#balls.delete(shotKey(bin.subarray(at + SAND_AT.shot, at + SAND_AT.shot + UNIT_BYTES.shot)))
  }

  /** Место под слот: из освобождённых, потом с конца, потом расширением образа. */
  #room(span: number): number {
    const spare = this.#pool.alloc(span)
    if (spare !== NO_ROOM) return spare

    let bin = this.#volume.bin()
    if (this.#fill + span > bin.length) {
      // Вдвое, но не меньше нужного: образ растёт батчами по 1000 юнитов, и
      // расширение на каждый юнит превратило бы сохранение в квадрат.
      bin = this.#volume.grow(Math.max(bin.length * 2, this.#fill + span))
    }

    const at = this.#fill
    this.#fill = at + span
    return at
  }
}

/** Тот же ленд — сравнением байт: `Link` номинален, но приезжает из разных мест. */
function sameLand(a: LandId, b: LandId): boolean {
  if (a.bin.length !== b.bin.length) return false
  for (let i = 0; i < a.bin.length; i++) {
    if (a.bin[i] !== b.bin[i]) return false
  }
  return true
}
