// Гейт «не разоптимизировалось». Запускать: node --allow-natives-syntax bench/assert-opt.mjs
//
// Бенчмарк ловит потерю производительности постфактум и на глаз. Этот тест ловит
// внесённый деопт сразу и по имени функции: прогреваем горячий путь, просим V8
// оптимизировать, гоняем реальный сценарий и проверяем, что оптимизация уцелела.
import { Fiber, computed, flush, isSuspend, ref, sync } from '../dist/index.js'

const HOT = [
  ['Fiber.read', Fiber.prototype.read],
  ['Fiber.update', Fiber.prototype.update],
  ['Fiber.put', Fiber.prototype.put],
]

const fails = []

function status(fn) {
  const bits = %GetOptimizationStatus(fn)
  return {
    bits,
    optimized: (bits & 16) !== 0,
    turbofan: (bits & 64) !== 0,
    maglev: (bits & 32) !== 0,
    interpreted: (bits & 128) !== 0,
  }
}

// ── Прогрев на типовой нагрузке ──────────────────────────────────────────────
const source = ref(0)
const derived = computed(function derived() {
  return source() * 2
})
const root = computed(function root() {
  return derived() + 1
})

for (const [, fn] of HOT) %PrepareFunctionForOptimization(fn)

for (let i = 0; i < 200_000; i++) {
  source(i)
  root()
}

for (const [, fn] of HOT) %OptimizeFunctionOnNextCall(fn)
source(-1)
root()

const warm = HOT.map(([name, fn]) => [name, status(fn)])
for (const [name, state] of warm) {
  console.log(
    `${name.padEnd(16)} прогрет: ${state.optimized ? 'оптимизирован' : 'НЕ оптимизирован'}` +
      `${state.turbofan ? ' (turbofan)' : state.maglev ? ' (maglev)' : ''}`,
  )
}

// ── Реальный сценарий: ошибки, приостановки, инвалидации вперемешку ──────────
const gate = Promise.resolve('v')
const load = () => gate

const broken = computed(function broken() {
  throw new Error('ожидаемая ошибка')
})
const waiting = computed(function waiting() {
  return sync(load)
})

for (let round = 0; round < 5_000; round++) {
  source(round)
  root()

  try {
    broken()
  } catch {
    /* ошибка — штатное закэшированное значение */
  }

  try {
    waiting()
  } catch (error) {
    if (!isSuspend(error)) throw error
  }
}
flush()

// ── Проверка после сценария ──────────────────────────────────────────────────
console.log()
for (const [name, fn] of HOT) {
  const state = status(fn)
  const ok = state.optimized
  console.log(
    `${ok ? '✔' : '✘'} ${name.padEnd(16)} после сценария: ` +
      `${ok ? 'оптимизирован' : `РАЗОПТИМИЗИРОВАН (bits=${state.bits})`}`,
  )
  if (!ok) fails.push(name)
}

if (fails.length > 0) {
  console.error(
    `\nПРОВАЛ: ${fails.length} функций горячего пути потеряли оптимизацию.` +
      `\nЗапусти: node --trace-deopt bench/run.mjs 2>&1 | grep -i deopt`,
  )
  process.exit(1)
}
console.log('\nГорячий путь остался оптимизированным')
