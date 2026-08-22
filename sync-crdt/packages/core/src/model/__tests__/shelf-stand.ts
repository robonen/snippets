// Стенд для тестов коллекций: два ленда, доставка ЧЕРЕЗ БАЙТЫ и счётчик юнитов.
//
// ─── Почему доставка идёт через `packEncode`/`packDecode` ────────────────────
//
// docs/05 §8.1, и это не деталь оформления. В baza `units_steal` кладёт ТЕ ЖЕ
// JS-объекты юнитов в чужой индекс, а глобальный `trusted` помечает всё локально
// созданное доверенным навсегда — поэтому весь корпус из 27 сценариев слияния
// проверяет алгоритм на разделяемых объектах и не проверяет ни кодек, ни
// идентичность после десериализации (реестр, п. 39). Здесь каждый merge-кейс
// обязан пройти круг «в байты и обратно» и заново собранные юниты.
//
// ─── Почему счётчик юнитов, а не глаза ──────────────────────────────────────
//
// «Поменял один элемент — родился один юнит» — требование DoD стадии, и
// проверить его глазами нельзя: лишний юнит виден только в логе и только тому,
// кто его ищет. `born()` считает разницу `land.size()`, то есть ВСЕ юниты,
// включая проигравших по LWW, — именно они и растут при неверной реконсиляции.

import { flush } from '@sync/fiber'
import { Link } from '../../binary/link'
import { packEncode, packPart, type LandId } from '../../binary/pack'
import type { Vary } from '../../binary/vary'
import { type FixedClock, fixedClock } from '../../land/clock'
import { Land } from '../../land/land'
import { ROOT } from '../../land/view'
import { createSpace, type Head, type Issue, type Space } from '../index'

/** Соль ленда одна на стенд: контентные адреса обязаны совпасть у обеих реплик. */
export const SALT = new Uint8Array([7, 11, 13])

export function peerOf(byte: number): Link {
  const bin = new Uint8Array(8)
  bin[0] = byte
  return Link.peer(bin)
}

export interface Stand {
  readonly land: Land
  readonly space: Space
  readonly id: LandId
  readonly clock: FixedClock
  readonly issues: Issue[]
}

export function stand(peer = 0x11, start = 1000): Stand {
  const clock = fixedClock(start)
  const land = new Land(peerOf(peer), clock)
  const issues: Issue[] = []
  const id = Link.land(peerOf(peer), new Uint8Array(8))
  const space = createSpace({ land, id, salt: SALT, report: issue => issues.push(issue) })
  return { land, space, id, clock, issues }
}

/** Односторонняя доставка: всё, что есть у `from`, уезжает к `to` байтами. */
export function deliver(to: Stand, from: Stand): void {
  const units = from.land.units()
  if (units.length === 0) return
  to.land.adopt(packEncode([[from.id, packPart({ units })]]))
  flush()
}

/** Двусторонняя синхронизация до сходимости. */
export function sync(left: Stand, right: Stand): void {
  deliver(left, right)
  deliver(right, left)
}

/**
 * Сколько ЮНИТОВ родила операция.
 *
 * Считаются записи, а не рост `land.size()`. Разница существенна и чуть не
 * увела замер в сторону: `size()` считает СЛОТЫ `(голова, пир, self)`, поэтому
 * перезапись собственной прежней версии узла его не увеличивает — а
 * реконсиляция как раз перезаписывает узел тем же `self` (в этом вся её суть), и
 * «поменял один элемент» показывало бы ноль независимо от того, родился юнит или
 * десять. По проводу же уезжает именно запись.
 *
 * Перехват вешается на экземпляр: `write` — единственная точка записи ленда, и
 * `remove`/`move` идут через неё же.
 */
export function born(at: Stand, act: () => void): number {
  const land = at.land as unknown as Record<'write', (...args: never[]) => unknown>
  const original = land.write.bind(at.land) as (...args: never[]) => unknown
  let count = 0
  land.write = (...args: never[]): unknown => {
    count += 1
    return original(...args)
  }
  try {
    act()
    flush()
  } finally {
    delete (land as unknown as Record<string, unknown>).write
  }
  return count
}

/** Голова под отдельный документ — номер узла, а не строка (ADR-016). */
export function headAt(at: Stand, id: number): Head {
  return at.land.nodeAt(id)
}

/** Свежий чужой `self` на каждый подлог: два мусорных юнита не должны слипнуться. */
let forged = 0x50_0000

/**
 * Положить под голову значение от ЧУЖОГО пира.
 *
 * Номера узлов через ленды не переносятся: номер — плотный локальный
 * идентификатор (ADR-016), и у двух лендов один юнит получает разные номера.
 * Перевод идёт через 48-битный id формата — ровно так же, как это делает приём
 * пачки.
 */
export function tamper(at: Stand, head: Head, value: Vary, peer = 0x99, when = 5000): void {
  const other = stand(peer, when)
  forged += 1
  other.land.write(other.land.nodeOf(at.land.idOf(head)), ROOT, other.land.nodeAt(forged), value, 'term')
  deliver(at, other)
}
