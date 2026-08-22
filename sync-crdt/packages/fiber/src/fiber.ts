// v8:hot — самый горячий файл пакета
import { equals } from './equals'
import {
  Flags,
  KIND_FIBER,
  State,
  currentCycle,
  checkDirty,
  coldBits,
  getActiveSub,
  isWarm,
  link,
  nextCycle,
  setActiveSub,
  shallowPropagate,
  unlink,
  wake,
  type Link,
  type Node,
} from './graph'

export type Suspend = Promise<unknown>
export type FiberCache<R> = R | Error | Suspend | undefined

/** Приостановка ли это. Промис, брошенный из файбера, — не ошибка, а запрос подождать. */
export function isSuspend(value: unknown): value is Suspend {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { then?: unknown }).then === 'function'
  )
}

/** Обёртка → исходный промис. Нужен, чтобы не оборачивать один источник дважды. */
const sourceOf = new WeakMap<Suspend, Suspend>()

let suspendTraces = false

/**
 * Подменять ли стек у промиса приостановки на стек места ожидания.
 *
 * Без подмены отладка приостановок мучительна: настоящий стек обрывается на границе
 * промиса. Но `new Error()` захватывает кадры стека немедленно, и на горячем пути это
 * оказалось дороже всего остального вместе взятого — замер показал 13 мкс из 14.7 мкс
 * полного круга приостановки. Поэтому по умолчанию выключено, а devtools и dev-сборка
 * включают явно.
 */
export function setSuspendTraces(enabled: boolean): void {
  suspendTraces = enabled
}
const EMPTY_ARGS: readonly unknown[] = Object.freeze([])

/**
 * Тело файбера в том виде, в каком его хранит ядро.
 *
 * Хост и аргументы для машинерии графа непрозрачны: их типы нужны только публичным
 * обёрткам (`solo`, `act`, `sync`), которые приводят типы на границе. Держать их
 * параметрами класса пришлось бы ценой инвариантности по `this`, из-за которой
 * `Fiber<H, A, R>` перестаёт быть подтипом `Fiber` и любая внутренняя функция,
 * принимающая произвольный файбер, начинает требовать приведений.
 */
export type FiberTask = (...args: never[]) => unknown

/**
 * Узел графа, умеющий приостанавливаться.
 *
 * **Один класс на две роли.** Атом (долгоживущий кэш) и задача (одноразовый эффект)
 * различаются полем-тегом `temp`, а не подклассом. Причина не в экономии кода: у
 * подкласса другой прототип, значит другой скрытый класс, значит каждое обращение к
 * `cache` на общем пути (`checkDirty`, `flush`, `complete`) видело бы две формы вместо
 * одной. Это прямое следствие правила «один шейп на узел графа» из PRINCIPLES.md и
 * расхождение с `$mol_wire`, где атом и задача — разные классы.
 *
 * Поля `done` и `pinned` осмыслены только для одной из ролей, но объявлены на общем
 * классе: два лишних байта на узел дешевле полиморфного доступа на горячем пути.
 */
export class Fiber<R = unknown> implements Node {
  readonly kind = KIND_FIBER

  // ReactiveNode — порядок объявления фиксирован и не должен меняться
  deps: Link | undefined
  depsTail: Link | undefined
  subs: Link | undefined
  subsTail: Link | undefined
  flags: number

  readonly host: unknown
  readonly task: FiberTask
  readonly args: readonly unknown[]
  cache: FiberCache<R>
  /** true — одноразовая задача, false — долгоживущий атом. */
  readonly temp: boolean
  /** Задача досчиталась и больше никогда не изменится. */
  done: boolean
  /** Защита от сборки: узел жив, даже когда на него никто не смотрит. */
  pinned: boolean
  disposed: boolean

  constructor(task: FiberTask, host: unknown, args: readonly unknown[], temp: boolean) {
    this.deps = undefined
    this.depsTail = undefined
    this.subs = undefined
    this.subsTail = undefined
    this.flags = Flags.None
    this.host = host
    this.task = task
    this.args = args
    this.cache = undefined
    this.temp = temp
    this.done = false
    this.pinned = false
    this.disposed = false
  }

  /**
   * Прочитать значение. Подписывает текущего активного подписчика.
   *
   * Бросает: закэшированную ошибку — как ошибку; закэшированный промис — как запрос
   * приостановки (его поймает `update()` родительского файбера).
   */
  read(): R {
    // Самый частый путь — одним сравнением. Равенство `Mutable` означает сразу:
    // значение посчитано, не грязное, не сомневающееся, не ошибка, не приостановка,
    // режим тёплый. Всё это лежит в одном битфилде, поэтому и проверяется разом.
    if ((this.flags | coldBits()) === Flags.Mutable) {
      const sub = getActiveSub()
      if (sub !== undefined) link(this, sub, currentCycle())
      return this.cache as R
    }
    return this.readSlow()
  }

  /** Всё, что не «значение готово и его можно отдать». */
  private readSlow(): R {
    // Узел читают, пока он сам считается: без этой проверки alien-signals не
    // зациклится, но и не сообщит — вернёт недосчитанное значение молча, что хуже.
    if ((this.flags & Flags.RecursedCheck) !== 0) {
      throw new Error(`Circular subscription: ${this.id}`)
    }

    // Холодный режим (`probe`): ни счёта, ни подписки — только то, что уже есть.
    if (!isWarm()) return this.result() as R

    // Подписываемся ДО пересчёта, а не после (в отличие от `computedOper` из
    // alien-signals). Иначе одноразовая задача, которая досчиталась синхронно, в
    // момент `put()` видит `subs === undefined`, считает себя никому не нужной и
    // уничтожает себя — а связь с родителем создаётся строкой ниже, уже на трупе.
    // `$mol_wire_fiber.sync()` по той же причине зовёт `promote()` перед `fresh()`.
    const sub = getActiveSub()
    if (sub !== undefined) link(this, sub, currentCycle())

    const flags = this.flags

    if (
      (flags & Flags.Dirty) !== 0 ||
      ((flags & Flags.Pending) !== 0 && this.deps !== undefined && checkDirty(this.deps, this))
    ) {
      if (this.update()) {
        const subs = this.subs
        if (subs !== undefined) shallowPropagate(subs)
      }
    } else if ((flags & Flags.Pending) !== 0) {
      this.flags = flags & ~Flags.Pending
    } else if ((flags & Flags.Mutable) === 0) {
      // Ещё ни разу не считался. Проверяем по Mutable, а не по `flags === None`:
      // у наблюдателя с рождения выставлен Watching, и сравнение с нулём его пропустит.
      this.update()
    }

    // Один тест по битам вместо двух проверок самого значения: см. `State`.
    if ((this.flags & State.Mask) !== 0) return this.deliverSlow()
    return this.cache as R
  }

  /** Кэш содержит не значение: ошибку перебрасываем, приостановку — тоже. */
  private deliverSlow(): never {
    throw this.cache
  }

  /**
   * Человекочитаемое имя для логов, devtools и подменённого стека приостановки.
   *
   * Считается по требованию, а не в конструкторе: сборка строки занимала 52 %
   * времени создания узла (20 нс из 38), а нужна она в отладочных путях, то есть
   * почти никогда.
   */
  get id(): string {
    return fiberId(this.host, this.task, this.temp)
  }

  /** Прочитать без подписки и без пересчёта — только то, что уже лежит в кэше. */
  peek(): FiberCache<R> {
    return this.cache
  }

  /** Готовое значение, если оно есть. Ошибка и приостановка дают `undefined`. */
  result(): R | undefined {
    return (this.flags & State.Mask) === 0 ? (this.cache as R) : undefined
  }


  /**
   * Пересчитать. Возвращает `true`, если значение изменилось, — этого требует
   * контракт `createReactiveSystem`.
   */
  update(): boolean {
    const prevSub = setActiveSub(this)
    this.depsTail = undefined
    // Watching сохраняем: его выставляет watch() один раз при рождении.
    this.flags = (this.flags & Flags.Watching) | Flags.Mutable | Flags.RecursedCheck
    nextCycle()

    let next: FiberCache<R>
    let suspended = false
    let failed = false

    try {
      const result = Reflect.apply(this.task, this.host, this.args) as R
      if (isSuspend(result)) {
        next = this.wrap(result, false)
        suspended = true
      } else {
        next = result
      }
    } catch (error) {
      if (isSuspend(error)) {
        next = this.wrap(error, true)
        suspended = true
      } else {
        next = error instanceof Error ? error : new Error(String(error), { cause: error })
        failed = true
      }
    } finally {
      setActiveSub(prevSub)
      this.flags &= ~Flags.RecursedCheck

      // ⬅ Ключевая строка всего рантайма (эксперимент E1).
      // При приостановке хвост зависимостей НЕ обрезается: следующий прогон запросит
      // те же зависимости в том же порядке, и `link()` переиспользует существующие
      // рёбра без единой аллокации. Обрезать означало бы отписаться от всего и
      // переподписаться заново на каждом шаге ожидания.
      if (!suspended) purgeDeps(this)
    }

    return this.put(next, suspended ? State.Suspend : failed ? State.Error : State.Value)
  }

  /** Пересчитать, если требуется. Точка входа планировщика для корневых наблюдателей. */
  refresh(): void {
    const flags = this.flags
    if (
      (flags & Flags.Dirty) !== 0 ||
      ((flags & Flags.Pending) !== 0 && this.deps !== undefined && checkDirty(this.deps, this))
    ) {
      this.update()
    } else if ((flags & Flags.Pending) !== 0) {
      this.flags = flags & ~Flags.Pending
    } else if ((flags & Flags.Mutable) === 0) {
      this.update()
    }
  }

  /**
   * Положить результат. `true` — подписчиков надо будить.
   *
   * Промис в кэше подписчиков не будит: значение ещё не готово, а те, кто уже читал,
   * и так получат тот же промис при следующем чтении.
   */
  put(next: FiberCache<R>, state: number): boolean {
    const prev = this.cache
    this.cache = next
    this.flags = (this.flags & ~State.Mask) | state

    if (state === State.Suspend) {
      // Переход «значение → ожидание» — тоже изменение, и подписчикам о нём надо
      // знать: иначе мост в UI не сможет показать загрузку, а `checkDirty` решит,
      // что пересчитывать нечего. Сходимость обеспечена тем, что обёртка промиса
      // дедуплицируется пофайберно: со второго перезапуска `prev === next`.
      return prev !== next
    }

    if (this.temp) {
      this.done = true
      // Задача без подписчиков бесполезна: её результат некому забрать.
      if (this.subs === undefined) this.dispose()
      return prev !== next
    }

    // Структурное сравнение, а не по ссылке: пересчёт, давший равное значение,
    // не должен будить подписчиков — иначе любая пересборка массива поднимает
    // всё дерево над узлом.
    //
    // Примитивы отсеиваются до вызова: структурно сравнивать имеет смысл только
    // объекты, а пересчёты, возвращающие число или строку, — самый частый случай.
    if (prev === next || (typeof next === 'object' && next !== null && equals(prev, next))) {
      this.complete()
      return false
    }

    this.complete()
    return true
  }

  /**
   * Коммит подграфа: когда ни одна зависимость больше не висит в промисе,
   * временные задачи можно уничтожить — их результаты уже вобраны в наше значение.
   *
   * Порт `complete_pubs()` из `$mol_wire_atom`. Без этого задачи копятся до тех пор,
   * пока жив родитель.
   */
  complete(): void {
    let dep = this.deps
    if (dep === undefined) return

    while (dep !== undefined) {
      const node = dep.dep as Node
      if (node.kind === KIND_FIBER && (node.flags & State.Suspend) !== 0) return
      dep = dep.nextDep
    }

    // Сначала собираем, потом уничтожаем: dispose() правит тот самый список,
    // по которому мы идём.
    const doomed: Fiber[] = []
    dep = this.deps
    while (dep !== undefined) {
      const node = dep.dep as Node
      if (node.kind === KIND_FIBER && (node as Fiber).temp) doomed.push(node as Fiber)
      dep = dep.nextDep
    }
    for (const task of doomed) task.dispose()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true

    let dep = this.deps
    while (dep !== undefined) dep = unlink(dep, this)

    let sub = this.subs
    while (sub !== undefined) {
      const next = sub.nextSub
      unlink(sub)
      sub = next
    }

    this.flags = Flags.None

    // Досчитавшая задача уносит результат с собой: она уничтожает себя прямо
    // внутри `put()`, если подписчиков нет, — а вызывающий именно в этот момент
    // ждёт от `read()` значение. Обнулять кэш здесь значило бы отдавать наружу
    // `undefined` вместо результата (порт сценария `Sync execution` из `$mol`).
    // Для долгоживущих узлов ссылку по-прежнему отпускаем: там значение может
    // быть тяжёлым, а сам узел ещё жить в чьей-нибудь карте.
    if (!this.temp) this.cache = undefined
  }

  /**
   * Обернуть промис так, чтобы его разрешение вернуло файбер в работу.
   *
   * Три вещи разом: дедупликация через WeakMap (один промис не оборачивается дважды
   * при перезапусках), возврат в граф по разрешению и подмена `stack` — без последнего
   * отладка приостановок невозможна, потому что настоящий стек обрывается на границе
   * промиса.
   */
  private wrap(source: Suspend, thrown: boolean): Suspend {
    // Дедупликация именно ПОФАЙБЕРНАЯ. Глобальный WeakMap по исходному промису (как в
    // `$mol_wire_fiber`) выглядит экономнее, но ломается на втором файбере: он получит
    // чужую обёртку, чей обработчик замкнут на первый файбер, и повиснет навсегда —
    // особенно наглядно, если промис к этому моменту уже разрешён.
    const cached = this.cache
    if (isSuspend(cached) && sourceOf.get(cached) === source) return cached

    const onValue = (value: unknown): unknown => {
      if (this.cache === wrapped && !this.disposed) {
        if (thrown) this.reawake()
        else this.settle(value as R)
      }
      return value
    }
    const onError = (error: unknown): unknown => {
      if (this.cache === wrapped && !this.disposed) {
        if (thrown) this.reawake()
        else this.settle(error instanceof Error ? error : new Error(String(error), { cause: error }))
      }
      return error
    }

    const wrapped: Suspend = source.then(onValue, onError)

    if (suspendTraces) {
      const trace = new Error(`Suspend in ${this.id}`)
      Object.defineProperty(wrapped, 'stack', { get: () => trace.stack })
    }

    sourceOf.set(wrapped, source)
    return wrapped
  }

  /** Промис вернул значение: кладём его и будим подписчиков. */
  private settle(next: R | Error): void {
    const state = next instanceof Error ? State.Error : State.Value
    if (this.put(next, state) || this.temp) wake(this)
  }

  /**
   * Промис, который был *брошен*, разрешился: значения он не принёс, поэтому просто
   * помечаем файбер грязным — задача выполнится заново и на этот раз пройдёт дальше.
   */
  private reawake(): void {
    this.flags |= Flags.Dirty
    wake(this)
  }
}

/** Отписаться от зависимостей, которые в этом прогоне не были запрошены. */
export function purgeDeps(sub: Fiber): void {
  let dep = sub.depsTail !== undefined ? sub.depsTail.nextDep : sub.deps
  while (dep !== undefined) dep = unlink(dep, sub)
}

/** Зависимость, стоящая на текущей позиции трекинга. Основа переиспользования задач. */
export function peekNextDep(sub: Node): Link | undefined {
  return sub.depsTail !== undefined ? sub.depsTail.nextDep : sub.deps
}

/** Человекочитаемый идентификатор для логов, devtools и подменённых стеков. */
export function fiberId(host: unknown, task: { readonly name: string }, temp: boolean): string {
  const owner =
    host === undefined || host === null
      ? ''
      : `${(host as { constructor?: { name?: string } }).constructor?.name ?? 'obj'}.`
  const name = task.name === '' ? 'anonymous' : task.name
  return `${owner}${name}${temp ? '<#>' : '()'}`
}

export { EMPTY_ARGS }
