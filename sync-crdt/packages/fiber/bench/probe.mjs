// Диагностика двух отставаний, найденных в bench/compare.mjs: тёплое чтение ×9 и
// создание узла ×6.9. Сначала проверяем гипотезы о причине, и только потом чиним —
// иначе это гадание, а не оптимизация (PRINCIPLES.md, правило 2).
import { measure } from 'mitata'
import { computed, isSuspend } from '../dist/index.js'

const fmt = (ns) => (ns < 1000 ? `${ns.toFixed(2)} ns` : `${(ns / 1000).toFixed(2)} µs`)

async function probe(name, fn) {
  const stats = await measure(fn)
  console.log(`${name.padEnd(46)} ${fmt(stats.avg).padStart(10)}`)
  return stats.avg
}

console.log('── Гипотеза 1: isSuspend() грузит `.then` с объектных значений ──')
// `isSuspend(cache)` проверяет `typeof cache.then === 'function'`. Для числа проверка
// обрывается на `typeof === 'object'`, а для объекта доходит до загрузки свойства —
// и в реальном приложении, где в кэшах лежат объекты разных форм, это место
// становится мегаморфным.
{
  const num = computed(function num() {
    return 42
  })
  num()

  const obj = computed(function obj() {
    return { a: 1 }
  })
  obj()

  // Много разных форм в кэшах читаются через один и тот же путь `read()`.
  const shapes = []
  for (let i = 0; i < 12; i++) {
    const keys = Array.from({ length: i + 1 }, (_, k) => `k${k}`)
    const value = Object.fromEntries(keys.map((k) => [k, k]))
    const a = computed(function shaped() {
      return value
    })
    a()
    shapes.push(a)
  }

  const numeric = await probe('тёплое чтение, значение — число', () => num())
  const objectValue = await probe('тёплое чтение, значение — объект', () => obj())
  let cursor = 0
  const polymorphic = await probe('тёплое чтение, 12 разных форм по кругу', () => {
    cursor = (cursor + 1) % shapes.length
    return shapes[cursor]()
  })

  console.log(
    `\n  объект против числа: ×${(objectValue / numeric).toFixed(2)}` +
      `   много форм против одной: ×${(polymorphic / objectValue).toFixed(2)}`,
  )

  // Контроль: сама проверка в отрыве от чтения.
  const values = [42, { a: 1 }, 'str', Promise.resolve(1)]
  let vi = 0
  await probe(
    '  контроль: isSuspend() на смешанных значениях',
    () => isSuspend(values[(vi = (vi + 1) % values.length)]),
  )
}

console.log('\n── Гипотеза 2: fiberId() строит строку на каждом создании ──')
// Идентификатор нужен только логам, devtools и подменённому стеку приостановки —
// то есть почти никогда. Строить его в конструкторе каждого узла расточительно.
{
  const task = function shared() {
    return 1
  }

  const withId = await probe('computed() как сейчас', () =>
    computed(function created() {
      return 1
    }),
  )

  // Столько стоит одна только сборка идентификатора.
  const idOnly = await probe('  только построение id', () => {
    const owner = ''
    const name = task.name === '' ? 'anonymous' : task.name
    return `${owner}${name}()`
  })

  console.log(
    `\n  id больше не строится при создании: сборка строки стоит ${fmt(idOnly)}, ` +
      `создание узла — ${fmt(withId)}`,
  )
}
