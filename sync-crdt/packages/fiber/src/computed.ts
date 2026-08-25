// v8:hot — `computed()` возвращает канал, через который идут все чтения
import { EMPTY_ARGS, Fiber, type FiberTask } from './fiber'
import { Flags } from './graph'

/**
 * Вычисляемое значение только для чтения: `value()`.
 *
 * Соответствует `ComputedRef` во Vue, но читается вызовом, а не через `.value` —
 * см. {@link computed}.
 */
export interface ComputedRef<T> {
  (): T
  /**
   * Узел графа — для devtools, тестов и {@link peek}.
   *
   * Собственных свойств у канала ровно два (это и `set` у записываемого), и не
   * случайно: замер показал, что переопределение `name` у функции стоит 216 Б на
   * узел, а `Object.defineProperty` — ещё и 120 нс на создание. Имя и так
   * выводится из имени задачи через `node.id`.
   */
  readonly node: Fiber<T>
}

/** Вычисляемое значение с сеттером: `value()` читает, `value(next)` пишет. */
export interface WritableComputedRef<T> extends ComputedRef<T> {
  (next: T): T
  /** Записать явно. Нужен, когда записываемое значение — само `undefined`. */
  set(next: T): T
}

export interface WritableComputedOptions<T> {
  get: () => T
  set: (next: T) => void
}

/** Ключ мультиплексированного канала. Примитив — сравнение должно быть дешёвым. */
export type ComputedKey = string | number | bigint | boolean

export interface KeyedComputedRef<K extends ComputedKey, T> {
  (key: K): T
  (key: K, next: T): T
  /** Забыть значение по ключу: следующий вызов посчитает заново. */
  forget(key: K): void
  clear(): void
  /** Сколько ключей сейчас в памяти. Для тестов и devtools. */
  readonly size: number
}

export interface KeyedComputedOptions<K extends ComputedKey, T> {
  get: (key: K) => T
  set: (key: K, next: T) => void
}

/**
 * С какого размера карта ключей начинает подметаться от осиротевших узлов.
 *
 * ПОЧЕМУ ПОРОГ, А НЕ СЧЁТЧИК ПРОМАХОВ. Первая редакция подметала «раз в сотню
 * промахов», и комментарий обещал амортизированный O(1). Обещание было неверно:
 * подметание — это обход ВСЕЙ карты, поэтому на `n` новых ключах суммарная
 * работа выходила O(n²/100), и оно вылезло на первом же потребителе с большим
 * числом ключей — слое моделей, где ключ это документ.
 *
 * Замер (`packages/core/bench/model.mjs`, отдельный прогон): цена одного промаха
 * росла ЛИНЕЙНО с числом живых ключей — 325 нс на тысяче против 1705 нс на
 * пятидесяти тысячах; холодное чтение поля модели, где промахов пять, — 2.06 →
 * 44.6 мкс. С водоразделом «подмести, когда выросли вдвое» суммарная работа
 * складывается в геометрическую прогрессию, и амортизированный O(1) становится
 * правдой: 2.06 → 2.4 мкс на тех же пятидесяти тысячах.
 *
 * Нижняя граница нужна, чтобы маленькая карта не подметалась на каждом промахе.
 */
const SWEEP_MIN = 64

function base<T>(get: () => T): ComputedRef<T>
function base<T>(options: WritableComputedOptions<T>): WritableComputedRef<T>
function base<T>(
  source: (() => T) | WritableComputedOptions<T>,
): ComputedRef<T> | WritableComputedRef<T> {
  const get = typeof source === 'function' ? source : source.get
  const set = typeof source === 'function' ? undefined : source.set

  const node = new Fiber<T>(get as FiberTask, undefined, EMPTY_ARGS, false)

  // Присваивание, а не `Object.defineProperty`: замер показал 127.9 нс против
  // 11.8 нс на создание канала — определение свойства переводит функцию на медленную
  // дорожку с полноценным хранилищем свойств (оно же стоило 216 Б памяти).
  // Плата — свойство остаётся перезаписываемым; для внутренней ручки это приемлемо.
  const channel = ((next?: T): T => {
    if (next === undefined) return node.read()
    if (set === undefined) readOnly(get.name)
    set(next)
    return node.read()
  }) as ComputedRef<T> & { node: Fiber<T>; set?: (next: T) => T }

  channel.node = node
  if (set !== undefined) {
    channel.set = (next: T) => {
      set(next)
      return node.read()
    }
  }

  return channel as ComputedRef<T> | WritableComputedRef<T>
}

function keyed<K extends ComputedKey, T>(get: (key: K) => T): KeyedComputedRef<K, T>
function keyed<K extends ComputedKey, T>(
  options: KeyedComputedOptions<K, T>,
): KeyedComputedRef<K, T>
function keyed<K extends ComputedKey, T>(
  source: ((key: K) => T) | KeyedComputedOptions<K, T>,
): KeyedComputedRef<K, T> {
  const get = typeof source === 'function' ? source : source.get
  const set = typeof source === 'function' ? undefined : source.set

  const nodes = new Map<K, Fiber<T>>()
  let sweepAt = SWEEP_MIN

  const nodeFor = (key: K): Fiber<T> => {
    const found = nodes.get(key)
    if (found !== undefined && !found.disposed) return found

    if (nodes.size >= sweepAt) {
      for (const [existing, node] of nodes) {
        if (node.disposed) nodes.delete(existing)
      }
      // Следующая уборка — когда карта вырастет ВДВОЕ. Без водораздела набор
      // живых ключей, едва перешагнувший порог, подметался бы целиком снова и
      // снова, а суммарная работа складывалась бы в квадрат (см. SWEEP_MIN).
      const next = nodes.size * 2
      sweepAt = next > SWEEP_MIN ? next : SWEEP_MIN
    }

    const fresh = new Fiber<T>(get as FiberTask, undefined, [key], false)
    nodes.set(key, fresh)
    return fresh
  }

  const channel = (key: K, next?: T): T => {
    const node = nodeFor(key)
    if (next === undefined) return node.read()
    if (set === undefined) readOnly(get.name)
    set(key, next)
    return node.read()
  }

  return Object.defineProperties(channel, {
    size: { get: () => nodes.size },
    forget: {
      value(key: K) {
        nodes.get(key)?.dispose()
        nodes.delete(key)
      },
    },
    clear: {
      value() {
        for (const node of nodes.values()) node.dispose()
        nodes.clear()
      },
    },
  }) as KeyedComputedRef<K, T>
}

/**
 * Вычисляемое значение: пересчитывается только когда изменились его зависимости,
 * и умеет приостанавливаться на асинхронных источниках.
 *
 * @example
 * ```ts
 * const count = ref(1)
 * const double = computed(() => count() * 2)
 * double() // 2
 * ```
 *
 * Записываемый вариант — пара функций, как `computed` с сеттером во Vue:
 *
 * @example
 * ```ts
 * const celsius = ref(0)
 * const fahrenheit = computed({
 *   get: () => celsius() * 1.8 + 32,
 *   set: (f) => celsius((f - 32) / 1.8),
 * })
 * fahrenheit(212) // → 212, celsius() === 100
 * ```
 *
 * И вариант с собственным кэшем на каждый ключ — аналога во Vue нет, но для модели
 * данных он основной (пешка по идентификатору, порядок по голове):
 *
 * @example
 * ```ts
 * const user = computed.keyed((id: string) => sync(loadUser, id))
 * user('u1')
 * ```
 *
 * **Отличие от Vue — вызов вместо `.value`.** Чтение и запись выражены одной
 * функцией: так чтение может приостановиться, а прикладной код не обрастает
 * `.value`. Цена — `undefined` при записи трактуется как чтение; для явной записи
 * есть {@link WritableComputedRef.set}.
 */
export const computed = Object.assign(base, { keyed })

/** Прочитать канал без подписки и без пересчёта — только то, что уже посчитано. */
export function peek<T>(channel: { readonly node: { result(): T | undefined } }): T | undefined {
  return channel.node.result()
}

/**
 * Эффект, который сам отслеживает зависимости и перезапускается при их изменении —
 * то же, что `watchEffect` во Vue.
 *
 * Приостановки наружу не выпускает: пока ждём, эффект ничего не обновляет, а после
 * разрешения промиса планировщик прогонит его снова.
 *
 * @returns функция остановки
 */
export function watchEffect(fn: () => void): () => void {
  const node = new Fiber<void>(fn as FiberTask, undefined, EMPTY_ARGS, false)
  node.flags = Flags.Watching
  node.pinned = true
  node.update()

  return () => {
    node.pinned = false
    node.dispose()
  }
}

function readOnly(name: string): never {
  throw new TypeError(
    `computed ${name === '' ? '(unnamed)' : name}: channel is read-only`,
  )
}
