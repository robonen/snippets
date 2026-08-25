import { expect, test } from 'vitest'
import { Link } from '../../binary/link'
import { fixedClock } from '../../land/clock'
import { Land } from '../../land/land'
import { ROOT } from '../../land/view'
import { behindOf, diffOf, facesFromPack, facesOf, facesToPack } from '../face'
import { syncTabs, type Port } from '../tabs'

const LAND = Link.land(Link.peer(new Uint8Array(8).fill(0xe1)), new Uint8Array(8))

function peerOf(fill: number): Link {
  return Link.peer(new Uint8Array(8).fill(fill))
}

/** Ленд вкладки: свой сеанс обязателен — вкладки живут под ОДНИМ пиром. */
function tabLand(session: number, peer = 0x11): Land {
  return new Land(peerOf(peer), fixedClock(1000), { session })
}

/**
 * Ступица для тестов: порты, доставляющие всем ОСТАЛЬНЫМ.
 *
 * Доставка отложенная (очередь, разгружаемая руками) — как у настоящего
 * `BroadcastChannel`, но детерминированно: тест сам решает, когда «сеть» отдаёт
 * сообщения, и может считать трафик.
 */
function hub() {
  const ports: FakePort[] = []
  const queue: { from: FakePort; bytes: Uint8Array }[] = []
  let bytesTotal = 0
  let messages = 0

  class FakePort implements Port {
    readonly handlers = new Set<(bytes: Uint8Array) => void>()
    closed = false

    send(bytes: Uint8Array): void {
      if (this.closed) return
      bytesTotal += bytes.length
      messages += 1
      queue.push({ from: this, bytes: bytes.slice() })
    }

    onMessage(handle: (bytes: Uint8Array) => void): () => void {
      this.handlers.add(handle)
      return () => {
        this.handlers.delete(handle)
      }
    }

    close(): void {
      this.closed = true
      this.handlers.clear()
    }
  }

  return {
    port(): Port {
      const port = new FakePort()
      ports.push(port)
      return port
    },
    /** Разгрузить очередь до пустоты. Возвращает число доставленных сообщений. */
    deliver(): number {
      let count = 0
      // Доставка может породить новые сообщения — крутимся до дна, с потолком.
      let guard = 0
      while (queue.length > 0) {
        if (++guard > 10_000) throw new Error('the channel does not go quiet: looks like a replication loop')
        const next = queue.shift() as { from: FakePort; bytes: Uint8Array }
        count += 1
        for (const port of ports) {
          if (port === next.from || port.closed) continue
          for (const handle of port.handlers) handle(next.bytes)
        }
      }
      return count
    },
    stats: () => ({ bytesTotal, messages }),
    reset: () => {
      bytesTotal = 0
      messages = 0
    },
  }
}

function valuesOf(land: Land): unknown[] {
  return land.order(ROOT).map((view) => view.value)
}

/** Кран ленда шлёт по микрозадаче — дожидаемся её. */
async function settled(): Promise<void> {
  await new Promise<void>((done) => queueMicrotask(done))
  await new Promise<void>((done) => queueMicrotask(done))
}

// ─── Фейсы и дельта ───────────────────────────────────────────────────────────

test('faces track the watermark and unit count per peer', () => {
  const land = tabLand(0x10)
  const first = land.post(ROOT, ROOT, 'а')
  land.post(ROOT, first.self, 'б')

  const faces = facesOf(land.part())
  expect(faces.size).toBe(1)
  const face = [...faces.values()][0]
  expect(face?.summ).toBe(2)
  expect(face?.time).toBe(1000)
})

test('faces survive the round-trip through the pack form', () => {
  const land = tabLand(0x10)
  land.post(ROOT, ROOT, 'а')

  const faces = facesOf(land.part())
  const back = facesFromPack(facesToPack(faces))
  expect(back).toEqual(faces)
})

test('delta: strictly old is not resent, the boundary second goes whole', () => {
  const clock = fixedClock(1000)
  const a = new Land(peerOf(0x11), clock, { session: 0x10 })
  const first = a.post(ROOT, ROOT, 'старое')
  clock.advance(5)
  const second = a.post(ROOT, first.self, 'общее')

  // B видел оба — его водяной знак стоит на секунде 1005.
  const b = new Land(peerOf(0x22), clock, { session: 0x20 })
  b.apply(a.part().units)
  const theirFaces = facesOf(b.part())

  clock.advance(5)
  a.post(ROOT, second.self, 'новое')

  // «Старое» (1000) строго ниже знака — не уезжает. «Общее» (1005) — в
  // пограничной секунде знака: с сеансами (ADR-017) у пира несколько писателей,
  // и в этой секунде знак ничего не доказывает — уезжает всегда. «Новое» (1010)
  // свежее знака.
  const delta = diffOf(a.part(), theirFaces)
  expect(delta.units.map((unit) => unit.time()).sort()).toEqual([1005, 1010])
})

test('Fail Summ: a lost middle of history is resent whole', () => {
  const clock = fixedClock(1000)
  const a = new Land(peerOf(0x11), clock, { session: 0x10 })
  const one = a.post(ROOT, ROOT, 'раз')
  clock.advance(1)
  const two = a.post(ROOT, one.self, 'два')
  clock.advance(1)
  a.post(ROOT, two.self, 'три')

  // B потерял середину: у него «раз» и «три», но водяной знак — по «три».
  const b = new Land(peerOf(0x22), clock, { session: 0x20 })
  const units = a.part().units
  b.apply([units[0], units[2]].filter((unit) => unit !== undefined) as typeof units)
  const theirFaces = facesOf(b.part())

  // Дельта по знаку была бы пуста: всё, что есть у A, не свежее знака B. Но
  // юнитов пира у нас три, а B насчитал два — значит, он что-то потерял, и
  // уезжает вся история пира.
  const delta = diffOf(a.part(), theirFaces)
  expect(delta.units).toHaveLength(3)
})

test('behindOf sees lag by watermark, by peer, and by count', () => {
  const clock = fixedClock(1000)
  const a = new Land(peerOf(0x11), clock, { session: 0x10 })
  a.post(ROOT, ROOT, 'а')

  const empty = new Land(peerOf(0x22), clock, { session: 0x20 })
  expect(behindOf(facesOf(empty.part()), facesOf(a.part()))).toBe(true)
  expect(behindOf(facesOf(a.part()), facesOf(empty.part()))).toBe(false)
  expect(behindOf(facesOf(a.part()), facesOf(a.part()))).toBe(false)
})

// ─── Канал вкладок ────────────────────────────────────────────────────────────

test('a joining tab receives everything on hello', () => {
  const net = hub()
  const a = tabLand(0x000010)
  const one = a.post(ROOT, ROOT, 'раз')
  a.post(ROOT, one.self, 'два')

  const syncA = syncTabs({ land: a, id: LAND, port: net.port() })
  net.deliver()

  const b = tabLand(0x800010)
  const syncB = syncTabs({ land: b, id: LAND, port: net.port() })
  net.deliver()

  expect(valuesOf(b)).toEqual(['раз', 'два'])
  syncA.close()
  syncB.close()
})

test('counter-delta: the old-timer receives the offline edits of the joining tab', () => {
  const net = hub()
  const a = tabLand(0x000010)
  a.post(ROOT, ROOT, 'от старожила')
  const syncA = syncTabs({ land: a, id: LAND, port: net.port() })
  net.deliver()

  // B редактировал офлайн — у него своё, у A своё.
  const b = tabLand(0x800010)
  b.post(ROOT, ROOT, 'офлайн-правка')
  const syncB = syncTabs({ land: b, id: LAND, port: net.port() })
  net.deliver()

  expect(valuesOf(a).sort()).toEqual(['от старожила', 'офлайн-правка'])
  expect(valuesOf(b).sort()).toEqual(['от старожила', 'офлайн-правка'])
  syncA.close()
  syncB.close()
})

test('the old-timer is behind: the joining tab asks nothing, but the old-timer learns and receives', () => {
  const net = hub()
  // A — старожил с пустым лендом, B входит с данными. Дельта A→B пуста, и без
  // ветки «назваться» A не узнал бы, что отстал.
  const a = tabLand(0x000010)
  const syncA = syncTabs({ land: a, id: LAND, port: net.port() })
  net.deliver()

  const b = tabLand(0x800010)
  b.post(ROOT, ROOT, 'у вошедшей есть')
  const syncB = syncTabs({ land: b, id: LAND, port: net.port() })
  net.deliver()

  expect(valuesOf(a)).toEqual(['у вошедшей есть'])
  syncA.close()
  syncB.close()
})

test('live stream: a write leaves through the tap and reaches the neighbors', async () => {
  const net = hub()
  const a = tabLand(0x000010)
  const b = tabLand(0x800010)
  const syncA = syncTabs({ land: a, id: LAND, port: net.port() })
  const syncB = syncTabs({ land: b, id: LAND, port: net.port() })
  net.deliver()

  const first = a.post(ROOT, ROOT, 'привет')
  await settled()
  net.deliver()
  expect(valuesOf(b)).toEqual(['привет'])

  // И обратно — канал симметричен.
  b.post(ROOT, first.self, 'мир')
  await settled()
  net.deliver()
  expect(valuesOf(a)).toEqual(['привет', 'мир'])
  expect(valuesOf(b)).toEqual(['привет', 'мир'])

  syncA.close()
  syncB.close()
})

test('three tabs converge and the channel goes quiet', async () => {
  const net = hub()
  const tabs = [tabLand(0x000010), tabLand(0x600010), tabLand(0xc00010)]
  const syncs = tabs.map((land) => syncTabs({ land, id: LAND, port: net.port() }))
  net.deliver()

  tabs[0]?.post(ROOT, ROOT, 'из первой')
  tabs[1]?.post(ROOT, ROOT, 'из второй')
  tabs[2]?.post(ROOT, ROOT, 'из третьей')
  await settled()
  net.deliver()

  const want = ['из первой', 'из второй', 'из третьей'].sort()
  for (const land of tabs) expect(valuesOf(land).sort()).toEqual(want)

  // Сошлись — и замолчали: ни одна вкладка не переспрашивает по кругу.
  net.reset()
  await settled()
  expect(net.deliver()).toBe(0)
  expect(net.stats().messages).toBe(0)

  for (const sync of syncs) sync.close()
})

test('a long value arrives with its ball — both by hello and by tap', async () => {
  const long = 'Длинный заголовок, который не помещается в юнит и уезжает в ball'
  expect(new TextEncoder().encode(long).length).toBeGreaterThan(62)

  const net = hub()
  const a = tabLand(0x000010)
  a.post(ROOT, ROOT, long)
  const syncA = syncTabs({ land: a, id: LAND, port: net.port() })
  net.deliver()

  // Приветом: B входит после записи.
  const b = tabLand(0x800010)
  const syncB = syncTabs({ land: b, id: LAND, port: net.port() })
  net.deliver()
  expect(valuesOf(b)).toEqual([long])

  // Краном: живая запись после входа.
  const tail = `${long} — вторая`
  a.post(ROOT, ROOT, tail)
  await settled()
  net.deliver()
  expect(valuesOf(b).sort()).toEqual([long, tail].sort())

  syncA.close()
  syncB.close()
})

test('foreign data is not relayed: no echo on the shared channel', async () => {
  const net = hub()
  const tabs = [tabLand(0x000010), tabLand(0x600010), tabLand(0xc00010)]
  const syncs = tabs.map((land) => syncTabs({ land, id: LAND, port: net.port() }))
  net.deliver()
  net.reset()

  tabs[0]?.post(ROOT, ROOT, 'одна запись')
  await settled()
  const delivered = net.deliver()
  await settled()
  net.deliver()

  // Одна запись — одно сообщение в канал: пачка крана первой вкладки. Приёмники
  // не пересылают чужое, поэтому больше в канале ничего нет.
  expect(delivered).toBe(1)
  expect(net.stats().messages).toBe(1)

  for (const sync of syncs) sync.close()
})

test('empty sync of two identical tabs is under a kilobyte', () => {
  const net = hub()
  const a = tabLand(0x000010)
  const one = a.post(ROOT, ROOT, 'общие')
  a.post(ROOT, one.self, 'данные')

  const b = tabLand(0x800010)
  b.apply(a.part().units)

  const syncA = syncTabs({ land: a, id: LAND, port: net.port() })
  net.deliver()
  net.reset()

  // B входит с тем же состоянием: привет, ноль дельт, тишина.
  const syncB = syncTabs({ land: b, id: LAND, port: net.port() })
  net.deliver()

  expect(net.stats().bytesTotal).toBeLessThan(1024)
  syncA.close()
  syncB.close()
})

test('a channel of another land is ignored', () => {
  const OTHER = Link.land(Link.peer(new Uint8Array(8).fill(0xf2)), new Uint8Array(8))
  const net = hub()
  const a = tabLand(0x000010)
  a.post(ROOT, ROOT, 'своё')
  const syncA = syncTabs({ land: a, id: LAND, port: net.port() })

  const b = tabLand(0x800010)
  const syncB = syncTabs({ land: b, id: OTHER, port: net.port() })
  net.deliver()

  expect(valuesOf(b)).toEqual([])
  syncA.close()
  syncB.close()
})

// ─── Настоящий BroadcastChannel (Node 18+) ────────────────────────────────────

test('smoke: two lands converge through a real BroadcastChannel', async () => {
  const a = tabLand(0x000010)
  const b = tabLand(0x800010)
  const one = a.post(ROOT, ROOT, 'по-настоящему')

  const syncA = syncTabs({ land: a, id: LAND })
  const syncB = syncTabs({ land: b, id: LAND })

  // BC доставляет макрозадачей — ждём, пока обе стороны обменяются.
  await new Promise((done) => setTimeout(done, 50))
  expect(valuesOf(b)).toEqual(['по-настоящему'])

  b.post(ROOT, one.self, 'и обратно')
  await new Promise((done) => setTimeout(done, 50))
  expect(valuesOf(a)).toEqual(['по-настоящему', 'и обратно'])

  syncA.close()
  syncB.close()
})
