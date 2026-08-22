// Регрессия: раскладка ленда обязана не зависеть от порядка доставки.
//
// `order.ts` (S3) держит для этого арбитра по `self` и объясняет его прямо в
// коде: «нужен он не для них, а чтобы порядок раскладки ВООБЩЕ не зависел от
// порядка перебора входного массива. Стабильная сортировка на ничьих сохранила
// бы порядок поступления, и две реплики с одним набором юнитов прочитали бы
// разное». При переезде на байты (ADR-016) арбитр потерялся: `Graph.#cmp`
// сводился к `cmpAt`, а тот отдаёт ноль на совпавших `(time, peer, tick)`.
//
// До правки три брата с одной меткой читались как `v3 v2 v1`, `v1 v2 v3` и
// `v1 v3 v2` — по три разных ответа на один и тот же набор юнитов.
import { describe, expect, test } from 'vitest'
import { writeU16, writeU32 } from '../../binary/bytes'
import { Link } from '../../binary/link'
import { SAND_AT, SandUnit, UNIT_AT } from '../../binary/unit'
import { type Vary, varyEncode } from '../../binary/vary'
import { fixedClock } from '../clock'
import { Land } from '../land'
import { order } from '../order'
import type { Sand } from '../sand'
import { ROOT, putId48 } from '../view'

const PEER = 0x11

/**
 * Юнит собирается БАЙТАМИ, минуя `Land.write`: метку задаёт `Stamp`, и через
 * запись такой вход не получить вовсе — а он и есть предмет проверки.
 */
function sandOf(self: number, head: number, lead: number, value: Vary, tick = 0): SandUnit {
  const payload = varyEncode(value)
  const bin = new Uint8Array(SandUnit.lengthOf(payload.length))
  bin[UNIT_AT.kind] = 1
  bin[UNIT_AT.meta] = payload.length
  writeU32(bin, UNIT_AT.time, 1000)
  writeU16(bin, UNIT_AT.tick, tick)
  bin[UNIT_AT.peer] = PEER
  putId48(bin, SAND_AT.self, self)
  putId48(bin, SAND_AT.head, head)
  putId48(bin, SAND_AT.lead, lead)
  bin.set(payload, SAND_AT.payload)
  return SandUnit.wrap(bin)
}

function peerOf(tag: number): Link {
  const bin = new Uint8Array(8)
  bin[0] = tag
  return Link.peer(bin)
}

/** Те же юниты в обычных объектах — для S3-оракула `order()`. */
function sand(self: number, lead: number, value: string): Sand {
  return {
    self: `n${self}`,
    head: '',
    lead: lead === 0 ? '' : `n${lead}`,
    peer: '1100000000000000',
    time: 1000,
    tick: 0,
    value,
  }
}

function readIn(units: readonly SandUnit[]): string[] {
  const land = new Land(peerOf(0x99), fixedClock(1000))
  // По одному вызову на юнит: доставка приходит порциями, и порядок порций —
  // ровно то, от чего результат не имеет права зависеть.
  for (const unit of units) land.apply([unit])
  return land.order(ROOT).map(view => String(view.value))
}

describe('раскладка не зависит от порядка доставки', () => {
  test('братья с совпавшей меткой читаются одинаково при любой очерёдности', () => {
    const u1 = sandOf(1, 0, 0, 'v1')
    const u2 = sandOf(2, 0, 0, 'v2')
    const u3 = sandOf(3, 0, 0, 'v3')

    const straight = readIn([u1, u2, u3])
    expect(readIn([u3, u2, u1])).toEqual(straight)
    expect(readIn([u2, u3, u1])).toEqual(straight)
    expect(readIn([u3, u1, u2])).toEqual(straight)

    // И ответ тот же, что у слоя S3 на тех же юнитах: арбитр по `self` — порт
    // `rank()`, а не новое правило.
    const sands = [sand(1, 0, 'v1'), sand(2, 0, 'v2'), sand(3, 0, 'v3')]
    expect(straight).toEqual(order(sands, '').map(item => String(item.value)))
  })

  test('сироты (недоехавший lead) с совпавшей меткой тоже ложатся детерминированно', () => {
    // `lead` указывает на юнит, которого в наборе нет: такие уходят в хвост
    // через `#strays`, и там сортировка та же самая.
    const u1 = sandOf(1, 0, 900, 'v1')
    const u2 = sandOf(2, 0, 901, 'v2')
    const u3 = sandOf(3, 0, 902, 'v3')

    const straight = readIn([u1, u2, u3])
    expect(straight).toHaveLength(3)
    expect(readIn([u3, u2, u1])).toEqual(straight)
    expect(readIn([u2, u1, u3])).toEqual(straight)
  })

  test('обычный вход не задет: метки различны — арбитр по self не включается', () => {
    const a = sandOf(1, 0, 0, 'a', 1)
    const b = sandOf(2, 0, 1, 'b', 2)
    const c = sandOf(3, 0, 2, 'c', 3)

    // Цепочка: `tick ↓` делает `c` самым свежим, но порядок чтения задаёт `lead`.
    expect(readIn([a, b, c])).toEqual(['a', 'b', 'c'])
    expect(readIn([c, b, a])).toEqual(['a', 'b', 'c'])
  })
})
