// Гейт S7 (wire-bc): кросс-табная доставка и цена рукопожатия.
//
// Бюджеты из docs/11 §3, строка S7, зафиксированы ДО первого запуска:
//   кросс-таб доставка ≤ 5 мс · трафик на «пустую» синхронизацию ≤ 1 КБ.
//
// Доставка меряется на НАСТОЯЩЕМ BroadcastChannel: путь «post → кран ленда →
// канал → apply соседа» целиком, от записи до того, как значение читается у
// соседа. Полу здесь взяться неоткуда, кроме самого канала — он и меряется
// рядом голым postMessage.

import { performance } from 'node:perf_hooks'
import { Link, Land, fixedClock, LAND_ROOT, syncTabs } from './dist/entry.js'
import { record } from './_budgets.mjs'

const BUDGETS = {
  'deliver/median': {
    limit_ms: 5,
    why: 'docs/11 §3 S7: кросс-таб доставка ≤ 5 мс. Медиана 200 записей post → чтение у соседа',
  },
  'hello/idle-bytes': {
    limit_bytes: 1024,
    why: 'docs/11 §3 S7: трафик на пустую синхронизацию ≤ 1 КБ. Привет вошедшей вкладки при совпавших состояниях, байты сообщений после входа',
  },
}

const LAND_ID = Link.land(Link.peer(new Uint8Array(8).fill(0xaa)), new Uint8Array(8))
const ROOT = LAND_ROOT

const fmt = (ms) => (ms < 1 ? `${(ms * 1000).toFixed(1)} мкс` : `${ms.toFixed(2)} мс`)

function peerOf(fill) {
  return Link.peer(new Uint8Array(8).fill(fill))
}

// ── Пол: голый BroadcastChannel ──────────────────────────────────────────────

async function floorOf() {
  const a = new BroadcastChannel('wire-floor')
  const b = new BroadcastChannel('wire-floor')
  const payload = new Uint8Array(128).buffer

  const laps = []
  for (let i = 0; i < 200; i++) {
    const started = performance.now()
    await new Promise((done) => {
      b.onmessage = () => done()
      a.postMessage(payload)
    })
    laps.push(performance.now() - started)
  }
  a.close()
  b.close()
  laps.sort((x, y) => x - y)
  return laps[laps.length >> 1]
}

// ── Доставка через весь стек ─────────────────────────────────────────────────

async function deliverOf() {
  const a = new Land(peerOf(0x11), fixedClock(1000), { session: 0x000010 })
  const b = new Land(peerOf(0x11), fixedClock(1000), { session: 0x800010 })
  const syncA = syncTabs({ land: a, id: LAND_ID })
  const syncB = syncTabs({ land: b, id: LAND_ID })
  await new Promise((done) => setTimeout(done, 30))

  const laps = []
  let lead = ROOT
  for (let i = 0; i < 200; i++) {
    const want = b.count() + 1
    const started = performance.now()
    lead = a.post(ROOT, lead, i).self
    await new Promise((done) => {
      const peek = () => {
        if (b.count() >= want) return done()
        setTimeout(peek, 0)
      }
      peek()
    })
    laps.push(performance.now() - started)
  }

  syncA.close()
  syncB.close()
  laps.sort((x, y) => x - y)
  return { median: laps[laps.length >> 1], worst: laps[laps.length - 1] }
}

// ── Трафик пустого рукопожатия ───────────────────────────────────────────────

function idleBytes() {
  // Две вкладки с одинаковым состоянием: сколько байт ходит при входе второй.
  const clock = fixedClock(1000)
  const a = new Land(peerOf(0x11), clock, { session: 0x000010 })
  const one = a.post(ROOT, ROOT, 'общие')
  a.post(ROOT, one.self, 'данные')

  const b = new Land(peerOf(0x11), clock, { session: 0x800010 })
  b.apply(a.part().units)

  // Пара портов без сети: доставка руками, счёт байтов, сторож на петлю.
  const ports = []
  const queue = []
  let bytes = 0
  let messages = 0
  const make = () => {
    const handlers = new Set()
    const port = {
      handlers,
      send(pack) {
        bytes += pack.length
        messages += 1
        queue.push({ from: port, pack: pack.slice() })
      },
      onMessage(handle) {
        handlers.add(handle)
        return () => handlers.delete(handle)
      },
      close() {
        handlers.clear()
      },
    }
    ports.push(port)
    return port
  }
  const deliver = () => {
    let guard = 0
    while (queue.length > 0) {
      if (++guard > 1000) throw new Error('рукопожатие не замолкает: петля реплик')
      const next = queue.shift()
      for (const port of ports) {
        if (port === next.from) continue
        for (const handle of port.handlers) handle(next.pack)
      }
    }
  }

  const syncA = syncTabs({ land: a, id: LAND_ID, port: make() })
  deliver()
  // Привет A ушёл в пустоту — сеть считается с момента входа B.
  bytes = 0
  messages = 0

  const syncB = syncTabs({ land: b, id: LAND_ID, port: make() })
  deliver()

  syncA.close()
  syncB.close()
  return { bytes, messages }
}

// ── Прогон ───────────────────────────────────────────────────────────────────

console.log('\n══ Канал вкладок (wire-bc, настоящий BroadcastChannel) ═══════════')

const floor = await floorOf()
const trip = await deliverOf()
console.log(`  пол: голый postMessage      ${fmt(floor).padStart(10)}`)
console.log(`  post → чтение у соседа      ${fmt(trip.median).padStart(10)}   худший ${fmt(trip.worst)}`)

const idle = idleBytes()
console.log(`  вход при равных состояниях  ${String(idle.bytes).padStart(7)} Б за ${idle.messages} сообщений`)

const results = {
  'deliver/median': { measured_ms: trip.median, floor_ms: floor, worst_ms: trip.worst },
  'hello/idle-bytes': { measured_bytes: idle.bytes, messages: idle.messages },
}

console.log('\n══ Бюджеты S7 (wire-bc) ═════════════════════════════════════════')
let passed = true
for (const [name, budget] of Object.entries(BUDGETS)) {
  const item = results[name]
  const measured = item.measured_ms ?? item.measured_bytes
  const limit = budget.limit_ms ?? budget.limit_bytes
  const ok = measured <= limit
  passed &&= ok
  const show = item.measured_ms !== undefined ? fmt(measured) : `${measured} Б`
  const cap = budget.limit_ms !== undefined ? fmt(limit) : `${limit} Б`
  console.log(`  ${name.padEnd(22)} ${show.padStart(12)} при бюджете ${cap.padStart(9)} — ${ok ? 'ПРОЙДЕН' : 'ПРОВАЛЕН'}`)
}

record('wire_bc', {
  spec: 'кросс-таб доставка ≤ 5 мс, пустая синхронизация ≤ 1 КБ (docs/11 §3, S7); бюджеты зафиксированы до первого запуска',
  passed,
  ...results,
  budget: BUDGETS,
})

if (!passed) process.exitCode = 1
