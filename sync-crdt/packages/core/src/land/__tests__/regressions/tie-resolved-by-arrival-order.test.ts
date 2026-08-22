import { expect, test } from 'vitest'
import { Link } from '../../../binary/link'
import { SandUnit } from '../../../binary/unit'
import { fixedClock } from '../../clock'
import { Land } from '../../land'
import { ROOT } from '../../view'

/**
 * Регрессия: **при совпавшей метке побеждал пришедший первым**.
 *
 * `cmpAt` сравнивает только `(time, peer, tick)`. Когда все три совпали, приём
 * отвечал «не перекрывает» и оставлял того, кто уже лежал в слоте. Для повторной
 * доставки одного и того же юнита это верно и необходимо — иначе цикл
 * синхронизации никогда не встанет. Но байты при совпавшей метке бывают и
 * РАЗНЫМИ: один пир записал в ту же секунду и тот же тик два разных значения.
 *
 * Тогда исход зависел от ПОРЯДКА ДОСТАВКИ: реплика, получившая сначала X,
 * оставалась с X, получившая сначала Y — с Y, и обе считали себя сошедшимися.
 * Хуже того, цикл «применять, пока `apply` не вернёт 0» вставал на первом же
 * круге: расхождение выглядело как достигнутая неподвижная точка.
 *
 * Такой вход — не выдумка. Ровно так ведут себя две вкладки одного пира
 * (ADR-006 против ADR-007: пир общий, счётчик `self` и метка живут в памяти
 * ленда), и так же выглядит недобросовестный пир.
 *
 * Лечение — арбитр последней инстанции по БАЙТАМ, тот же канон, что у `peer` в
 * ADR-015: побеждает лексикографически меньший юнит.
 */

function peerBytes(fill: number): Uint8Array {
  return new Uint8Array(8).fill(fill)
}

function idBytes(n: number): Uint8Array {
  const out = new Uint8Array(6)
  out[5] = n
  return out
}

/** Два юнита в ОДНОМ слоте `(head, peer, self)` с одинаковой меткой и разными значениями. */
function twins(): readonly [SandUnit, SandUnit] {
  const stamp = { peer: Link.peer(peerBytes(0x11)), time: 1000, tick: 0 }
  const place = { self: Link.pawn(Link.hole, idBytes(7)), head: Link.hole, lead: Link.hole }
  return [
    SandUnit.make({ ...stamp, ...place, value: 'X' }),
    SandUnit.make({ ...stamp, ...place, value: 'Y' }),
  ]
}

function landWith(order: readonly SandUnit[]): Land {
  const land = new Land(Link.peer(peerBytes(0x22)), fixedClock(2000))
  land.apply(order)
  return land
}

test('исход не зависит от порядка доставки', () => {
  const [x, y] = twins()

  const first = landWith([x, y]).order(ROOT).map((view) => view.value)
  const second = landWith([y, x]).order(ROOT).map((view) => view.value)

  expect(first).toEqual(second)
  // И это именно выбор, а не слияние: слот один, победитель обязан быть один.
  expect(first).toHaveLength(1)
})

test('арбитраж идёт по байтам, а не по значению', () => {
  const [x, y] = twins()
  // Побеждает лексикографически меньший юнит. Значения 'X' и 'Y' отличаются
  // ровно одним байтом полезной нагрузки, поэтому порядок юнитов повторяет
  // порядок значений — но решают именно байты юнита целиком.
  const winner = landWith([y, x]).order(ROOT)[0]?.value
  expect(winner).toBe('X')
})

test('повторная доставка того же юнита изменением не считается', () => {
  const [x] = twins()
  const land = landWith([x])
  // Без этого цикл синхронизации не встанет никогда: он останавливается по
  // `apply(...) === 0`.
  expect(land.apply([x])).toBe(0)
  expect(land.apply([x])).toBe(0)
})
