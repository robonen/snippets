import { expect, test } from 'vitest'
import { writeU16, writeU32 } from '../../../binary/bytes'
import { Link } from '../../../binary/link'
import { SAND_AT, SandUnit, UNIT_AT } from '../../../binary/unit'
import { varyEncode } from '../../../binary/vary'
import { fixedClock } from '../../clock'
import { Land } from '../../land'
import { Replica } from '../../replica'
import { ROOT, putId48 } from '../../view'

/**
 * Регрессия: **правка, сделанная ПОСЛЕ доставки чужого юнита, проигрывала ему
 * по арбитражу пира** — то есть ровно то, что `Stamp.next` обещает не допускать.
 *
 * Дыра была в `Stamp.hear`, а не в `next`. `hear` обновлял метку «последним
 * писал не мы» ТОЛЬКО под строго новый максимум `(time, tick)`. Чужой юнит с
 * меткой не больше уже записанной для часов исчезал целиком: следующая наша
 * запись оставалась в той же секунде, а в пределах секунды арбитром работает
 * `peer ↑` — и меньший по байтам чужой пир выигрывал у нашей причинно поздней
 * правки.
 *
 * Минимальный сценарий:
 *
 * ```
 * 1. мы (peer 0x01…) пишем в секунду 1000 → heard = (1000, 0), «писали мы»
 * 2. приезжает чужой юнит peer 0x00…, (1000, 0) — hear его ИГНОРИРУЕТ
 * 3. пользователь удаляет чужой элемент → надгробие (1000, 1)
 * 4. compare: time равно → peer: 0x00 < 0x01 → побеждает ЧУЖОЙ
 * ```
 *
 * Итог: `remove()` вернул `true`, а элемент остался виден — и остался бы виден
 * на всех репликах, потому что сходимость не нарушена. Свойство ломается другое:
 * причинность. Ни один тест на convergence этого не показывает, и оракул
 * `Replica` содержал ту же дыру, поэтому дифференциальная сверка молчала — обе
 * стороны сходились к одному неверному ответу.
 *
 * Починка: часы помнят СЕКУНДУ последней чужой записи (`Stamp.other`,
 * `Replica.otherTime`), а не «чей был максимум». Тест держит обе реализации.
 */

/** Пир из первого байта. Последний байт — единица: пустая ссылка означала бы `hole`. */
function peerOf(byte: number): Uint8Array {
  const bin = new Uint8Array(8)
  bin[0] = byte
  bin[7] = 1
  return bin
}

/** Юнит собирается байтами: чужую метку `(1000, 0)` через `Land.post` не выразить. */
function alienSand(): SandUnit {
  const payload = varyEncode('чужое')
  const bin = new Uint8Array(SandUnit.lengthOf(payload.length))
  bin[UNIT_AT.kind] = 1
  bin[UNIT_AT.meta] = payload.length
  writeU32(bin, UNIT_AT.time, 1000)
  writeU16(bin, UNIT_AT.tick, 0)
  bin.set(peerOf(0x00), UNIT_AT.peer)
  putId48(bin, SAND_AT.self, 0x777)
  putId48(bin, SAND_AT.head, 0)
  putId48(bin, SAND_AT.lead, 0)
  bin.set(payload, SAND_AT.payload)
  return SandUnit.wrap(bin)
}

test('боевой Land: удаление увиденного чужого элемента доходит', () => {
  const land = new Land(Link.peer(peerOf(0x01)), fixedClock(1000))
  land.post(ROOT, ROOT, 'моё')

  land.apply([alienSand()])
  expect(land.order(ROOT).map(view => view.value)).toEqual(['чужое', 'моё'])

  const node = land.nodeOf(new Uint8Array([0, 0, 0, 0, 0x07, 0x77]))
  expect(land.remove(node)).toBe(true)
  expect(land.order(ROOT).map(view => view.value)).toEqual(['моё'])
})

test('оракул Replica: та же правка и тот же исход', () => {
  const replica = new Replica('01000000000000ff', fixedClock(1000))
  replica.insert('', 'моё')

  replica.applySands([
    { self: 'X', head: '', lead: '', peer: '00000000000000ff', time: 1000, tick: 0, value: 'чужое' },
  ])
  expect(replica.read()).toEqual(['чужое', 'моё'])

  expect(replica.remove('X')).toBe(true)
  expect(replica.read()).toEqual(['моё'])
})
