// Скоростной гейт S1. Числа снимаются программно и складываются в budgets.json —
// «быстро» без цифр не принимается (PRINCIPLES.md, правило 2).
import { measure } from 'mitata'
import { computed, equals, flush, ref } from '../dist/index.js'
import { record } from './_budgets.mjs'

const results = {}

async function gauge(name, fn, opts) {
  const stats = await measure(fn, opts)
  results[name] = { avg_ns: round(stats.avg), p50_ns: round(stats.p50), p99_ns: round(stats.p99) }
  console.log(
    `${name.padEnd(38)} avg ${fmt(stats.avg)}  p50 ${fmt(stats.p50)}  p99 ${fmt(stats.p99)}`,
  )
  return stats
}

const round = (n) => Math.round(n * 100) / 100
const fmt = (ns) => (ns < 1000 ? `${ns.toFixed(1)} ns` : `${(ns / 1000).toFixed(2)} µs`)

// ── 1. Базовая линия: чтение ref вне вычисления ──────────────────────────
{
  const s = ref(1)
  await gauge('ref() без подписчика', () => s())
}

// ── 2. Тёплое чтение атома: кэш валиден, пересчёта нет ───────────────────────
{
  const a = computed(function warm() {
    return 42
  })
  a()
  await gauge('computed() тёплое', () => a())
}

// ── 3. Холодный пересчёт: инвалидация + чтение ───────────────────────────────
{
  const s = ref(0)
  let i = 0
  const a = computed(function cold() {
    return s() * 2
  })
  a()
  await gauge('computed() после инвалидации', () => {
    s(++i)
    return a()
  })
}

// ── 4. Стоимость одной зависимости на пересчёте ──────────────────────────────
// Корень читает 100 сигналов; делим полное время пересчёта на 100.
{
  const sources = Array.from({ length: 100 }, (_, k) => ref(k))
  let i = 0
  const root = computed(function fanout() {
    let sum = 0
    for (const s of sources) sum += s()
    return sum
  })
  root()
  const stats = await gauge('пересчёт со 100 зависимостями', () => {
    sources[0](++i)
    return root()
  })
  results['одна зависимость на пересчёте'] = { avg_ns: round(stats.avg / 100) }
  console.log(`${'  → на одну зависимость'.padEnd(38)} ${fmt(stats.avg / 100)}`)
}

// ── 5. Цепочка: инвалидация листа, чтение корня ──────────────────────────────
{
  const leaf = ref(0)
  let node = computed(function level0() {
    return leaf()
  })
  for (let level = 1; level < 10; level++) {
    const prev = node
    node = computed(function level() {
      return prev() + 1
    })
  }
  const root = node
  root()
  let i = 0
  await gauge('цепочка из 10, инвалидация листа', () => {
    leaf(++i)
    return root()
  })
}

// ── 6. Ромб: 1000 потребителей одного источника ──────────────────────────────
{
  const source = ref(0)
  const consumers = Array.from({ length: 1000 }, () =>
    computed(function consumer() {
      return source() + 1
    }),
  )
  for (const c of consumers) c()
  let i = 0
  await gauge('1000 потребителей, чтение одного', () => {
    source(++i)
    return consumers[500]()
  })
}

// ── 7. Создание узла ─────────────────────────────────────────────────────────
{
  await gauge('computed() создание', () =>
    computed(function created() {
      return 1
    }),
  )
}

// ── 8. Структурное сравнение ─────────────────────────────────────────────────
// Работает на каждом пересчёте. Цена, которую платим за то, что пересчёт с равным
// результатом не будит подписчиков.
{
  {
    const smallA = { a: 1, b: 'x' }
    const smallB = { a: 1, b: 'x' }
    await gauge('equals: мелкий объект', () => equals(smallA, smallB))

    const listA = Array.from({ length: 100 }, (_, i) => i)
    const listB = Array.from({ length: 100 }, (_, i) => i)
    await gauge('equals: массив из 100 чисел', () => equals(listA, listB))

    const deepA = { items: listA, meta: { tag: 'x', at: 1 } }
    const deepB = { items: listB, meta: { tag: 'x', at: 1 } }
    await gauge('equals: вложенная структура', () => equals(deepA, deepB))
  }
}

flush()

record('speed_ns', results)
