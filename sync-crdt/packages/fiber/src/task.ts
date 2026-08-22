// v8:hot
import { EMPTY_ARGS, Fiber, fiberId, peekNextDep, type FiberTask } from './fiber'
import { KIND_FIBER, getActiveSub, type Node } from './graph'

function sameArgs(prev: readonly unknown[], next: readonly unknown[]): boolean {
  if (prev.length !== next.length) return false
  for (let i = 0; i < prev.length; i++) {
    if (!Object.is(prev[i], next[i])) return false
  }
  return true
}

/** Диагностика расхождений при перезапуске. Выключается в проде через сборку. */
export let onTaskMismatch: ((info: { sub: string; found: string; wanted: string }) => void) | null =
  null

export function setTaskMismatchHandler(handler: typeof onTaskMismatch): void {
  onTaskMismatch = handler
}

/**
 * Найти или создать одноразовую задачу на текущей позиции списка зависимостей.
 *
 * Позиция — и есть идентичность. Файбер перезапускается на каждой приостановке, и
 * если код дошёл до той же точки с той же функцией, тем же хостом и теми же
 * аргументами, значит это тот же самый эффект — его результат берётся готовым, а тело
 * повторно не выполняется. Так побочные эффекты переживают перезапуски.
 *
 * Отсюда дисциплина, обязательная для вызывающего кода: **функция должна быть
 * стабильной ссылкой**. `act(() => …)` внутри тела задачи создаёт новую стрелку на
 * каждом прогоне, совпадения не будет, и эффект выполнится заново.
 */
export function getTask<H, A extends readonly unknown[], R>(
  host: H,
  fn: (this: H, ...args: A) => R,
  args: A,
): Fiber<R> {
  const sub = getActiveSub()

  if (sub !== undefined) {
    const candidate = peekNextDep(sub)?.dep as Node | undefined
    if (candidate !== undefined && candidate.kind === KIND_FIBER) {
      const found = candidate as Fiber<R>
      if (found.temp) {
        if (
          (found.task as unknown) === (fn as unknown) &&
          Object.is(found.host, host) &&
          sameArgs(found.args, args)
        ) {
          return found
        }
        if (onTaskMismatch !== null) {
          onTaskMismatch({
            sub: (sub as Fiber).id,
            found: found.id,
            wanted: fiberId(host, fn, true),
          })
        }
      }
    }
  }

  return new Fiber<R>(fn as FiberTask, host, args, true)
}

/**
 * Обернуть эффект так, чтобы он выполнился ровно один раз на прогон родителя.
 *
 * Возвращает стабильную обёртку — её и надо сохранить в переменную, а не создавать
 * заново на каждом вызове.
 *
 * @example
 * ```ts
 * const persist = act((value: string) => db.write(value))
 * // …внутри файбера:
 * persist(text)
 * ```
 */
export function act<H, A extends unknown[], R>(
  fn: (this: H, ...args: A) => R,
): (this: H, ...args: A) => Awaited<R> {
  return function actWrapper(this: H, ...args: A): Awaited<R> {
    return getTask(this, fn, args).read() as Awaited<R>
  }
}

/**
 * Дождаться асинхронного результата внутри файбера, оставаясь синхронным снаружи.
 *
 * Приостанавливает вызывающий файбер до разрешения промиса. Функция должна быть
 * стабильной ссылкой — см. {@link getTask}.
 */
export function sync<A extends unknown[], R>(fn: (...args: A) => R, ...args: A): Awaited<R> {
  // unsafe: у свободной функции нет `this`; хост фиксируем как undefined.
  const task = getTask<undefined, A, R>(undefined, fn as (this: undefined, ...rest: A) => R, args)
  return task.read() as Awaited<R>
}

export { EMPTY_ARGS }
