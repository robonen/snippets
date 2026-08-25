import { computed } from '@sync/fiber'
import { describe, expect, test } from 'vitest'
import { Link } from '../../binary/link'
import { packEncode, packPart } from '../../binary/pack'
import { shotInto } from '../../binary/sha256'
import { GiftUnit, SAND_AT, SandUnit, shotKey } from '../../binary/unit'
import { varyEncode } from '../../binary/vary'
import { fixedClock } from '../clock'
import { Land } from '../land'
import { ROOT, id48, type LocalId } from '../view'

/**
 * Гейт корректности боевого `Land` — того, у которого источник истины байты
 * (ADR-016).
 *
 * Старый слой на объектах (`Replica`) не трогается: он остаётся оракулом
 * дифференциальной сверки, и его 68 тестов обязаны оставаться зелёными.
 * Сравнение с ним живёт отдельным файлом (`land-diff.prop.test.ts`), здесь —
 * свойства, которых у него нет вовсе: байты, ленивость, реактивность по узлу.
 */

/** Лорд из первых байт. Остальное — нули: ленду важны только сами байты. */
function peerOf(...bytes: number[]): Link {
  const bin = new Uint8Array(8)
  for (let i = 0; i < bytes.length && i < 8; i++) bin[i] = bytes[i] as number
  return Link.peer(bin)
}

function makeLand(peer = 0x11): Land {
  return new Land(peerOf(peer), fixedClock(1000))
}

/** Значения в порядке чтения — то, что сравнивают почти все проверки ниже. */
function values(land: Land, head: LocalId = ROOT): unknown[] {
  return land.order(head).map(view => view.value)
}

describe('байты — источник истины', () => {
  test('собранный лендом юнит побайтово совпадает с SandUnit.make', () => {
    // Ленд пишет байты сам, минуя `SandUnit.make`: четыре `Link` стоили бы
    // 147.9 нс каждая. Сторож нужен ровно потому, что знание формата оказалось
    // в двух местах — разъедутся они молча.
    const land = makeLand(0x37)
    const view = land.post(ROOT, ROOT, 'привет', 'vals')

    const twin = SandUnit.make({
      peer: peerOf(0x37),
      time: view.time,
      tick: view.tick,
      self: Link.pawn(Link.hole, land.idOf(view.self)),
      head: Link.hole,
      lead: Link.hole,
      tag: 'vals',
      value: 'привет',
    })

    expect([...view.unit.bin]).toEqual([...twin.bin])
  })

  test('вложенная запись кладёт head и lead теми же байтами', () => {
    const land = makeLand()
    const head = land.post(ROOT, ROOT, 'папка')
    const first = land.post(head.self, ROOT, 'первый')
    const second = land.post(head.self, first.self, 'второй')

    expect(second.head).toBe(head.self)
    expect(second.lead).toBe(first.self)
    // Те же шесть байт в поле `lead` второго и в поле `self` первого: номер узла
    // — внутренняя валюта, а на провод уезжает id формата.
    expect(id48(second.bin, second.at + SAND_AT.lead)).toBe(id48(first.bin, first.at + SAND_AT.self))
    expect(values(land, head.self)).toEqual(['первый', 'второй'])
  })

  test('tag доезжает до вида: без него S4 не отличит атом от списка', () => {
    const land = makeLand()
    expect(land.post(ROOT, ROOT, 1, 'keys').tag).toBe('keys')
    expect(land.post(ROOT, ROOT, 2).tag).toBe('term')
  })

  test('id узла переводится в шесть байт и обратно', () => {
    const land = makeLand()
    const view = land.post(ROOT, ROOT, 'x')
    expect(land.nodeOf(land.idOf(view.self))).toBe(view.self)
    expect(land.nodeOf(new Uint8Array(6))).toBe(ROOT)
  })
})

describe('порядок', () => {
  test('цепочка вставок читается по порядку', () => {
    const land = makeLand()
    let lead = ROOT
    for (const value of ['а', 'б', 'в']) lead = land.post(ROOT, lead, value).self
    expect(values(land)).toEqual(['а', 'б', 'в'])
  })

  test('вставка в начало кладётся перед прежним первым', () => {
    const land = makeLand()
    land.post(ROOT, ROOT, 'старый')
    land.post(ROOT, ROOT, 'новый')
    expect(values(land)).toEqual(['новый', 'старый'])
  })

  test('надгробие уходит из выдачи, но держит своё поддерево', () => {
    const land = makeLand()
    const first = land.post(ROOT, ROOT, 'первый')
    const second = land.post(ROOT, first.self, 'второй')
    land.post(ROOT, second.self, 'третий')

    expect(land.remove(second.self)).toBe(true)
    expect(values(land)).toEqual(['первый', 'третий'])
    // Повторное надгробие — не изменение: элемент уже мёртв.
    expect(land.remove(second.self)).toBe(false)
  })

  test('перемещение переподвешивает последователя, а не рвёт цепочку', () => {
    const land = makeLand()
    let lead = ROOT
    const items: LocalId[] = []
    for (const value of [1, 2, 3]) {
      const view = land.post(ROOT, lead, value)
      items.push(view.self)
      lead = view.self
    }

    expect(land.move(items[0] as LocalId, items[2] as LocalId)).toBe(true)
    expect(values(land)).toEqual([2, 3, 1])
  })

  test('юнит с недоехавшим lead не пропадает, а дописывается в хвост', () => {
    const from = makeLand(0x11)
    const first = from.post(ROOT, ROOT, 'первый')
    const second = from.post(ROOT, first.self, 'второй')

    const to = makeLand(0x22)
    // Доезжает только второй: его `lead` в этом ленде неизвестен.
    to.apply([second.unit])
    expect(values(to)).toEqual(['второй'])

    to.apply([first.unit])
    expect(values(to)).toEqual(['первый', 'второй'])
  })

  test('чтение пустой головы не аллоцирует и не падает', () => {
    const land = makeLand()
    expect(land.order(ROOT)).toEqual([])
    expect(land.order(ROOT)).toBe(land.order(ROOT))
  })
})

describe('арбитраж LWW определён на байтах (ADR-015)', () => {
  // Пиры выбраны так, что текст ссылки и байты дают ПРОТИВОПОЛОЖНЫЙ порядок:
  // base64url ставит цифры после букв, а `-`/`_` — до цифр.
  const early = peerOf(0xf4)
  const late = peerOf(0xf8)

  test('текстовая форма этих пиров действительно расходится с байтовой', () => {
    // Сторож самого контрпримера: если алфавит ссылки когда-нибудь поменяют,
    // тест ниже станет проверять пустоту, и об этом надо узнать здесь.
    expect(early.str < late.str).toBe(false)
    expect(early.bin[0]).toBeLessThan(late.bin[0] as number)
  })

  test('при равном времени побеждает меньший пир по байтам, а не по тексту', () => {
    // Юниты собираются руками, а не двумя лендами: правило причинности из
    // `Stamp.next` намеренно уводит вторую запись на секунду вперёд, и через
    // ленды арбитр по пиру просто не включился бы. Здесь проверяется он сам.
    const self = Link.pawn(Link.hole, new Uint8Array([0, 0, 0, 0, 0, 5]))
    const stamp = { time: 1200, tick: 0 }
    const fromEarly = SandUnit.make({ ...stamp, peer: early, self, head: Link.hole, lead: Link.hole, value: 'от f4' })
    const fromLate = SandUnit.make({ ...stamp, peer: late, self, head: Link.hole, lead: Link.hole, value: 'от f8' })

    const straight = makeLand(0x01)
    straight.apply([fromEarly, fromLate])

    const reversed = makeLand(0x01)
    reversed.apply([fromLate, fromEarly])

    // По байтам 0xf4 < 0xf8 — побеждает первый; по тексту вышло бы наоборот.
    expect(values(straight)).toEqual(['от f4'])
    expect(values(reversed)).toEqual(['от f4'])
    // Обе версии сохранены: проигравший по LWW нужен `diff` из S7.
    expect(straight.size()).toBe(2)
  })
})

describe('приём', () => {
  test('повторная доставка ничего не меняет', () => {
    const from = makeLand(0x11)
    from.post(ROOT, ROOT, 'раз')
    from.post(ROOT, ROOT, 'два')

    const to = makeLand(0x22)
    expect(to.apply(from.units())).toBe(2)
    expect(to.apply(from.units())).toBe(0)
    expect(to.size()).toBe(2)
  })

  test('не-санды (S6-подписи) хранятся спутником и едут в пачке, графа не касаясь', () => {
    const land = makeLand()
    const gift = GiftUnit.make({ peer: peerOf(0x11), time: 1, tick: 0, mate: Link.hole, tier: 3, rate: 0 })
    // Принят и учтён — но графа санд не касается: order(ROOT) пуст.
    expect(land.apply([gift])).toBe(1)
    expect(land.order(ROOT)).toEqual([])
    // Повторная доставка идемпотентна — условие остановки сходимости цело.
    expect(land.apply([gift])).toBe(0)
    // Уезжает в пачке для ретрансляции.
    expect(land.part().units.some(unit => unit instanceof GiftUnit)).toBe(true)
  })

  test('две реплики сходятся на конкурентных правках', () => {
    const clock = fixedClock(1000)
    const a = new Land(peerOf(0x11), clock)
    const b = new Land(peerOf(0x22), clock)

    const base = a.post(ROOT, ROOT, 'база')
    b.apply(a.units())

    a.post(ROOT, base.self, 'от а')
    b.post(ROOT, base.self, 'от б')

    for (let round = 0; round < 4; round++) {
      const moved = a.apply(b.units()) + b.apply(a.units())
      if (moved === 0) break
    }

    expect(values(a)).toEqual(values(b))
    expect(values(a)).toHaveLength(3)
  })

  test('счётчик id отматывается по своим же юнитам при гидрации', () => {
    const first = makeLand(0x11)
    const kept = first.post(ROOT, ROOT, 'до перезапуска')

    // Тот же пир поднялся заново: счётчик в памяти обнулился, а `self` обязан
    // остаться уникальным.
    const second = new Land(peerOf(0x11), fixedClock(2000))
    second.apply(first.units())
    const fresh = second.post(ROOT, ROOT, 'после перезапуска')

    expect(fresh.self).not.toBe(second.nodeOf(first.idOf(kept.self)))
    expect(values(second)).toEqual(['после перезапуска', 'до перезапуска'])
  })
})

describe('size и count', () => {
  test('size считает юниты по пирам, включая проигравших по LWW', () => {
    const clock = fixedClock(1000)
    const a = new Land(peerOf(0x11), clock)
    const b = new Land(peerOf(0x22), clock)

    const seed = a.post(ROOT, ROOT, 'семя')
    b.apply(a.units())

    const node = seed.self
    a.write(ROOT, ROOT, node, 'от а')
    b.write(ROOT, ROOT, b.nodeOf(a.idOf(node)), 'от б')

    const both = new Land(peerOf(0x33), clock)
    both.apply(a.units())
    both.apply(b.units())

    // Один узел, две живые версии от разных пиров — обе обязаны храниться:
    // `PackFace.summ` из S7 считает юниты ПО ПИРАМ, и выброшенный проигравший
    // сломает досылку.
    expect(both.count()).toBe(1)
    expect(both.size()).toBe(2)
    expect(both.units()).toHaveLength(2)
  })

  test('своя же прошлая версия не хранится: слот (head, peer, self) один', () => {
    const land = makeLand()
    const first = land.post(ROOT, ROOT, 'раз')
    land.post(ROOT, first.self, 'два')
    expect(land.count()).toBe(2)
    expect(land.size()).toBe(2)

    land.remove(first.self)
    expect(land.count()).toBe(1)
    // Надгробие встало на место прежней версии ТОГО ЖЕ пира: юнитов по-прежнему
    // два. «Включая проигравших» означает проигравших ЧУЖИХ — своя предыдущая
    // версия не нужна ни чтению, ни `summ`, и хранить её значило бы держать всю
    // историю правок вечно.
    expect(land.size()).toBe(2)
    expect(land.units()).toHaveLength(2)
  })
})

describe('ленивость', () => {
  test('непрочитанный ленд не заводит ни одного вида', () => {
    const land = makeLand()
    let lead = ROOT
    for (let i = 0; i < 200; i++) lead = land.post(ROOT, lead, i).self

    // `post` отдаёт вид на записанный узел — это и есть «прочитали». Ленд,
    // собранный приёмом, не заводит их вовсе.
    const wire = makeLand(0x22)
    wire.apply(land.units())
    expect(wire.views()).toBe(0)

    wire.read(wire.nodeOf(land.idOf(land.order(ROOT)[0]!.self)))
    expect(wire.views()).toBe(1)
  })

  test('вид перестраивается, когда узел выиграл новую версию', () => {
    const land = makeLand()
    const view = land.post(ROOT, ROOT, 'старое')
    expect(land.read(view.self)).toBe('старое')

    land.write(ROOT, ROOT, view.self, 'новое')
    expect(land.read(view.self)).toBe('новое')
    expect(land.peek(view.self)?.value).toBe('новое')
  })

  test('санд с выносным значением без приложенного ball отвергается', () => {
    const land = makeLand()
    const big = SandUnit.makeBig({
      peer: peerOf(0x22),
      time: 1200,
      tick: 0,
      self: Link.pawn(Link.hole, new Uint8Array([0, 0, 0, 0, 0, 7])),
      head: Link.hole,
      lead: Link.hole,
      size: 300,
      shot: new Uint8Array(12).fill(9),
    })

    // РАНЬШЕ этот юнит принимался, а бросало уже чтение: «значение вынесено в
    // ball — его подаёт хранилище». Так было неверно дважды. Во-первых, ленд
    // занимал слот, из которого потом читался мусор: байтов значения в юните нет
    // и взяться им неоткуда. Во-вторых, в формате НЕТ маркера «балл отделён»
    // (docs/03 §2, «Открытый вопрос»), поэтому такой юнит вообще не должен был
    // доехать — пачка его закодировать не может. Отказ на приёме честнее.
    expect(() => land.apply([big])).toThrow(/ball не приложен/)

    // А с приложенным баллом тот же юнит принимается и читается.
    const ball = varyEncode('я'.repeat(150))
    const shot = new Uint8Array(12)
    shotInto(shot, 0, ball, 0, ball.length)
    const good = SandUnit.makeBig({
      peer: peerOf(0x22),
      time: 1200,
      tick: 0,
      self: Link.pawn(Link.hole, new Uint8Array([0, 0, 0, 0, 0, 7])),
      head: Link.hole,
      lead: Link.hole,
      size: ball.length,
      shot,
    })
    expect(land.apply([good], new Map([[shotKey(shot), ball]]))).toBe(1)
    const node = land.nodeOf(new Uint8Array([0, 0, 0, 0, 0, 7]))
    expect(land.order(ROOT)).toHaveLength(1)
    expect(land.read(node)).toBe('я'.repeat(150))
  })
})

describe('реактивность поузловая', () => {
  test('правка одного узла из тысячи пересчитывает ровно один канал', () => {
    const land = makeLand(0x11)
    const nodes: LocalId[] = []
    let lead = ROOT
    for (let i = 0; i < 1000; i++) {
      const view = land.post(ROOT, lead, i)
      nodes.push(view.self)
      lead = view.self
    }

    let runs = 0
    const channels = nodes.map(node => computed(() => {
      runs += 1
      return land.read(node)
    }))
    for (const channel of channels) channel()
    runs = 0

    // Чужой юнит в середину набора.
    const other = new Land(peerOf(0x22), fixedClock(2000))
    other.apply(land.units())
    const target = nodes[500] as LocalId
    other.write(ROOT, ROOT, other.nodeOf(land.idOf(target)), 'правка')
    land.apply(other.units())

    for (const channel of channels) channel()
    expect(runs).toBe(1)
    expect(channels[500]!()).toBe('правка')
  })

  test('равное значение будит читателя: гашение — работа файбера', () => {
    const land = makeLand(0x11)
    const view = land.post(ROOT, ROOT, 'то же')

    let runs = 0
    const value = computed(() => {
      runs += 1
      return land.read(view.self)
    })
    expect(value()).toBe('то же')
    expect(runs).toBe(1)

    const other = new Land(peerOf(0x22), fixedClock(2000))
    other.apply(land.units())
    other.write(ROOT, ROOT, other.nodeOf(land.idOf(view.self)), 'то же')
    expect(land.apply(other.units())).toBe(1)

    // Канал пересчитан — ленд не решает равенство сам. А вот его собственные
    // читатели не проснутся: значение канала совпало, и это гасит уже файбер.
    expect(value()).toBe('то же')
    expect(runs).toBe(2)
  })

  test('order подписан на состав детей своей головы, а не соседней', () => {
    const land = makeLand()
    const left = land.post(ROOT, ROOT, 'левая')
    const right = land.post(ROOT, ROOT, 'правая')

    let leftRuns = 0
    let rightRuns = 0
    const leftKids = computed(() => {
      leftRuns += 1
      return land.order(left.self).length
    })
    const rightKids = computed(() => {
      rightRuns += 1
      return land.order(right.self).length
    })
    leftKids()
    rightKids()

    land.post(left.self, ROOT, 'ребёнок')
    expect(leftKids()).toBe(1)
    expect(rightKids()).toBe(0)
    expect(leftRuns).toBe(2)
    expect(rightRuns).toBe(1)
  })

  test('появление ещё не приехавшего узла будит того, кто его прочитал', () => {
    const from = makeLand(0x11)
    const view = from.post(ROOT, ROOT, 'приедет')

    const to = makeLand(0x22)
    const node = to.nodeOf(from.idOf(view.self))

    let runs = 0
    const value = computed(() => {
      runs += 1
      return to.read(node)
    })
    expect(value()).toBe(null)

    to.apply(from.units())
    expect(value()).toBe('приедет')
    expect(runs).toBe(2)
  })

  test('size и count — тоже каналы, каждый со своим сигналом', () => {
    const land = makeLand()
    let totalRuns = 0
    const total = computed(() => {
      totalRuns += 1
      return land.size()
    })
    const alive = computed(() => land.count())
    expect(total()).toBe(0)

    const view = land.post(ROOT, ROOT, 'раз')
    expect(total()).toBe(1)
    expect(alive()).toBe(1)
    expect(totalRuns).toBe(2)

    // Надгробие меняет число живых, но не число юнитов — и читатель `size`
    // остаётся спать: равную запись гасит сам `RefNode`.
    land.remove(view.self)
    expect(alive()).toBe(0)
    expect(total()).toBe(1)
    expect(totalRuns).toBe(2)
  })
})

describe('провод', () => {
  test('adopt принимает буфер пачки без копии в свою арену', () => {
    const from = makeLand(0x11)
    let lead = ROOT
    for (let i = 0; i < 500; i++) lead = from.post(ROOT, lead, i).self

    const land = Link.land(peerOf(0x11), new Uint8Array(8))
    const bin = packEncode([[land, packPart({ units: from.units() })]])

    const to = new Land(peerOf(0x22), fixedClock(1000))
    const before = to.bytes()
    expect(to.adopt(bin)).toBe(500)

    // Собственная арена не выросла ни на байт: чужой буфер принят главой.
    expect(to.bytes()).toBe(before)
    expect(values(to)).toEqual(values(from))
  })

  test('adopt и apply дают одно состояние', () => {
    const from = makeLand(0x11)
    let lead = ROOT
    for (let i = 0; i < 50; i++) lead = from.post(ROOT, lead, `значение ${i}`).self
    from.remove(from.order(ROOT)[10]!.self)

    const land = Link.land(peerOf(0x11), new Uint8Array(8))
    const bin = packEncode([[land, packPart({ units: from.units() })]])

    const copied = new Land(peerOf(0x22), fixedClock(1000))
    copied.apply(from.units())

    const adopted = new Land(peerOf(0x22), fixedClock(1000))
    adopted.adopt(bin)

    expect(values(adopted)).toEqual(values(copied))
    expect(adopted.size()).toBe(copied.size())
    expect(adopted.count()).toBe(copied.count())
  })

  test('пачка длиннее главы арены принимается целиком', () => {
    // 64 КиБ — размер главы; 2000 сандов по 56 Б переваливают за неё, и
    // регистрация внахлёст обязана удержать юнит, начавшийся у самой границы.
    const from = makeLand(0x11)
    let lead = ROOT
    for (let i = 0; i < 2000; i++) lead = from.post(ROOT, lead, i).self

    const land = Link.land(peerOf(0x11), new Uint8Array(8))
    const bin = packEncode([[land, packPart({ units: from.units() })]])
    expect(bin.length).toBeGreaterThan(1 << 16)

    const to = new Land(peerOf(0x22), fixedClock(1000))
    expect(to.adopt(bin)).toBe(2000)
    expect(values(to)).toEqual(values(from))
  })

  test('units() уезжает и возвращается через кодек без потерь', () => {
    const from = makeLand(0x11)
    const first = from.post(ROOT, ROOT, { имя: 'документ', версия: 2 }, 'keys')
    from.post(ROOT, first.self, new Uint8Array([1, 2, 3]))

    const land = Link.land(peerOf(0x11), new Uint8Array(8))
    const bin = packEncode([[land, packPart({ units: from.units() })]])

    const to = new Land(peerOf(0x22), fixedClock(1000))
    to.adopt(bin)

    expect(to.order(ROOT).map(view => view.tag)).toEqual(['keys', 'term'])
    expect(values(to)).toEqual([{ имя: 'документ', версия: 2 }, new Uint8Array([1, 2, 3])])
  })
})
