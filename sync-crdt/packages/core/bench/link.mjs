// Скоростной гейт S2/Link: цена идентификатора на горячих операциях.
//
// Бюджеты зафиксированы до замера (PRINCIPLES.md, правило 2) и лежат в BUDGETS
// ниже. Link строится на каждый разобранный юнит и на каждый lookup в индексе,
// поэтому меряются ровно эти пять точек: из байт, из текста, печать, равенство
// и работа ключом Map. Плюс байты на ссылку — идентификаторов в памяти столько
// же, сколько юнитов.
import { do_not_optimize, measure } from 'mitata'
import { Link } from './dist/entry.js'
import { record } from './_budgets.mjs'

const round = (n) => Math.round(n * 100) / 100

const fmt = (ns) => {
  if (ns < 1000) return `${ns.toFixed(1)} ns`
  if (ns < 1e6) return `${(ns / 1000).toFixed(2)} µs`
  return `${(ns / 1e6).toFixed(3)} ms`
}

async function gauge(label, fn) {
  const stats = await measure(fn)
  console.log(`  ${label.padEnd(22)} avg ${fmt(stats.avg).padStart(10)}  p50 ${fmt(stats.p50).padStart(10)}  p99 ${fmt(stats.p99).padStart(10)}`)
  return { avg_ns: round(stats.avg), p50_ns: round(stats.p50), p99_ns: round(stats.p99) }
}

/** Бюджеты — наносекунды на операцию. Обещание, данное до первого запуска. */
const BUDGETS = {
  'from/pawn': 120,
  'parse/pawn': 400,
  'toString/cached': 10,
  'toString/cold': 500,
  'equals/same': 40,
  'map.get': 150,
}

// ── Наборы ───────────────────────────────────────────────────────────────────

/** Детерминированный LCG: бенч обязан воспроизводиться от прогона к прогону. */
function lcg(seed) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0
    return (state >>> 16) & 0xff
  }
}

/** `count` разных 22-байтовых пешек: ключи в индексе не повторяются. */
function bins(count, size = 22) {
  const rnd = lcg(20260815)
  const out = []
  for (let i = 0; i < count; i++) {
    const bin = new Uint8Array(size)
    for (let b = 0; b < size; b++) bin[b] = rnd()
    // Последний байт держим ненулевым: канонизация иначе укоротит ссылку и
    // набор перестанет быть однородным по уровню.
    bin[size - 1] |= 1
    out.push(bin)
  }
  return out
}

const COUNT = 1024
const MASK = COUNT - 1

const pawnBins = bins(COUNT)
const pawnLinks = pawnBins.map(bin => Link.from(bin))
const pawnStrs = pawnLinks.map(link => link.str)
const pawnKeys = pawnLinks.map(link => link.key())

// Копии тех же значений: `equals` обязан дойти до конца, иначе меряется выход
// по первому байту, а не сравнение.
const twins = pawnBins.map(bin => Link.from(bin))

const land = Link.from(pawnBins[0].slice(0, 16))
const results = {}

console.log('\n══ Link: построение и печать ════════════════════════════════════')

let i = 0
results['from/pawn'] = await gauge('Link.from (22 Б)', () => {
  i = (i + 1) & MASK
  do_not_optimize(Link.from(pawnBins[i]))
})

results['parse/pawn'] = await gauge('Link.parse (32 симв.)', () => {
  i = (i + 1) & MASK
  do_not_optimize(Link.parse(pawnStrs[i]))
})

results['toString/cached'] = await gauge('toString (кэш)', () => {
  i = (i + 1) & MASK
  do_not_optimize(pawnLinks[i].toString())
})

results['toString/cold'] = await gauge('from + toString', () => {
  i = (i + 1) & MASK
  do_not_optimize(Link.from(pawnBins[i]).toString())
})

console.log('\n══ Link: сравнение и ключ Map ═══════════════════════════════════')

results['equals/same'] = await gauge('equals (равные)', () => {
  i = (i + 1) & MASK
  do_not_optimize(pawnLinks[i].equals(twins[i]))
})

results['equals/other'] = await gauge('equals (разные)', () => {
  i = (i + 1) & MASK
  do_not_optimize(pawnLinks[i].equals(twins[(i + 1) & MASK]))
})

const map = new Map()
for (let k = 0; k < COUNT; k++) map.set(pawnKeys[k], k)

results['map.get'] = await gauge('map.get(link.key())', () => {
  i = (i + 1) & MASK
  do_not_optimize(map.get(pawnLinks[i].key()))
})

results['map.get/cold'] = await gauge('map.get(from(bin).key())', () => {
  i = (i + 1) & MASK
  do_not_optimize(map.get(Link.from(pawnBins[i]).key()))
})

console.log('\n══ Link: относительная форма ════════════════════════════════════')

const inLand = pawnBins.map((bin) => {
  const own = bin.slice()
  own.set(land.bin, 0)
  return Link.from(own)
})
const related = inLand.map(link => link.relate(land))

results.relate = await gauge('relate (свой ленд)', () => {
  i = (i + 1) & MASK
  do_not_optimize(inLand[i].relate(land))
})

results.resolve = await gauge('resolve', () => {
  i = (i + 1) & MASK
  do_not_optimize(related[i].resolve(land))
})

results.xor = await gauge('xor', () => {
  i = (i + 1) & MASK
  do_not_optimize(pawnLinks[i].xor(land))
})

// ── Память ───────────────────────────────────────────────────────────────────
// Ссылок в памяти столько же, сколько юнитов, поэтому байты на ссылку — такой же
// бюджет, как и наносекунды. Меряется отдельно для «только байты» и для «байты
// плюс посчитанный текст»: кэш текста платный, и цена должна быть видна.

function heap() {
  global.gc?.()
  global.gc?.()
  return process.memoryUsage().heapUsed
}

function weigh(label, make) {
  const count = 100_000
  const before = heap()
  // Преаллокация вместо `[]` + push (правило 6): рост массива по ходу замера сам
  // съел бы память и смазал число байт на ссылку.
  const keep = new Array(count)
  for (let k = 0; k < count; k++) keep[k] = make(k)
  const after = heap()
  const perLink = Math.round((after - before) / count)
  console.log(`  ${label.padEnd(22)} ${perLink} Б на ссылку`)
  // Ссылка обязана дожить до замера, иначе меряется работа GC, а не память.
  if (keep.length !== count) throw new Error('набор потерян')
  return perLink
}

console.log('\n══ Link: память ═════════════════════════════════════════════════')

const memory = {
  bytes_only: weigh('bin', k => Link.from(pawnBins[k & MASK])),
  bytes_and_text: weigh('bin + str', (k) => {
    const link = Link.from(pawnBins[k & MASK])
    link.toString()
    return link
  }),
}

if (global.gc === undefined) console.log('  (запуск без --expose-gc: числа памяти шумные)')

// ── Вердикт ──────────────────────────────────────────────────────────────────

console.log('\n══ Бюджеты Link ═════════════════════════════════════════════════')

const budget = {}
let passed = true
for (const [name, limit] of Object.entries(BUDGETS)) {
  const measured = results[name].avg_ns
  const ok = measured <= limit
  passed &&= ok
  budget[name] = { limit_ns: limit, measured_ns: measured, passed: ok }
  console.log(`  ${name.padEnd(22)} ${fmt(measured).padStart(10)} при бюджете ${fmt(limit).padStart(10)} — ${ok ? 'ПРОЙДЕН' : 'ПРОВАЛЕН'}`)
}

record('link_ns', {
  ...results,
  memory_bytes: memory,
  budget: { spec: 'бюджеты зафиксированы в bench/link.mjs до первого замера', passed, ...budget },
})
