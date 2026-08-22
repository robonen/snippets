// Сравнение с субстратом. Правило 2 из PRINCIPLES.md требует мерить себя против
// оригиналов: «медленнее — повод объясниться в тексте, а не молча».
//
// Сравниваем наш файберный слой с голым `alien-signals` на одних и тех же сценариях.
// Разница — это цена, которую мы платим за приостановки, идемпотентные задачи и
// автоматическую сборку. Она должна быть объяснимой, а не любой.
import { measure } from 'mitata'
import { computed as alienComputed, signal as alienSignal } from 'alien-signals'
import { computed, ref } from '../dist/index.js'
import { record } from './_budgets.mjs'

const results = {}

const round = (n) => Math.round(n * 100) / 100
const fmt = (ns) => (ns < 1000 ? `${ns.toFixed(1)} ns` : `${(ns / 1000).toFixed(2)} µs`)

// Медиана из трёх прогонов: сценарий с тысячей подписчиков даёт разброс вдвое,
// и одиночный замер приводил к выводам, которых в данных нет.
async function median(fn) {
  const runs = []
  for (let i = 0; i < 3; i++) runs.push((await measure(fn)).avg)
  return runs.sort((x, y) => x - y)[1]
}

async function duel(name, ours, theirs) {
  const a = { avg: await median(ours) }
  const b = { avg: await median(theirs) }
  const ratio = a.avg / b.avg
  results[name] = { ours_ns: round(a.avg), alien_ns: round(b.avg), ratio: round(ratio) }
  console.log(
    `${name.padEnd(34)} наш ${fmt(a.avg).padStart(9)}   alien ${fmt(b.avg).padStart(9)}   ` +
      `×${ratio.toFixed(2)}`,
  )
}

// ── 1. Тёплое чтение ─────────────────────────────────────────────────────────
{
  const ourAtom = computed(function warm() {
    return 42
  })
  ourAtom()

  const alien = alienComputed(() => 42)
  alien()

  await duel(
    'тёплое чтение',
    () => ourAtom(),
    () => alien(),
  )
}

// ── 2. Пересчёт после инвалидации ────────────────────────────────────────────
{
  const ourSource = ref(0)
  const ourAtom = computed(function cold() {
    return ourSource() * 2
  })
  ourAtom()

  const alienSource = alienSignal(0)
  const alien = alienComputed(() => alienSource() * 2)
  alien()

  let i = 0
  let j = 0
  await duel(
    'пересчёт после инвалидации',
    () => {
      ourSource(++i)
      return ourAtom()
    },
    () => {
      alienSource(++j)
      return alien()
    },
  )
}

// ── 3. Сто зависимостей ──────────────────────────────────────────────────────
{
  const ourSources = Array.from({ length: 100 }, (_, k) => ref(k))
  const ourRoot = computed(function fanout() {
    let sum = 0
    for (const s of ourSources) sum += s()
    return sum
  })
  ourRoot()

  const alienSources = Array.from({ length: 100 }, (_, k) => alienSignal(k))
  const alienRoot = alienComputed(() => {
    let sum = 0
    for (const s of alienSources) sum += s()
    return sum
  })
  alienRoot()

  let i = 0
  let j = 0
  await duel(
    'пересчёт со 100 зависимостями',
    () => {
      ourSources[0](++i)
      return ourRoot()
    },
    () => {
      alienSources[0](++j)
      return alienRoot()
    },
  )
}

// ── 4. Цепочка из 10 ─────────────────────────────────────────────────────────
{
  const ourLeaf = ref(0)
  let ourNode = computed(function level0() {
    return ourLeaf()
  })
  for (let level = 1; level < 10; level++) {
    const prev = ourNode
    ourNode = computed(function level() {
      return prev() + 1
    })
  }
  ourNode()

  const alienLeaf = alienSignal(0)
  let alienNode = alienComputed(() => alienLeaf())
  for (let level = 1; level < 10; level++) {
    const prev = alienNode
    alienNode = alienComputed(() => prev() + 1)
  }
  alienNode()

  const ourRoot = ourNode
  const alienRoot = alienNode
  let i = 0
  let j = 0
  await duel(
    'цепочка из 10',
    () => {
      ourLeaf(++i)
      return ourRoot()
    },
    () => {
      alienLeaf(++j)
      return alienRoot()
    },
  )
}

// ── 5. Тысяча потребителей ───────────────────────────────────────────────────
{
  const ourSource = ref(0)
  const ourConsumers = Array.from({ length: 1000 }, () =>
    computed(function consumer() {
      return ourSource() + 1
    }),
  )
  for (const c of ourConsumers) c()

  const alienSource = alienSignal(0)
  const alienConsumers = Array.from({ length: 1000 }, () => alienComputed(() => alienSource() + 1))
  for (const c of alienConsumers) c()

  let i = 0
  let j = 0
  await duel(
    '1000 потребителей',
    () => {
      ourSource(++i)
      return ourConsumers[500]()
    },
    () => {
      alienSource(++j)
      return alienConsumers[500]()
    },
  )
}

// ── 6. Создание узла ─────────────────────────────────────────────────────────
{
  await duel(
    'создание узла',
    () =>
      computed(function created() {
        return 1
      }),
    () => alienComputed(() => 1),
  )
}

record('vs_alien', results)

const worst = Object.entries(results).reduce((acc, [name, r]) =>
  r.ratio > (acc[1]?.ratio ?? 0) ? [name, r] : acc,
)
console.log(`\nХудшее отношение: ${worst[0]} ×${worst[1].ratio}`)
