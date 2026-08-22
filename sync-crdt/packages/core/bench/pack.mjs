// Скоростной гейт S2/Pack: цена контейнера на горячих операциях.
//
// Главный бюджет приходит из DoD стадии S2 — `packDecode` на 10 000 юнитов
// ≤ 20 мс. Остальные бюджеты зафиксированы ЗДЕСЬ и ДО первого замера
// (PRINCIPLES.md, правило 2), лежат в BUDGETS ниже.
//
// Меряются точки, через которые проходит каждый принятый пакет и каждая загрузка
// ленда с диска: сборка, разбор, разбор с восстановлением арены (`offsets`+`pool`),
// разбор пакета с дырами и разбор пакета с выносными значениями.
//
// Отдельным разделом — байты на юнит при разборе: `packDecode` не копирует юниты
// из буфера, и цифра обязана это подтверждать, а не быть обещанием в комментарии.
import { do_not_optimize, measure } from 'mitata'
import { Link, SandUnit, packDecode, packEncode, packPart, shotKey } from './dist/entry.js'
import { record } from './_budgets.mjs'

const round = (n) => Math.round(n * 100) / 100

const fmt = (ns) => {
  if (ns < 1000) return `${ns.toFixed(1)} ns`
  if (ns < 1e6) return `${(ns / 1000).toFixed(2)} µs`
  return `${(ns / 1e6).toFixed(3)} ms`
}

async function gauge(label, fn) {
  const stats = await measure(fn)
  console.log(`  ${label.padEnd(30)} avg ${fmt(stats.avg).padStart(10)}  p50 ${fmt(stats.p50).padStart(10)}  p99 ${fmt(stats.p99).padStart(10)}`)
  return { avg_ns: round(stats.avg), p50_ns: round(stats.p50), p99_ns: round(stats.p99) }
}

/** Бюджеты — наносекунды на операцию. Обещание, данное до первого запуска. */
const BUDGETS = {
  // Гейт стадии S2 (docs/11-roadmap.md): разбор пакета на 10 000 юнитов ≤ 20 мс.
  'decode/10000': 20e6,
  // Кодирование не в гейте, но обязано быть того же порядка: обе стороны провода.
  'encode/10000': 20e6,
  // Восстановление арены (offsets + pool) не должно удваивать разбор.
  'decode/10000/arena': 30e6,
  // Линейность: 100 юнитов — сотая доля работы, накладные расходы заголовка не в счёт.
  'decode/100': 200_000,
}

/** Байт на юнит при разборе: юнит — окно в буфер, а не копия. */
const MEMORY_BUDGET = 200

// ── Наборы ───────────────────────────────────────────────────────────────────

/** Детерминированный LCG: бенч обязан воспроизводиться от прогона к прогону. */
function lcg(seed) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0
    return (state >>> 16) & 0xff
  }
}

const rnd = lcg(20260815)

function bin(size) {
  const out = new Uint8Array(size)
  for (let i = 0; i < size; i++) out[i] = rnd()
  out[size - 1] |= 1
  return out
}

const peers = []
for (let i = 0; i < 8; i++) peers.push(Link.peer(bin(8)))

const land = Link.land(peers[0], bin(8))

/** `n` inline-сандов одного ленда — профиль обычной дельты. */
function flat(n) {
  const units = []
  for (let i = 0; i < n; i++) {
    units.push(SandUnit.make({
      peer: peers[i & 7],
      time: 1_700_000_000 + (i & 1023),
      tick: i & 3,
      self: Link.pawn(Link.hole, bin(6)),
      head: Link.pawn(Link.hole, bin(6)),
      lead: Link.pawn(Link.hole, bin(6)),
      value: { n: i, s: 'item' },
    }))
  }
  return [[land, packPart({ units })]]
}

/** Фейсы без юнитов — пакет «вот моё состояние». */
function faced(n) {
  const faces = []
  for (let i = 0; i < n; i++) {
    faces.push({ peer: Link.peer(bin(8)), time: 1_700_000_000 + i, tick: i & 0xffff, summ: i * 7 })
  }
  return [[land, packPart({ faces })]]
}

/** Каждый десятый санд — с выносным значением: разбор обязан шагать через ball. */
function ballish(n) {
  const units = []
  const balls = new Map()
  for (let i = 0; i < n; i++) {
    if (i % 10 === 9) {
      const shot = bin(12)
      units.push(SandUnit.makeBig({
        peer: peers[i & 7],
        time: 1_700_000_000 + i,
        tick: 0,
        self: Link.pawn(Link.hole, bin(6)),
        head: Link.pawn(Link.hole, bin(6)),
        lead: Link.pawn(Link.hole, bin(6)),
        size: 200,
        shot,
      }))
      balls.set(shotKey(shot), bin(200))
      continue
    }
    units.push(SandUnit.make({
      peer: peers[i & 7],
      time: 1_700_000_000 + i,
      tick: 0,
      self: Link.pawn(Link.hole, bin(6)),
      head: Link.pawn(Link.hole, bin(6)),
      lead: Link.pawn(Link.hole, bin(6)),
      value: i,
    }))
  }
  return [[land, packPart({ units, balls })]]
}

/** Арена после удалений: каждый третий слот зачищен. */
function holed(n) {
  const packed = packEncode(flat(n))
  const parts = packDecode(packed)
  const units = parts[0][1].units

  let at = 24
  let index = 0
  for (const unit of units) {
    if (index % 3 === 1) packed.fill(0, at, at + unit.bin.length)
    at += unit.bin.length
    index += 1
  }
  return packed
}

/** Пул-заглушка: считает вызовы, чтобы восстановление арены не мерилось вхолостую. */
function pool() {
  return { freed: 0, calls: 0, release(_at, size) { this.freed += size; this.calls += 1 } }
}

const SIZES = [100, 1000, 10000]
const results = {}

// ── Кодирование ──────────────────────────────────────────────────────────────

console.log('\n══ Pack: кодирование ════════════════════════════════════════════')

const sets = new Map()
for (const n of SIZES) sets.set(n, flat(n))

for (const n of SIZES) {
  const parts = sets.get(n)
  const size = packEncode(parts).length
  results[`encode/${n}`] = await gauge(`packEncode ${n} юнитов (${size} Б)`, () => do_not_optimize(packEncode(parts)))
}

// ── Разбор ───────────────────────────────────────────────────────────────────

console.log('\n══ Pack: разбор ═════════════════════════════════════════════════')

const packs = new Map()
for (const n of SIZES) packs.set(n, packEncode(sets.get(n)))

for (const n of SIZES) {
  const packed = packs.get(n)
  results[`decode/${n}`] = await gauge(`packDecode ${n} юнитов`, () => do_not_optimize(packDecode(packed)))
}

for (const n of SIZES) {
  const packed = packs.get(n)
  console.log(`  → ${n}: ${round(results[`decode/${n}`].avg_ns / n)} нс на юнит, ${round(packed.length / n)} Б на юнит`)
}

// ── Разбор с восстановлением арены ───────────────────────────────────────────

console.log('\n══ Pack: разбор как загрузка арены ══════════════════════════════')

for (const n of SIZES) {
  const packed = packs.get(n)
  results[`decode/${n}/arena`] = await gauge(`packDecode + offsets + pool ${n}`, () => {
    do_not_optimize(packDecode(packed, { offsets: new WeakMap(), pool: pool() }))
  })
}

const gap = holed(10000)
const spy = pool()
packDecode(gap, { pool: spy })
console.log(`  дыр в арене: ${spy.calls} прогонов, ${spy.freed} Б свободно из ${gap.length}`)
results['decode/10000/holed'] = await gauge('packDecode 10000 с дырами', () => do_not_optimize(packDecode(gap)))

// ── Фейсы и выносные значения ────────────────────────────────────────────────

console.log('\n══ Pack: фейсы и ball ═══════════════════════════════════════════')

// Набор строится ДО замера: `faced()` аллоцирует ссылки, и вызов внутри
// замеряемого замыкания мерил бы сборку набора, а не кодирование.
const faceParts = faced(1000)
const facePack = packEncode(faceParts)
results['decode/faces/1000'] = await gauge('packDecode 1000 фейсов', () => do_not_optimize(packDecode(facePack)))
results['encode/faces/1000'] = await gauge('packEncode 1000 фейсов', () => do_not_optimize(packEncode(faceParts)))

const ballParts = ballish(10000)
const ballPack = packEncode(ballParts)
results['decode/10000/balls'] = await gauge(`packDecode 10000 (10 % big, ${ballPack.length} Б)`, () => {
  do_not_optimize(packDecode(ballPack))
})
results['encode/10000/balls'] = await gauge('packEncode 10000 (10 % big)', () => do_not_optimize(packEncode(ballParts)))

// ── Круг ─────────────────────────────────────────────────────────────────────

console.log('\n══ Pack: круг ═══════════════════════════════════════════════════')

const round10k = packs.get(10000)
results['roundtrip/10000'] = await gauge('encode(decode(b)) 10000', () => do_not_optimize(packEncode(packDecode(round10k))))

// ── Память ───────────────────────────────────────────────────────────────────

function heap() {
  global.gc?.()
  global.gc?.()
  return process.memoryUsage().heapUsed
}

console.log('\n══ Pack: память ═════════════════════════════════════════════════')

const memory = (() => {
  const packed = packs.get(10000)
  const before = heap()
  const parts = packDecode(packed)
  const after = heap()
  const per = Math.round((after - before) / parts[0][1].units.length)
  console.log(`  ${'packDecode 10000'.padEnd(30)} ${per} Б на юнит сверх буфера пакета`)
  if (parts[0][1].units.length !== 10000) throw new Error('набор потерян')
  return { per_unit_bytes: per, pack_bytes: packed.length }
})()

if (global.gc === undefined) console.log('  (запуск без --expose-gc: числа памяти шумные)')

// ── Вердикт ──────────────────────────────────────────────────────────────────

console.log('\n══ Бюджеты Pack ═════════════════════════════════════════════════')

const budget = {}
let passed = true
for (const [name, limit] of Object.entries(BUDGETS)) {
  const measured = results[name].avg_ns
  const ok = measured <= limit
  passed &&= ok
  budget[name] = { limit_ns: limit, measured_ns: measured, passed: ok }
  console.log(`  ${name.padEnd(30)} ${fmt(measured).padStart(10)} при бюджете ${fmt(limit).padStart(10)} — ${ok ? 'ПРОЙДЕН' : 'ПРОВАЛЕН'}`)
}

const memoryOk = memory.per_unit_bytes <= MEMORY_BUDGET
passed &&= memoryOk
budget['memory/unit'] = { limit_bytes: MEMORY_BUDGET, measured_bytes: memory.per_unit_bytes, passed: memoryOk }
console.log(`  ${'memory/unit'.padEnd(30)} ${String(memory.per_unit_bytes).padStart(10)} Б при бюджете ${String(MEMORY_BUDGET).padStart(7)} Б — ${memoryOk ? 'ПРОЙДЕН' : 'ПРОВАЛЕН'}`)

record('pack_ns', {
  ...results,
  memory_bytes: memory,
  ns_per_unit_decode_10000: round(results['decode/10000'].avg_ns / 10000),
  budget: {
    spec: 'packDecode 10 000 юнитов ≤ 20 мс (DoD S2); остальные бюджеты зафиксированы в bench/pack.mjs до первого замера',
    passed,
    ...budget,
  },
})
