import { Fiber, isSuspend } from './fiber'
import { watchEffect } from './computed'
import { KIND_FIBER, getActiveSub, setActiveSub, setWarm } from './graph'

/**
 * Прочитать граф, ничего в нём не изменив: файберы не считают и не подписываются,
 * отдают только то, что уже лежит в кэше.
 *
 * Нужен devtools, отладочным дампам и {@link stale}. Значение `undefined` означает
 * «ещё не считалось» и неотличимо от честного `undefined` — это цена холодного
 * чтения, других способов заглянуть в граф без побочек нет.
 */
export function probe<R>(fn: () => R): R | undefined {
  const prev = setWarm(false)
  try {
    return fn()
  } finally {
    setWarm(prev)
  }
}

/**
 * Отдать **своё** прошлое значение, если чтение приостановилось.
 *
 * Вызывать следует изнутри файбера: возвращается предыдущий результат того файбера,
 * который сейчас пересчитывается. Работает это ровно потому, что `stale` вызывается
 * в середине пересчёта, когда `put()` ещё не затёр кэш новым содержимым.
 *
 * Прошлого значения приостановившейся **зависимости** здесь взять неоткуда: её кэш
 * уже занят промисом ожидания. Хранить последнее удачное значение отдельным полем
 * значило бы удерживать его в памяти у каждого узла — плата, которую без спроса
 * брать не станем.
 *
 * @example
 * ```ts
 * const rows = atom(function rows() {
 *   // пока грузится новая страница, список остаётся прежним, а не мигает пустотой
 *   return stale(() => sync(loadPage, page())) ?? []
 * })
 * ```
 */
export function stale<R>(fn: () => R): R | undefined {
  try {
    return fn()
  } catch (error) {
    if (!isSuspend(error)) throw error

    const sub = getActiveSub()
    if (sub === undefined || sub.kind !== KIND_FIBER) return undefined

    const previous = (sub as Fiber<R>).peek()
    if (previous instanceof Error || isSuspend(previous)) return undefined
    return previous as R | undefined
  }
}

/**
 * Выполнить ожидания параллельно, а не одно за другим.
 *
 * Внутри файбера `a(); b();` — это **последовательные** ожидания: первый вызов
 * бросит промис, и до второго дело дойдёт только на следующем прогоне. Ловушка
 * встроена в модель и по умолчанию бьёт по задержкам, поэтому независимые загрузки
 * надо оборачивать явно.
 *
 * @example
 * ```ts
 * const [user, posts] = race(() => sync(loadUser), () => sync(loadPosts))
 * ```
 */
export function race<const Tasks extends readonly (() => unknown)[]>(
  ...tasks: Tasks
): { -readonly [K in keyof Tasks]: ReturnType<Tasks[K]> } {
  const results: unknown[] = []
  const pending: Promise<unknown>[] = []
  let failure: unknown
  let failed = false

  for (const task of tasks) {
    try {
      results.push(task())
    } catch (error) {
      results.push(undefined)
      if (isSuspend(error)) pending.push(error)
      else if (!failed) {
        failure = error
        failed = true
      }
    }
  }

  // Ошибку придержим: если что-то ещё грузится, на следующем прогоне она возникнет
  // снова — а вот приостановку откладывать нельзя, иначе потеряем параллельность.
  if (pending.length === 1) throw pending[0]
  if (pending.length > 1) throw Promise.race(pending)
  if (failed) throw failure

  return results as { -readonly [K in keyof Tasks]: ReturnType<Tasks[K]> }
}

/** Прочитать, не подписываясь. Значение берётся свежим, но зависимость не заводится. */
export function untracked<R>(fn: () => R): R {
  const prev = setActiveSub(undefined)
  try {
    return fn()
  } finally {
    setActiveSub(prev)
  }
}

/**
 * Запретить сборку текущего узла: он останется жив, даже когда его перестанут читать.
 *
 * Нужен корням — узлам, которые держат ленд, сокет или подписку. Вызывать следует из
 * тела атома; внутри {@link act} смысла не имеет, потому что одноразовая задача и так
 * живёт ровно один прогон.
 */
export function pin(): void {
  const sub = getActiveSub()
  if (sub === undefined) return
  sub.pinned = true
}

/**
 * Выйти из мира файберов в мир промисов.
 *
 * Обратная сторона {@link sync}: тот превращает промис в значение внутри файбера,
 * этот превращает файберное вычисление в промис для внешнего кода. Приостановки
 * внутри `fn` обрабатываются прозрачно — промис разрешится, когда вычисление
 * действительно досчитается.
 */
export function async<R>(fn: () => R): Promise<Awaited<R>> {
  return new Promise<Awaited<R>>((resolve, reject) => {
    let settled = false

    const finish = (ok: boolean, value: unknown): void => {
      if (settled) return
      settled = true
      // Останавливаем наблюдателя в микрозадаче: сейчас мы внутри его же прогона,
      // и уничтожать узел изнутри его собственного пересчёта нельзя.
      queueMicrotask(() => {
        stop()
        if (ok) resolve(value as Awaited<R>)
        else reject(value)
      })
    }

    const stop = watchEffect(() => {
      try {
        finish(true, fn())
      } catch (error) {
        // Приостановку отдаём наблюдателю: он запомнит её и перезапустится сам,
        // когда промис разрешится.
        if (isSuspend(error)) throw error
        finish(false, error)
      }
    })
  })
}

/** Достучаться до файбера за каналом — для devtools и отладки. */
export function fiberOf(channel: { readonly fiber?: Fiber }): Fiber | undefined {
  return channel.fiber
}
