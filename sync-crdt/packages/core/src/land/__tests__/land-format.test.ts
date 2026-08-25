import { describe, expect, test } from 'vitest'
import { Link } from '../../binary/link'
import { packEncode, packPart } from '../../binary/pack'
import {
  type AnyUnit,
  GiftUnit,
  PassUnit,
  SandUnit,
  SealUnit,
  shotKey,
} from '../../binary/unit'
import { fixedClock } from '../clock'
import { Land } from '../land'
import { ROOT } from '../view'

/**
 * Гейт формата: переживает ли ленд то, ради чего ADR-016 выбрал байты.
 *
 * Дифференциальная сверка с `Replica` этот класс свойств не видит В ПРИНЦИПЕ: у
 * `Sand` нет ни `tag`, ни `big`, ни `shot`, ни `kind` — то есть оракул слеп ровно
 * к тем полям, потерей которых обосновывался отказ от объектов. Поэтому предмет
 * сверки здесь — БАЙТЫ и виды юнитов, а не значения.
 */

function peerOf(...bytes: number[]): Link {
  const bin = new Uint8Array(8)
  for (let i = 0; i < bytes.length && i < 8; i++) bin[i] = bytes[i] as number
  return Link.peer(bin)
}

function makeLand(peer = 0x11): Land {
  return new Land(peerOf(peer), fixedClock(1000))
}

const LAND_ID = Link.land(peerOf(0x11), new Uint8Array(8))
const OTHER_LAND = Link.land(peerOf(0x99), new Uint8Array(8).fill(1))

function idOf(tail: number): Link {
  return Link.pawn(Link.hole, new Uint8Array([0, 0, 0, 0, 0, tail]))
}

function same(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, at) => byte === right[at])
}

/** Набор, в котором есть все четыре подсказки `tag` и обе формы значения. */
function motley(land: Land): void {
  const first = land.post(ROOT, ROOT, { имя: 'док' }, 'keys')
  const second = land.post(ROOT, first.self, [1, 2, 3], 'vals')
  const third = land.post(ROOT, second.self, 'x'.repeat(40), 'solo')
  land.post(ROOT, third.self, new Uint8Array([7, 7, 7]))
  land.remove(second.self)
}

describe('the format outlives the land', () => {
  test('units() returns THE SAME bytes that arrived: the apply path', () => {
    const from = makeLand(0x11)
    motley(from)
    const input = from.units()

    const to = makeLand(0x22)
    to.apply(input)
    const out = to.units()

    expect(out).toHaveLength(input.length)
    for (let i = 0; i < out.length; i++) {
      expect(same((input[i] as AnyUnit).bin, (out[i] as AnyUnit).bin)).toBe(true)
    }
  })

  test('the packEncode → packDecode → adopt → units → packEncode round trip yields the same bytes', () => {
    const from = makeLand(0x11)
    motley(from)

    const bin = packEncode([[LAND_ID, packPart({ units: from.units() })]])
    const to = makeLand(0x22)
    expect(to.adopt(bin)).toBe(from.units().length)

    const again = packEncode([[LAND_ID, packPart({ units: to.units() })]])
    expect(same(bin, again)).toBe(true)
  })

  test('big sand: kind, tag, size and shot survive receipt byte for byte', () => {
    const value = { long: 'я'.repeat(150) }
    const { unit: big, ball } = SandUnit.makeAuto({
      peer: peerOf(0x22),
      time: 1200,
      tick: 0,
      self: idOf(7),
      head: Link.hole,
      lead: Link.hole,
      tag: 'keys',
      value,
    })
    expect(ball).not.toBeNull()

    const land = makeLand()
    expect(land.apply([big], new Map([[shotKey(big.shot()), ball as Uint8Array]]))).toBe(1)

    const out = land.units()[0] as SandUnit
    expect(same(out.bin, big.bin)).toBe(true)
    expect(out.big()).toBe(true)
    expect(out.size()).toBe((ball as Uint8Array).length)
    expect(out.tag()).toBe('keys')
    expect([...out.shot()]).toEqual([...big.shot()])
    // Вид тоже знает вид значения, не разбирая его: `dead` и `tag` читаются из
    // байт, и большой санд не выпадает ни из раскладки, ни из выдачи.
    const node = land.nodeOf(new Uint8Array([0, 0, 0, 0, 0, 7]))
    expect(land.peek(node)?.tag).toBe('keys')
    // А значение читается — оно лежит в том же слоте арены, что и юнит.
    expect(land.peek(node)?.value).toEqual(value)
  })

  test('a land with a big sand rebuilds its pack — ball included', () => {
    // Дыра, записанная в docs/11: `units()` отдаёт юниты, но не выносные
    // значения, и `packEncode` на таком наборе падал с «ball не приложен». Пачку
    // собирает `part()`, потому что байты значения лежат В АРЕНЕ рядом с юнитом.
    const from = makeLand(0x11)
    from.post(ROOT, ROOT, 'коротко')
    from.post(ROOT, ROOT, 'я'.repeat(200))
    from.post(ROOT, ROOT, 42)

    const bin = packEncode([[LAND_ID, from.part()]])
    const to = makeLand(0x22)
    expect(to.adopt(bin)).toBe(3)
    expect(to.order(ROOT).map(view => view.value).sort()).toEqual(
      from.order(ROOT).map(view => view.value).sort(),
    )

    // И круг замыкается побайтово: принятый ленд отдаёт ту же пачку.
    expect(same(bin, packEncode([[LAND_ID, to.part()]]))).toBe(true)
  })

  test('a move preserves the tag of the moved node and of its successor', () => {
    // Регресс: `move` пересобирал оба юнита из ЗНАЧЕНИЯ и терял подсказку —
    // словарь после перемещения объявлялся атомом (`keys` → `term`). Ровно эту
    // потерю ADR-016 вменил ленду на обычных объектах.
    const land = makeLand()
    const first = land.post(ROOT, ROOT, { a: 1 }, 'keys')
    const second = land.post(ROOT, first.self, [1], 'vals')
    const third = land.post(ROOT, second.self, 'три', 'solo')

    expect(land.move(first.self, third.self)).toBe(true)
    expect(land.order(ROOT).map(view => view.tag)).toEqual(['vals', 'solo', 'keys'])
    expect(land.order(ROOT).map(view => view.value)).toEqual([[1], 'три', { a: 1 }])
  })

  test('a tombstone preserves tag: the subtree outlives its parent', () => {
    const land = makeLand()
    const view = land.post(ROOT, ROOT, { a: 1 }, 'keys')
    land.post(view.self, ROOT, 'ребёнок')

    expect(land.remove(view.self)).toBe(true)
    expect(land.peek(view.self)?.tag).toBe('keys')
    expect(land.peek(view.self)?.dead).toBe(true)
    expect(land.order(view.self).map(kid => kid.value)).toEqual(['ребёнок'])
  })

  test('a unit declaring itself the root is rejected', () => {
    // Шесть нулевых байт в `self` — законные байты формата, и по проводу такой
    // юнит доедет. Приняв его, ленд делает КОРЕНЬ своим же ребёнком: рекурсивный
    // обход слоя моделей уходит в бесконечность, а сходимость молчит — реплики
    // зацикливаются согласованно.
    const land = makeLand(0x11)
    land.post(ROOT, ROOT, 'обычный')

    const evil = SandUnit.make({
      peer: peerOf(0x22),
      time: 2000,
      tick: 0,
      self: Link.hole,
      head: Link.hole,
      lead: Link.hole,
      value: 'я корень',
    })
    expect(land.apply([evil])).toBe(0)
    expect(land.order(ROOT).map(view => view.self)).not.toContain(ROOT)
    expect(land.size()).toBe(1)
  })

  test('a unit declaring itself its own parent is rejected', () => {
    const land = makeLand(0x11)
    const self = idOf(5)
    const loop = SandUnit.make({
      peer: peerOf(0x22),
      time: 2000,
      tick: 0,
      self,
      head: self,
      lead: Link.hole,
      value: 'сам себе родитель',
    })

    expect(land.apply([loop])).toBe(0)
    const node = land.nodeOf(new Uint8Array([0, 0, 0, 0, 0, 5]))
    expect(land.order(node)).toHaveLength(0)
  })

  test('size counts units of all peers, including LWW losers', () => {
    const clock = fixedClock(1000)
    const a = new Land(peerOf(0x11), clock)
    const b = new Land(peerOf(0x22), clock)
    const c = new Land(peerOf(0x33), clock)

    const seed = a.post(ROOT, ROOT, 'семя')
    b.apply(a.units())
    c.apply(a.units())

    // Три пира правят ОДИН узел, каждый у себя: две версии обязаны остаться
    // проигравшими, но храниться — на них обопрутся `diff`/`summ` из S7.
    a.write(ROOT, ROOT, seed.self, 'от а')
    b.write(ROOT, ROOT, b.nodeOf(a.idOf(seed.self)), 'от б')
    c.write(ROOT, ROOT, c.nodeOf(a.idOf(seed.self)), 'от в')

    const all = new Land(peerOf(0x44), clock)
    all.apply(a.units())
    all.apply(b.units())
    all.apply(c.units())

    expect(all.size()).toBe(3)
    expect(all.count()).toBe(1)
    expect(all.units()).toHaveLength(3)
    expect(all.order(ROOT)).toHaveLength(1)
    // Счётчик и выдача обязаны сходиться: `summ` из S7 шлёт первое, досылает второе.
    expect(all.units().length).toBe(all.size())
  })
})

describe('what the land does NOT do (recorded holes, not concessions)', () => {
  /**
   * ЗАКРЫТО на S6-подписях: `gift`/`seal`/`pass` теперь хранятся спутником
   * графа (`#extra`) и едут в `units`/`part`, поэтому реплика-транзит (в том
   * числе сервер-релей) пересылает права и подписи дальше. Санды — по-прежнему
   * в графе, спутники — плоским набором рядом.
   */
  test('a round trip through the land preserves all four unit kinds', () => {
    const units: AnyUnit[] = [
      SandUnit.make({
        peer: peerOf(0x11), time: 1200, tick: 0,
        self: idOf(1), head: Link.hole, lead: Link.hole, value: 'данные',
      }),
      GiftUnit.make({ peer: peerOf(0x11), time: 1200, tick: 1, mate: Link.hole, tier: 3, rate: 0 }),
      SealUnit.make({
        peer: peerOf(0x11), time: 1200, tick: 2,
        hashes: [new Uint8Array(12).fill(7)], sign: new Uint8Array(64).fill(3),
      }),
      PassUnit.make({ peer: peerOf(0x11), time: 1200, tick: 3, algo: 'ed25519', key: new Uint8Array(32).fill(5) }),
    ]

    const bin = packEncode([[LAND_ID, packPart({ units })]])
    const land = makeLand(0x22)
    land.adopt(bin)

    expect(land.units().map(unit => unit.kind())).toEqual(['sand', 'gift', 'seal', 'pass'])
  })

  /**
   * `adopt` берёт буфер пачки целиком и вываливает в ОДИН ленд юниты ВСЕХ
   * лендов пачки: `packDecode` отдаёт список `[LandId, PackPart]`, а ленд
   * перебирает его, отбросив идентификатор. Своего `LandId` у ленда нет вовсе,
   * поэтому отфильтровать чужое он не может даже теоретически.
   */
  test.fails('adopt takes only its own land units from a pack', () => {
    const mine = SandUnit.make({
      peer: peerOf(0x11), time: 1200, tick: 0,
      self: idOf(1), head: Link.hole, lead: Link.hole, value: 'мой',
    })
    const alien = SandUnit.make({
      peer: peerOf(0x99), time: 1200, tick: 0,
      self: idOf(2), head: Link.hole, lead: Link.hole, value: 'из чужого ленда',
    })

    const bin = packEncode([
      [LAND_ID, packPart({ units: [mine] })],
      [OTHER_LAND, packPart({ units: [alien] })],
    ])

    const land = makeLand(0x11)
    land.adopt(bin)
    expect(land.size()).toBe(1)
  })

  /**
   * Санд с выносным значением ленд принимает и раскладывает, но переписать
   * элемент рядом с ним не может: `move` пересобирает последователя из
   * РАЗОБРАННОГО значения, а у большого санда оно лежит в `ball` (S5). Один
   * элемент длиннее 62 байт делает список неперемещаемым целиком.
   */
  test.fails('move works in a list that contains a big sand', () => {
    const land = makeLand(0x11)
    const first = land.post(ROOT, ROOT, 'первый')
    const big = SandUnit.makeBig({
      peer: peerOf(0x22), time: 2000, tick: 0,
      self: idOf(77), head: Link.hole,
      lead: Link.pawn(Link.hole, land.idOf(first.self)),
      size: 300, shot: new Uint8Array(12).fill(4),
    })
    land.apply([big])
    const third = land.post(ROOT, land.nodeOf(new Uint8Array([0, 0, 0, 0, 0, 77])), 'третий')

    expect(land.move(first.self, third.self)).toBe(true)
  })

  /**
   * Ленд, принявший большой санд, не может пересобрать собственную пачку:
   * `ball` он не хранит (при `adopt` байты балла физически лежат в его арене, но
   * ключа к ним нет), а `packEncode` без балла отказывается кодировать.
   */
  test.fails('a land with a big sand can rebuild its pack', () => {
    const shot = new Uint8Array(12).fill(9)
    const ball = new Uint8Array(300).fill(1)
    const big = SandUnit.makeBig({
      peer: peerOf(0x22), time: 1200, tick: 0,
      self: idOf(7), head: Link.hole, lead: Link.hole, size: 300, shot,
    })

    const bin = packEncode([[LAND_ID, packPart({ units: [big], balls: new Map([[shotKey(shot), ball]]) })]])
    const land = makeLand(0x33)
    land.adopt(bin)

    packEncode([[LAND_ID, packPart({ units: land.units() })]])
  })
})
