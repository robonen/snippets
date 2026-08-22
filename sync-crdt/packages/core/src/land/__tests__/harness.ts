import { resolveNaive } from '../order-naive'
import { Replica, type Clock } from '../replica'
import { ROOT, type Sand } from '../sand'

/**
 * Мультипировый харнесс: несколько реплик в одном процессе, доставка руками
 * ([docs/10 §1](../../../../../docs/10-testing.md#1-харнесс)).
 *
 * Никакой сети и асинхронности — дельта это просто массив юнитов, поэтому тест
 * полностью детерминирован и воспроизводится по сиду `fast-check`.
 */

/** Реплика с именем `p1`, `p2`, … — имя же служит арбитром LWW при равном времени. */
export function makeReplica(peer: string, clock: Clock): Replica {
  return new Replica(peer, clock)
}

/**
 * `count` реплик на общих часах.
 *
 * Общие часы — не упрощение, а самый злой случай: все правки попадают в одну
 * секунду и разводятся исключительно арбитром по `peer`.
 */
export function makeReplicas(count: number, clock: Clock): readonly Replica[] {
  const out: Replica[] = []
  for (let i = 0; i < count; i++) out.push(makeReplica(`p${i + 1}`, clock))
  return out
}

/**
 * Односторонняя доставка всей известной `from` дельты. Возвращает число юнитов,
 * реально изменивших состояние `to`: ноль — это условие остановки `converge`.
 */
export function deliver(from: Replica, to: Replica): number {
  return to.applySands(from.sands())
}

/** Сколько раундов «каждый каждому» терпим, прежде чем считать это зацикливанием. */
const ROUNDS_MAX = 32

/**
 * Доставка всех всем до неподвижной точки.
 *
 * Точка обязана существовать: приём монотонен по решётке LWW, а множество
 * юнитов конечно. Если предел исчерпан — сломан не тест, а `applySands`, поэтому
 * ошибка несёт размеры индексов, а не просто текст.
 */
export function converge(...replicas: readonly Replica[]): void {
  for (let round = 0; round < ROUNDS_MAX; round++) {
    let moved = 0

    for (const from of replicas) {
      for (const to of replicas) {
        if (from === to) continue
        moved += deliver(from, to)
      }
    }

    if (moved === 0) return
  }

  const sizes = replicas.map(r => `${r.peer}=${r.sands().length}`).join(', ')
  throw new Error(`Реплики не сошлись за ${ROUNDS_MAX} раундов: ${sizes}`)
}

/** Наблюдаемое состояние — то, что сравнивают property-тесты. */
export function readAll(replica: Replica, head: string = ROOT): unknown[] {
  return replica.read(head)
}

/**
 * Все юниты, которые вообще существовали, включая перекрытые.
 *
 * Нужно ровно одному свойству — tombstone: чтобы проверить, что старый юнит не
 * воскрешает удалённое, этот старый юнит надо иметь на руках.
 */
export function allHistory(...replicas: readonly Replica[]): readonly Sand[] {
  const out: Sand[] = []
  for (const replica of replicas) out.push(...replica.history())
  return out
}

/** Объединение того, что реплики знают сейчас (без перекрытых версий). */
export function allSands(...replicas: readonly Replica[]): readonly Sand[] {
  const out: Sand[] = []
  for (const replica of replicas) out.push(...replica.sands())
  return out
}

/**
 * Живые по LWW элементы независимо от достижимости по цепочке `lead`.
 *
 * Разница с `order()` — и есть предмет свойства reachability: LWW говорит
 * «элемент жив», а обход от корня может его не найти.
 */
export function aliveByLww(sands: readonly Sand[], head: string = ROOT): readonly Sand[] {
  return [...resolveNaive(sands, head).values()].filter(sand => sand.value !== null)
}

/** Операция над списком в терминах позиций — так их задаёт пользователь, а не CRDT. */
export type Op =
  | { readonly kind: 'insert', readonly at: number, readonly value: unknown }
  | { readonly kind: 'remove', readonly at: number }
  | { readonly kind: 'move', readonly at: number, readonly to: number }

/** `lead` для вставки на позицию `at`: нулевая позиция — начало списка. */
function leadAt(items: readonly Sand[], at: number): string {
  if (at <= 0) return ROOT
  return items[at - 1]!.self
}

/**
 * Перевод позиционной операции в юниты. Позиции берутся по модулю длины, чтобы
 * генератор не тратил прогоны на заведомо пустые шаги.
 *
 * Возвращает `false`, когда операция оказалась пустой (нечего удалять, некуда
 * двигать) — это нормальный исход, а не ошибка.
 */
export function applyOp(replica: Replica, op: Op, head: string = ROOT): boolean {
  const items = replica.order(head)

  if (op.kind === 'insert') {
    const at = items.length === 0 ? 0 : op.at % (items.length + 1)
    replica.insert(leadAt(items, at), op.value, head)
    return true
  }

  if (items.length === 0) return false

  if (op.kind === 'remove') {
    const target = items[op.at % items.length]!
    return replica.remove(target.self, head)
  }

  const target = items[op.at % items.length]!
  const to = op.to % (items.length + 1)
  return replica.move(target.self, leadAt(items, to), head)
}

/**
 * Детерминированная перестановка по внешним ключам.
 *
 * Свой Фишер–Йетс, а не сортировка по ключу: сортировка стабильна и при
 * повторах ключей оставила бы исходный порядок — то есть не перемешала бы
 * ровно там, где перемешать важнее всего.
 */
export function shuffle<T>(items: readonly T[], keys: readonly number[]): T[] {
  const out = [...items]

  for (let i = out.length - 1; i > 0; i--) {
    const key = keys[i % Math.max(keys.length, 1)] ?? 0
    const j = key % (i + 1)
    const tmp = out[i]!
    out[i] = out[j]!
    out[j] = tmp
  }

  return out
}
