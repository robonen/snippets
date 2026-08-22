// Скоростной гейт S2/Unit: цена бинарного юнита на горячих операциях.
//
// Бюджеты зафиксированы ДО замера (PRINCIPLES.md, правило 2) и лежат в BUDGETS
// ниже. Меряются ровно те точки, через которые проходит каждый принятый пакет:
// сборка санда, разбор чужих байт, чтение полей, `compare` и байты на юнит.
//
// Отдельным разделом — две проверки, на которые опираются решения в коде:
//   1. «поля читаются через DataView» из спецификации против ручного разбора
//      big-endian: вид на буфер стоит объекта на юнит, и цену надо видеть;
//   2. `Unit.compare` над байтами против `compare` над обычным объектом из
//      `src/land/lww.ts` — слою порядка предстоит переезд, и он должен знать,
//      во что обойдётся.
import { do_not_optimize, measure } from 'mitata'
import { GiftUnit, Link, PassUnit, SandUnit, SealUnit, Unit, compare, parseUnit } from './dist/entry.js'
import { record } from './_budgets.mjs'

const round = (n) => Math.round(n * 100) / 100

const fmt = (ns) => {
  if (ns < 1000) return `${ns.toFixed(1)} ns`
  if (ns < 1e6) return `${(ns / 1000).toFixed(2)} µs`
  return `${(ns / 1e6).toFixed(3)} ms`
}

async function gauge(label, fn) {
  const stats = await measure(fn)
  console.log(`  ${label.padEnd(26)} avg ${fmt(stats.avg).padStart(10)}  p50 ${fmt(stats.p50).padStart(10)}  p99 ${fmt(stats.p99).padStart(10)}`)
  return { avg_ns: round(stats.avg), p50_ns: round(stats.p50), p99_ns: round(stats.p99) }
}

/** Бюджеты — наносекунды на операцию. Обещание, данное до первого запуска. */
const BUDGETS = {
  'make/inline': 400,
  'parse/sand': 80,
  'read/time': 10,
  'read/peer/cached': 15,
  'read/value/cached': 15,
  compare: 40,
  'sort/1000': 400_000,
}

/** Байт на юнит: юнитов в памяти столько же, сколько записей в документе. */
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

const COUNT = 1024
const MASK = COUNT - 1

const peers = []
for (let i = 0; i < 8; i++) peers.push(Link.peer(bin(8)))

const fields = []
for (let i = 0; i < COUNT; i++) {
  fields.push({
    peer: peers[i & 7],
    // Метки нарочно повторяются: арбитраж по пиру и по тику должен попадать в
    // замер, иначе `compare` меряется на первом же несовпадении времени.
    time: 1_700_000_000 + (i & 15),
    tick: i & 3,
    self: Link.pawn(Link.hole, bin(6)),
    head: Link.pawn(Link.hole, bin(6)),
    lead: Link.pawn(Link.hole, bin(6)),
    value: { n: i, s: 'item' },
  })
}

const units = fields.map(item => SandUnit.make(item))
const bins = units.map(unit => unit.bin)
const results = {}

console.log('\n══ Unit: сборка ═════════════════════════════════════════════════')

let i = 0
results['make/inline'] = await gauge('SandUnit.make (56 Б)', () => {
  i = (i + 1) & MASK
  do_not_optimize(SandUnit.make(fields[i]))
})

const giftFields = {
  peer: peers[0], time: 1_700_000_000, tick: 1, mate: peers[1],
  tier: 0b0011, rate: 0, code: bin(16),
}
results['make/gift'] = await gauge('GiftUnit.make', () => do_not_optimize(GiftUnit.make(giftFields)))

const sealFields = {
  peer: peers[0], time: 1_700_000_000, tick: 2,
  hashes: [bin(12), bin(12), bin(12), bin(12), bin(12)], sign: bin(64), wide: false,
}
results['make/seal'] = await gauge('SealUnit.make (5 хэшей)', () => do_not_optimize(SealUnit.make(sealFields)))

const passFields = { peer: peers[0], time: 1_700_000_000, tick: 3, algo: 'ed25519', key: bin(32) }
results['make/pass'] = await gauge('PassUnit.make', () => do_not_optimize(PassUnit.make(passFields)))

console.log('\n══ Unit: разбор ═════════════════════════════════════════════════')

results['parse/sand'] = await gauge('parseUnit (sand)', () => {
  i = (i + 1) & MASK
  do_not_optimize(parseUnit(bins[i]))
})

const mixed = [units[0].bin, GiftUnit.make(giftFields).bin, SealUnit.make(sealFields).bin, PassUnit.make(passFields).bin]
results['parse/mixed'] = await gauge('parseUnit (4 вида)', () => {
  i = (i + 1) & MASK
  do_not_optimize(parseUnit(mixed[i & 3]))
})

console.log('\n══ Unit: чтение полей ═══════════════════════════════════════════')

results['read/time'] = await gauge('time()', () => {
  i = (i + 1) & MASK
  do_not_optimize(units[i].time())
})

results['read/tick'] = await gauge('tick()', () => {
  i = (i + 1) & MASK
  do_not_optimize(units[i].tick())
})

// Ссылки и значение кэшируются в приватных полях: первый вызов платит за разбор,
// дальше отдаётся тот же объект. Обе цены нужны — юнит из пачки читается один
// раз, а юнит из индекса тысячи раз.
for (const unit of units) {
  unit.peer()
  unit.self()
  unit.head()
  unit.lead()
  unit.value()
}

results['read/peer/cached'] = await gauge('peer() (кэш)', () => {
  i = (i + 1) & MASK
  do_not_optimize(units[i].peer())
})

results['read/head/cached'] = await gauge('head() (кэш)', () => {
  i = (i + 1) & MASK
  do_not_optimize(units[i].head())
})

results['read/value/cached'] = await gauge('value() (кэш)', () => {
  i = (i + 1) & MASK
  do_not_optimize(units[i].value())
})

results['read/peer/cold'] = await gauge('parse + peer()', () => {
  i = (i + 1) & MASK
  do_not_optimize(parseUnit(bins[i]).peer())
})

results['read/value/cold'] = await gauge('parse + value()', () => {
  i = (i + 1) & MASK
  do_not_optimize(parseUnit(bins[i]).value())
})

results['read/path'] = await gauge('path()', () => {
  i = (i + 1) & MASK
  do_not_optimize(units[i].path())
})

console.log('\n══ Unit: порядок ════════════════════════════════════════════════')

results.compare = await gauge('Unit.compare', () => {
  i = (i + 1) & MASK
  do_not_optimize(Unit.compare(units[i], units[(i + 7) & MASK]))
})

// Тот же порядок на обычных объектах — то, чем слой ленда живёт сейчас.
// `peer` берётся как hex: он сохраняет порядок байт, в отличие от base64url.
const hex = (b) => {
  let out = ''
  for (const x of b) out += x.toString(16).padStart(2, '0')
  return out
}
const sands = fields.map(item => ({
  self: hex(item.self.bin.subarray(16)),
  head: hex(item.head.bin.subarray(16)),
  lead: hex(item.lead.bin.subarray(16)),
  peer: hex(item.peer.bin),
  time: item.time,
  tick: item.tick,
  value: item.value,
}))

// Ничья по времени: включается арбитраж по пиру — самая длинная ветка.
const twins = fields.map((item, k) => SandUnit.make({ ...item, time: 1_700_000_000, tick: k & 3 }))

results['compare/tie'] = await gauge('Unit.compare (ничья по time)', () => {
  i = (i + 1) & MASK
  do_not_optimize(Unit.compare(twins[i], twins[(i + 8) & MASK]))
})

// Полное совпадение метки: сравнение обязано дойти до последнего поля.
results['compare/same'] = await gauge('Unit.compare (та же метка)', () => {
  i = (i + 1) & MASK
  do_not_optimize(Unit.compare(twins[i], twins[i]))
})

results['compare/object'] = await gauge('compare (land/lww)', () => {
  i = (i + 1) & MASK
  do_not_optimize(compare(sands[i], sands[(i + 7) & MASK]))
})

const thousand = units.slice(0, 1000)
const thousandSands = sands.slice(0, 1000)

results['sort/1000'] = await gauge('sort 1000 юнитов', () => {
  do_not_optimize(thousand.slice().sort(Unit.compare))
})

results['sort/1000/object'] = await gauge('sort 1000 объектов', () => {
  do_not_optimize(thousandSands.slice().sort(compare))
})

console.log(`  → Unit.compare / compare(объект): ${round(results.compare.avg_ns / results['compare/object'].avg_ns)}×`)

// ── DataView против ручного разбора ──────────────────────────────────────────
// Спецификация говорит «поля читаются по офсетам через DataView». Мы читаем
// big-endian вручную. Причина обязана быть в числах, а не в предпочтениях.

console.log('\n══ Unit: DataView против ручного big-endian ═════════════════════')

class ViewUnit {
  constructor(buf) {
    this.bin = buf
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  }

  time() {
    return this.view.getUint32(2, false)
  }
}

const views = bins.map(buf => new ViewUnit(buf))

results['dataview/make'] = await gauge('new ViewUnit (с DataView)', () => {
  i = (i + 1) & MASK
  do_not_optimize(new ViewUnit(bins[i]))
})

results['dataview/read'] = await gauge('DataView.getUint32', () => {
  i = (i + 1) & MASK
  do_not_optimize(views[i].time())
})

results['dataview/read/cold'] = await gauge('new DataView + read', () => {
  i = (i + 1) & MASK
  do_not_optimize(new DataView(bins[i].buffer, bins[i].byteOffset, 16).getUint32(2, false))
})

// ── Память ───────────────────────────────────────────────────────────────────

function heap() {
  global.gc?.()
  global.gc?.()
  return process.memoryUsage().heapUsed
}

function weigh(label, make) {
  const count = 100_000
  const before = heap()
  // Преаллокация вместо `[]` + push (правило 6): рост массива по ходу замера сам
  // съел бы память и смазал число байт на юнит.
  const keep = new Array(count)
  for (let k = 0; k < count; k++) keep[k] = make(k)
  const after = heap()
  const per = Math.round((after - before) / count)
  console.log(`  ${label.padEnd(26)} ${per} Б на юнит`)
  if (keep.length !== count) throw new Error('набор потерян')
  return per
}

console.log('\n══ Unit: память ═════════════════════════════════════════════════')

const memory = {
  // Байты пачки уже в памяти — считаем то, что добавляет сверху вид над ними.
  view_only: weigh('parseUnit (окно)', k => parseUnit(bins[k & MASK])),
  view_and_links: weigh('окно + ссылки + value', (k) => {
    const unit = parseUnit(bins[k & MASK])
    unit.peer()
    unit.self()
    unit.head()
    unit.lead()
    unit.value()
    return unit
  }),
  own_buffer: weigh('SandUnit.make (свой буфер)', k => SandUnit.make(fields[k & MASK])),
  dataview: weigh('вид с DataView', k => new ViewUnit(bins[k & MASK])),
  plain_object: weigh('обычный объект Sand', k => ({ ...sands[k & MASK] })),
}

if (global.gc === undefined) console.log('  (запуск без --expose-gc: числа памяти шумные)')

// ── Вердикт ──────────────────────────────────────────────────────────────────

console.log('\n══ Бюджеты Unit ═════════════════════════════════════════════════')

const budget = {}
let passed = true
for (const [name, limit] of Object.entries(BUDGETS)) {
  const measured = results[name].avg_ns
  const ok = measured <= limit
  passed &&= ok
  budget[name] = { limit_ns: limit, measured_ns: measured, passed: ok }
  console.log(`  ${name.padEnd(26)} ${fmt(measured).padStart(10)} при бюджете ${fmt(limit).padStart(10)} — ${ok ? 'ПРОЙДЕН' : 'ПРОВАЛЕН'}`)
}

const memoryOk = memory.view_only <= MEMORY_BUDGET
passed &&= memoryOk
budget['memory/view'] = { limit_bytes: MEMORY_BUDGET, measured_bytes: memory.view_only, passed: memoryOk }
console.log(`  ${'memory/view'.padEnd(26)} ${String(memory.view_only).padStart(10)} Б при бюджете ${String(MEMORY_BUDGET).padStart(7)} Б — ${memoryOk ? 'ПРОЙДЕН' : 'ПРОВАЛЕН'}`)

record('unit_ns', {
  ...results,
  memory_bytes: memory,
  ratio_compare_binary_vs_object: round(results.compare.avg_ns / results['compare/object'].avg_ns),
  ratio_read_manual_vs_dataview: round(results['read/time'].avg_ns / results['dataview/read'].avg_ns),
  budget: { spec: 'бюджеты зафиксированы в bench/unit.mjs до первого замера', passed, ...budget },
})
