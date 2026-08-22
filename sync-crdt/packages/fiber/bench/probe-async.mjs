// Куда уходят 13 мкс из круга приостановки. Инструментируем сам круг, а не гадаем.
import { measure } from 'mitata'
import { computed, flush, isSuspend, ref, sync } from '../dist/index.js'

const fmt = (ns) => (ns < 1000 ? `${ns.toFixed(1)} ns` : `${(ns / 1000).toFixed(2)} µs`)

const tick = ref(0)
let loads = 0
const load = () => {
  loads++
  return Promise.resolve(loads)
}
const view = computed(function view() {
  tick()
  return sync(load)
})

let pulls = 0
let suspends = 0

async function pull(fiber) {
  for (;;) {
    pulls++
    try {
      return fiber()
    } catch (error) {
      if (!isSuspend(error)) throw error
      suspends++
      await error
      flush()
    }
  }
}

await pull(view)

// ── Сколько итераций и загрузок приходится на круг ───────────────────────────
{
  pulls = 0
  suspends = 0
  loads = 0
  const ROUNDS = 1000
  for (let i = 0; i < ROUNDS; i++) {
    tick(i + 1)
    await pull(view)
  }
  console.log(`на круг: итераций pull ${pulls / ROUNDS}, приостановок ${suspends / ROUNDS}, ` +
    `вызовов load ${loads / ROUNDS}`)
}

// ── Части круга по отдельности, синхронно ────────────────────────────────────
{
  let i = 0
  const suspendOnly = await measure(() => {
    tick(++i)
    try {
      view()
    } catch {
      /* приостановка */
    }
  })
  console.log(`приостановка:            ${fmt(suspendOnly.avg)}`)

  // Возобновление: промис уже разрешён, файбер помечен грязным — меряем только
  // повторный пересчёт, без ожидания.
  tick(++i)
  try {
    view()
  } catch (e) {
    await e
  }
  flush()
  const resumeOnly = await measure(() => view())
  console.log(`чтение после разрешения: ${fmt(resumeOnly.avg)}`)
}

// ── Круг целиком, но без mitata: ручной замер ────────────────────────────────
{
  const ROUNDS = 20_000
  // Прогрев
  for (let i = 0; i < 2000; i++) {
    tick(i + 1)
    await pull(view)
  }

  const started = process.hrtime.bigint()
  for (let i = 0; i < ROUNDS; i++) {
    tick(i + 1)
    await pull(view)
  }
  const elapsed = Number(process.hrtime.bigint() - started) / ROUNDS
  console.log(`круг, ручной замер:      ${fmt(elapsed)}`)
}

// ── Та же форма цикла, но без файберов ───────────────────────────────────────
{
  const ROUNDS = 20_000
  let counter = 0
  const bare = async () => {
    const p = Promise.resolve(++counter)
    const w1 = p.then((v) => v)
    const w2 = w1.then((v) => v)
    await w2
    return counter
  }
  for (let i = 0; i < 2000; i++) await bare()

  const started = process.hrtime.bigint()
  for (let i = 0; i < ROUNDS; i++) await bare()
  const elapsed = Number(process.hrtime.bigint() - started) / ROUNDS
  console.log(`та же цепочка без нас:   ${fmt(elapsed)}`)
}
