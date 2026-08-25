import { isSuspend, watchEffect } from '@sync/fiber'
import { Link, type AnyModel, type Doc, type Head, type ModelName, type Space } from '@sync/core'
import {
  computed,
  getCurrentScope,
  inject,
  onScopeDispose,
  provide,
  shallowRef,
  triggerRef,
  type InjectionKey,
  type ShallowRef,
  type WritableComputedRef,
} from 'vue'

/**
 * Состояние моста: данные, ожидание и ошибка по отдельности.
 *
 * Разделено намеренно. Приостановка — не ошибка и не пустое значение: пока файбер
 * ждёт, `data` держит прошлое значение, а `pending` говорит, что идёт загрузка.
 * Схлопывать это в `T | undefined` значило бы терять различие между «ещё не знаем»
 * и «знаем, что ничего нет».
 */
export interface SyncState<T> {
  readonly data: Readonly<ShallowRef<T | undefined>>
  readonly pending: Readonly<ShallowRef<boolean>>
  readonly error: Readonly<ShallowRef<unknown>>
}

export interface SyncHandle<T> extends SyncState<T> {
  stop: () => void
}

/**
 * Пробросить чтение из графа файберов в реактивность Vue, вернув ручку остановки.
 *
 * Графы у нас и у Vue разные и остаются разными: мост односторонний — Vue читает
 * нас. Писать в модель из компонента следует обычным вызовом канала.
 *
 * Приостановка наружу не выпускается: пока ждём, `data` не трогаем, поднимаем
 * `pending`, а когда промис разрешится, наблюдатель перезапустится сам.
 */
export function createSync<T>(read: () => T): SyncHandle<T> {
  const data = shallowRef<T>()
  const pending = shallowRef(false)
  const error = shallowRef<unknown>()

  const stop = watchEffect(() => {
    try {
      const next = read()
      if (pending.value) pending.value = false
      if (error.value !== undefined) error.value = undefined
      data.value = next
      // Значение могло не измениться по ссылке, хотя структура внутри изменилась —
      // будим читателей явно.
      triggerRef(data)
    } catch (caught) {
      if (isSuspend(caught)) {
        pending.value = true
        // Отдаём приостановку наблюдателю: он её запомнит и перезапустится,
        // когда промис разрешится.
        throw caught
      }
      pending.value = false
      error.value = caught
    }
  })

  return { data, pending, error, stop }
}

/**
 * То же, что {@link createSync}, но остановка привязана к скоупу компонента.
 *
 * @example
 * ```ts
 * const { data: title, pending } = useSync(() => post.title())
 * ```
 */
export function useSync<T>(read: () => T): SyncState<T> {
  const handle = createSync(read)
  // Вне скоупа (тесты, бенчмарки) остановка остаётся на вызывающем.
  if (getCurrentScope() !== undefined) onScopeDispose(handle.stop)
  return handle
}

/** Короткая форма {@link useSync}, когда ожидание и ошибка не нужны. */
export function useValue<T>(read: () => T): Readonly<ShallowRef<T | undefined>> {
  return useSync(read).data
}

// ── Пространство и документы (docs/05 §1.8) ──────────────────────────────────

/**
 * Ключ инъекции пространства. Символьный `InjectionKey`, а не строка: два
 * экземпляра пакета в одном приложении обязаны столкнуться громко, на типах,
 * а не молча передать друг другу чужое пространство.
 */
const SPACE: InjectionKey<Space> = Symbol('sync.space')

/**
 * Отдать пространство дереву компонентов.
 *
 * Сборка самого пространства — четыре строки и НЕ работа моста: ленд, хранилище
 * и канал вкладок собираются один раз на приложение, и мост не вправе прятать
 * от приложения ни `randomSession()` (ADR-017), ни выбор хранилища.
 *
 * @example
 * ```ts
 * const land = new Land(peer, clock, { session: randomSession() })
 * const vault = openVault({ store: idbStore(), id, land })
 * const tabs = syncTabs({ land, id })
 * provideSpace(createSpace({ land, id, ready: vault.ready }))
 * ```
 */
export function provideSpace(space: Space): void {
  provide(SPACE, space)
}

/**
 * То же, что {@link provideSpace}, но на уровне приложения — для `main.ts`,
 * где ещё нет setup-контекста: `installSpace(app, space)` перед `mount`.
 */
export function installSpace(
  app: { provide(key: InjectionKey<Space>, value: Space): unknown },
  space: Space,
): void {
  app.provide(SPACE, space)
}

/** Пространство из контекста. Бросает, если {@link provideSpace} не был вызван выше. */
export function useSpace(): Space {
  const space = inject(SPACE)
  if (space === undefined) {
    throw new Error('space not provided: call provideSpace(space) in an ancestor')
  }
  return space
}

/**
 * Документ по адресу — или корневой, если адрес не передан.
 *
 * НЕ реактивные данные, а тот же самый хендл, что даёт `space.doc()`:
 * мемоизированный, `===`-стабильный, безопасный для проброса пропом. Вид
 * документа один во всём приложении намеренно — реактивным чтение делает
 * `useValue`/`useSync` вокруг него, а не тип документа (docs/05 §1.8: два
 * одинаковых по типу документа с разным поведением — класс ошибок, который
 * компилируется и не ловится тестами).
 *
 * Адрес строкой — удобство для маршрутов (`useDoc(Post, props.id)`): это текст
 * ссылки, он разбирается `Link.parse`.
 */
export function useDoc<N extends ModelName>(
  model: AnyModel<N> | N,
  at?: Link | Head | string,
  space?: Space,
): Doc<N> {
  const host = space ?? useSpace()
  if (at === undefined) return host.root(model)
  return host.doc(model, typeof at === 'string' ? Link.parse(at) : at)
}

/**
 * Канал как `WritableComputedRef` — для `v-model` и `defineModel`.
 *
 * Чтение идёт через мост (файбер под капотом, приостановка не протекает),
 * запись — прямым вызовом канала: мост односторонний, и запись из `v-model`
 * это обычная запись из обработчика, просто сделанная за вас.
 *
 * Пока значение едет (гидрация), геттер отдаёт `undefined` — как и `useValue`.
 * Тип это честно показывает: `undefined` здесь не «не бывает», а «ещё не
 * приехало», и input с `v-model` в этот момент пуст, что правдиво.
 */
export function useModel<T>(channel: { (): T; (next: T): T }): WritableComputedRef<T | undefined> {
  const { data } = useSync(() => channel())
  return computed({
    get: () => data.value,
    set: (next) => {
      // `undefined` в канал не пишется: у каналов один сентинел (docs/05 Р6),
      // и `v-model`, откатившийся в undefined, не должен превращаться в запись.
      if (next !== undefined) channel(next)
    },
  })
}
