// Численная проверка гипотезы E1: сколько объектов `Link` реально создаётся, когда
// файбер приостанавливается K раз подряд.
//
// Тест E1 доказывает переиспользование через идентичность двух рёбер. Здесь
// измеряется масштаб: если хвост не обрезается, число рёбер равно числу РАЗЛИЧНЫХ
// зависимостей, а не числу перезапусков.
import { computed, flush, isSuspend, ref } from '../dist/index.js'
import { record } from './_budgets.mjs'

const K = 50

function edges(node) {
  const out = []
  for (let cursor = node.node.deps; cursor !== undefined; cursor = cursor.nextDep) out.push(cursor)
  return out
}

const source = ref('s')
const gates = []
const releases = []
const loaders = []

for (let i = 0; i < K; i++) {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  gates.push(gate)
  releases.push(release)
  // Стабильные ссылки: позиционное опознание задачи сверяет саму функцию.
  loaders.push(() => gate)
}

// Импортируем sync отдельно, чтобы не тянуть его в горячий путь замера выше.
const { sync } = await import('../dist/index.js')

const view = computed(function view() {
  let acc = source()
  for (let i = 0; i < K; i++) acc += sync(loaders[i])
  return acc
})

// Все уникальные рёбра, которые файбер когда-либо держал.
const seen = new Set()
let restarts = 0

for (let step = 0; step <= K; step++) {
  try {
    view()
  } catch (error) {
    if (!isSuspend(error)) throw error
    restarts++
  }
  for (const edge of edges(view)) seen.add(edge)

  if (step < K) {
    releases[step](`v${step}`)
    await gates[step]
    flush()
  }
}

const finalEdges = edges(view)
const expected = 1 + K // сигнал + K задач

console.log(`перезапусков после приостановки: ${restarts}`)
console.log(`различных зависимостей:          ${expected}`)
console.log(`создано объектов Link:           ${seen.size}`)
console.log(`рёбер осталось после коммита:    ${finalEdges.length}`)

// Если бы хвост обрезался при приостановке, на каждом перезапуске пересоздавались бы
// все уже собранные рёбра: сумма 1+2+…+K, то есть сотни против десятков.
const naive = ((K + 1) * (K + 2)) / 2
console.log(`было бы при обрезке хвоста:      ~${naive}`)

record('links', {
  перезапусков: restarts,
  различных_зависимостей: expected,
  создано_Link: seen.size,
  было_бы_при_обрезке: naive,
})

if (seen.size > expected) {
  console.error(`\nПРОВАЛ: рёбер создано больше, чем различных зависимостей`)
  process.exit(1)
}
console.log(`\nПереиспользование подтверждено: ${seen.size} ≤ ${expected}`)
