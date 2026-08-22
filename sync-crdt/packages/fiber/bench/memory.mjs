// Гейт памяти. Запускать: node --expose-gc bench/memory.mjs
//
// Два бюджета из docs/11-roadmap.md, стадия S1:
//   • тёплое чтение канала — 0 аллокаций;
//   • узел графа — не дороже эталонного объекта с тем же числом полей.
import { Fiber, computed, flush, ref } from '../dist/index.js'
import { record } from './_budgets.mjs'

if (typeof globalThis.gc !== 'function') {
  console.error('нужен флаг --expose-gc')
  process.exit(1)
}

const settle = () => {
  globalThis.gc()
  globalThis.gc()
  return process.memoryUsage().heapUsed
}

const fails = []
const measured = {}
function check(name, ok, detail, value) {
  console.log(`${ok ? '✔' : '✘'} ${name} — ${detail}`)
  if (!ok) fails.push(name)
  if (value !== undefined) measured[name] = value
}

// ── Аллокации на тёплом чтении ───────────────────────────────────────────────
{
  const a = computed(function warm() {
    return 42
  })
  a()

  const ROUNDS = 2_000_000
  // Прогрев, чтобы измерять оптимизированный код, а не путь интерпретатора.
  for (let i = 0; i < 100_000; i++) a()

  const before = settle()
  let sink = 0
  for (let i = 0; i < ROUNDS; i++) sink += a()
  const after = process.memoryUsage().heapUsed

  const perOp = (after - before) / ROUNDS
  check(
    'тёплое чтение computed',
    perOp < 1,
    `${perOp.toFixed(4)} Б/операцию (sink=${sink % 7}), бюджет < 1`,
    Math.round(perOp * 10000) / 10000,
  )
}

// ── Аллокации на чтении сигнала ──────────────────────────────────────────────
{
  const s = ref(1)
  const ROUNDS = 2_000_000
  for (let i = 0; i < 100_000; i++) s()

  const before = settle()
  let sink = 0
  for (let i = 0; i < ROUNDS; i++) sink += s()
  const after = process.memoryUsage().heapUsed

  const perOp = (after - before) / ROUNDS
  check(
    'чтение ref',
    perOp < 1,
    `${perOp.toFixed(4)} Б/операцию (sink=${sink % 7}), бюджет < 1`,
    Math.round(perOp * 10000) / 10000,
  )
}

// ── Размер узла ──────────────────────────────────────────────────────────────
/**
 * Байт на объект. Держатель заранее заполнен, чтобы массив был плотным и не
 * перевыделялся во время замера; берём минимум из трёх прогонов — шум даёт только
 * недособранный мусор, поэтому наименьшее значение ближе всего к истине.
 */
function bytesPer(count, make) {
  let best = Infinity
  for (let rep = 0; rep < 3; rep++) {
    const holder = new Array(count).fill(null)
    const before = settle()
    for (let i = 0; i < count; i++) holder[i] = make(i)
    const after = settle()
    if (holder[count - 1] === null) throw new Error('держатель не заполнен')
    best = Math.min(best, (after - before) / count)
  }
  return best
}

{
  // Эталон: класс с тем же числом полей (14), но без всякой логики. Нужен, чтобы отличить
  // «мы что-то раздули» от «столько стоит объект с пятнадцатью полями в этом V8».
  class Reference {
    constructor() {
      this.a = undefined
      this.b = undefined
      this.c = undefined
      this.d = undefined
      this.e = undefined
      this.f = 0
      this.g = ''
      this.h = undefined
      this.i = undefined
      this.j = undefined
      this.k = undefined
      this.l = false
      this.m = false
      this.n = false
    }
  }
  const reference = bytesPer(200_000, () => new Reference())
  console.log(`  эталон: класс из 14 полей — ${reference.toFixed(1)} Б/объект`)

  const sharedTask = function shared() {
    return 1
  }
  const sharedArgs = Object.freeze([])
  const perNode = bytesPer(200_000, () =>
    new Fiber('shared()', sharedTask, undefined, sharedArgs, false),
  )
  const overhead = perNode - reference
  check(
    'Fiber — чистый объект',
    overhead <= 16,
    `${perNode.toFixed(1)} Б/узел, сверх эталона ${overhead.toFixed(1)} Б (бюджет ≤ 16)`,
    perNode,
  )
  measured['эталон 14 полей'] = reference
}

{
  // Реальное использование: канал `computed()` целиком, с пользовательским замыканием.
  // Разбивка (замерена в bench/probe.mjs): 136 Б файбер + 96 Б замыкание-канал +
  // 40 Б собственное свойство `fiber` + ~120 Б замыкание задачи у вызывающего.
  // Замыкание-канал — это и есть цена функционального API вместо классов.
  const perNode = bytesPer(200_000, (i) =>
    computed(function node() {
      return i
    }),
  )
  check('канал computed целиком', perNode <= 420, `${perNode.toFixed(1)} Б/канал`, perNode)
}

// ── Рост при churn: создать и отпустить много узлов ──────────────────────────
{
  const before = settle()
  for (let round = 0; round < 50; round++) {
    const source = ref(round)
    const a = computed(function churn() {
      return source() + 1
    })
    a()
    source(round + 1)
    a()
  }
  flush()
  const after = settle()
  const leaked = after - before
  check('churn из 50 циклов', leaked < 200_000, `остаточно ${leaked} Б`, leaked)
}

record('memory_bytes', measured)

if (fails.length > 0) {
  console.error(`\nПРОВАЛ: ${fails.length} бюджетов памяти`)
  process.exit(1)
}
console.log('\nВсе бюджеты памяти в норме')
