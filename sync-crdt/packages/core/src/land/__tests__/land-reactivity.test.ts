import { computed, flush, watchEffect } from '@sync/fiber'
import { describe, expect, test } from 'vitest'
import { Link } from '../../binary/link'
import { packEncode, packPart } from '../../binary/pack'
import { SandUnit } from '../../binary/unit'
import { fixedClock } from '../clock'
import { Land } from '../land'
import { ROOT, type LocalId } from '../view'

/**
 * Гейт по линзе «реактивность и утечки»: что ленд будит, чего не будит и что
 * после себя оставляет.
 *
 * Отдельным файлом от `land.test.ts` потому, что предмет здесь другой — не
 * значение выдачи, а ЧИСЛО ПЕРЕСЧЁТОВ и число заведённых объектов. Такой тест
 * падает не тем же способом: выдача остаётся правильной, а цена — нет, и глазами
 * на неё не посмотришь.
 */

function peerOf(...bytes: number[]): Link {
  const bin = new Uint8Array(8)
  for (let i = 0; i < bytes.length && i < 8; i++) bin[i] = bytes[i] as number
  return Link.peer(bin)
}

function makeLand(peer = 0x11): Land {
  return new Land(peerOf(peer), fixedClock(1000))
}

/** Цепочка из `count` вставок под корнем. Возвращает номера узлов по порядку. */
function chain(land: Land, count: number): LocalId[] {
  const nodes: LocalId[] = []
  let lead = ROOT
  for (let i = 0; i < count; i++) {
    const view = land.post(ROOT, lead, i)
    nodes.push(view.self)
    lead = view.self
  }
  return nodes
}

describe('поузловая гранулярность под нагрузкой', () => {
  test('правка одного узла из 10 000 пересчитывает ровно один канал значения', () => {
    const land = makeLand(0x11)
    const nodes = chain(land, 10_000)

    let nodeRuns = 0
    const channels = nodes.map(node => computed(() => {
      nodeRuns += 1
      return land.read(node)
    }))
    // Читатель порядка присутствует НАМЕРЕННО: без него проверка не отличает
    // «сигнал на узел» от «сигнала нет вовсе».
    let orderRuns = 0
    const orderCh = computed(() => {
      orderRuns += 1
      return land.nodes(ROOT).length
    })
    for (const channel of channels) channel()
    orderCh()
    nodeRuns = 0
    orderRuns = 0

    // Правка ТОЛЬКО значения: `lead` сохраняется прежним, состав детей не меняется.
    const target = nodes[5000] as LocalId
    const back = land.peek(target)!.lead
    const other = new Land(peerOf(0x22), fixedClock(2000))
    other.apply(land.units())
    const edit = other.write(
      ROOT,
      other.nodeOf(land.idOf(back)),
      other.nodeOf(land.idOf(target)),
      'правка',
    ).unit

    expect(land.apply([edit])).toBe(1)
    for (const channel of channels) channel()
    orderCh()

    expect(nodeRuns).toBe(1)
    expect(channels[5000]!()).toBe('правка')
    // Порядок не изменился, и файбер погасил его пересчёт: значение канала то же.
    expect(orderCh()).toBe(10_000)
  })

  test('заведомо проигравший юнит не будит ни узел, ни порядок — только size', () => {
    const land = makeLand(0x11)
    const seed = land.post(ROOT, ROOT, 'свежее')

    // Тот же узел от чужого пира, но на десять секунд раньше: LWW он проигрывает,
    // а в хранилище по своему пиру попадает — его считает `summ` из S7.
    const stale = SandUnit.make({
      peer: peerOf(0x22),
      time: seed.time - 10,
      tick: 0,
      self: Link.pawn(Link.hole, land.idOf(seed.self)),
      head: Link.hole,
      lead: Link.hole,
      value: 'протухшее',
    })

    let nodeRuns = 0
    let orderRuns = 0
    let sizeRuns = 0
    const nodeCh = computed(() => { nodeRuns += 1; return land.read(seed.self) })
    const orderCh = computed(() => { orderRuns += 1; return land.nodes(ROOT).length })
    const sizeCh = computed(() => { sizeRuns += 1; return land.size() })
    nodeCh(); orderCh(); sizeCh()
    nodeRuns = 0; orderRuns = 0; sizeRuns = 0

    expect(land.apply([stale])).toBe(1)
    nodeCh(); orderCh(); sizeCh()

    expect(nodeRuns).toBe(0)
    expect(orderRuns).toBe(0)
    expect(sizeRuns).toBe(1)
    expect(nodeCh()).toBe('свежее')
    expect(sizeCh()).toBe(2)
  })

  test('переезд узла к другой голове будит ОБЕ головы', () => {
    const a = makeLand(0x11)
    const first = a.post(ROOT, ROOT, 'первая')
    const second = a.post(ROOT, ROOT, 'вторая')
    const kid = a.post(first.self, ROOT, 'дитя')

    let firstRuns = 0
    let secondRuns = 0
    const firstKids = computed(() => { firstRuns += 1; return a.nodes(first.self).length })
    const secondKids = computed(() => { secondRuns += 1; return a.nodes(second.self).length })
    expect(firstKids()).toBe(1)
    expect(secondKids()).toBe(0)
    firstRuns = 0; secondRuns = 0

    // Чужой ленд переподвешивает узел под другую голову: `Replica` так не делает,
    // но собеседник не обязан вести себя как она.
    const b = new Land(peerOf(0x22), fixedClock(2000))
    b.apply(a.units())
    b.write(b.nodeOf(a.idOf(second.self)), ROOT, b.nodeOf(a.idOf(kid.self)), 'дитя')
    a.apply(b.units())

    expect(firstKids()).toBe(0)
    expect(secondKids()).toBe(1)
    expect(firstRuns).toBe(1)
    expect(secondRuns).toBe(1)
  })

  test('правка ЗНАЧЕНИЯ конкурента меняет порядок — потому сигнал головы и бьётся на любой смене победителя', () => {
    // Сторож самого решения, а не поведения. Соблазн «бить сигнал головы только
    // при смене состава» разбивается об это: два юнита конкурируют за одну
    // позицию, и порядок между ними решает их СОБСТВЕННАЯ метка. Правка значения
    // приносит новую метку — и порядок переворачивается, не тронув состав.
    const clock = fixedClock(1000)
    const a = new Land(peerOf(0x11), clock)
    const b = new Land(peerOf(0x22), clock)
    a.post(ROOT, ROOT, 'от а')
    const rival = b.post(ROOT, ROOT, 'от б')

    const all = new Land(peerOf(0x33), clock)
    all.apply(a.units())
    all.apply(b.units())
    expect(all.order(ROOT).map(view => view.value)).toEqual(['от а', 'от б'])
    const before = [...all.nodes(ROOT)]

    const later = new Land(peerOf(0x22), fixedClock(9000))
    later.apply(b.units())
    later.write(ROOT, ROOT, later.nodeOf(b.idOf(rival.self)), 'от б, правка')
    all.apply(later.units())

    expect(all.order(ROOT).map(view => view.value)).toEqual(['от б, правка', 'от а'])
    expect([...all.nodes(ROOT)]).not.toEqual(before)
  })

  test('остановленный наблюдатель отпускает сигнал ленда на том же flush', () => {
    const land = makeLand(0x11)
    const view = land.post(ROOT, ROOT, 'раз')

    let innerRuns = 0
    const inner = computed(() => { innerRuns += 1; return land.read(view.self) })
    const stop = watchEffect(() => { inner() })
    expect(innerRuns).toBe(1)

    stop()
    flush()

    // Канал собран: ни зависимостей (отписался от сигнала ленда), ни подписчиков.
    expect(inner.node.disposed).toBe(true)
    expect(inner.node.deps).toBeUndefined()
    expect(inner.node.subs).toBeUndefined()

    land.write(ROOT, ROOT, view.self, 'два')
    flush()
    expect(innerRuns).toBe(1)
  })
})

describe('ленивость не ломается записью', () => {
  test('move не заводит видов на детей головы', () => {
    // Регрессия: `move` брал раскладку ВИДАМИ, и один вызов на голове из 10 000
    // детей поднимал `views()` с 0 до 10 000 — те самые +194 Б/юнит, ради отказа
    // от которых источником истины и сделаны байты (ADR-016).
    const from = makeLand(0x11)
    const ids = chain(from, 1000)

    const to = makeLand(0x22)
    to.apply(from.units())
    expect(to.views()).toBe(0)

    const head = to.nodeOf(from.idOf(ids[0] as LocalId))
    const tail = to.nodeOf(from.idOf(ids[900] as LocalId))
    expect(to.move(head, tail)).toBe(true)
    expect(to.views()).toBe(0)

    // И сам перенос при этом сделан правильно.
    const order = to.order(ROOT).map(view => view.value)
    expect(order[899]).toBe(900)
    expect(order[900]).toBe(0)
    expect(order).toHaveLength(1000)
  })

  test('remove и units не заводят видов', () => {
    const from = makeLand(0x11)
    const ids = chain(from, 100)
    const to = makeLand(0x22)
    to.apply(from.units())

    // Надгробие лежит в СВОЁМ слоте `(head, 0x22, self)`, а версия автора
    // остаётся в своём: юнитов становится 101, живых узлов — 99.
    expect(to.remove(to.nodeOf(from.idOf(ids[10] as LocalId)))).toBe(true)
    expect(to.units()).toHaveLength(101)
    expect(to.size()).toBe(101)
    expect(to.count()).toBe(99)
    expect(to.views()).toBe(0)
  })

  test('кэш видов не растёт на перекрытиях', () => {
    const land = makeLand(0x11)
    const view = land.post(ROOT, ROOT, 'раз')
    expect(land.read(view.self)).toBe('раз')
    expect(land.views()).toBe(1)

    for (let i = 0; i < 500; i++) {
      land.write(ROOT, ROOT, view.self, `значение ${i}`)
      land.read(view.self)
    }
    expect(land.views()).toBe(1)
    expect(land.read(view.self)).toBe('значение 499')
  })

  test('nodes() отдаёт порядок, не материализуя видов; order() материализует', () => {
    const from = makeLand(0x11)
    chain(from, 100)
    const to = makeLand(0x22)
    to.apply(from.units())

    expect(to.size()).toBe(100)
    expect(to.count()).toBe(100)
    expect(to.nodes(ROOT)).toHaveLength(100)
    expect(to.views()).toBe(0)

    expect(to.order(ROOT)).toHaveLength(100)
    expect(to.views()).toBe(100)
  })
})

describe('adopt не удерживает того, что не пригодилось', () => {
  test('пачка, из которой не взят ни один юнит, отпускается целиком', () => {
    // Регрессия: `adopt` регистрировал буфер главами ДО того, как выяснится,
    // пригодился ли хоть один юнит. Повторная доставка известной пачки — штатный
    // исход досылки, и каждая стоила +56 КБ навсегда (замер: 200 доставок →
    // arrayBuffers 0.7 → 11.6 МБ при неизменном `size()`).
    const from = makeLand(0x11)
    chain(from, 500)
    const owner = Link.land(peerOf(0x11), new Uint8Array(8))
    const units = from.units()
    const pack = (): Uint8Array => packEncode([[owner, packPart({ units })]])

    const to = makeLand(0x22)
    const first = pack()
    expect(to.adopt(first)).toBe(500)
    expect(to.held()).toBe(first.byteLength)

    for (let i = 0; i < 20; i++) expect(to.adopt(pack())).toBe(0)

    // Удерживается ровно первая пачка — та, на юниты которой смотрят ссылки.
    expect(to.held()).toBe(first.byteLength)
    expect(to.size()).toBe(500)
    expect(to.order(ROOT)).toHaveLength(500)
  })

  test('пачка с одним новым юнитом удерживается — это заявленная плата за отказ от копии', () => {
    const from = makeLand(0x11)
    chain(from, 100)
    const owner = Link.land(peerOf(0x11), new Uint8Array(8))

    const to = makeLand(0x22)
    const full = packEncode([[owner, packPart({ units: from.units() })]])
    expect(to.adopt(full)).toBe(100)

    const extra = from.post(ROOT, ROOT, 'ещё один')
    const again = packEncode([[owner, packPart({ units: from.units() })]])
    expect(to.adopt(again)).toBe(1)
    expect(to.held()).toBe(full.byteLength + again.byteLength)
    expect(to.read(to.nodeOf(from.idOf(extra.self)))).toBe('ещё один')
  })
})
