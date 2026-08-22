// Гейт формы объектов. Запускать: node --allow-natives-syntax bench/shapes.mjs
//
// Проверяем то, ради чего Fiber сделан ОДНИМ классом с полем-тегом `temp`, а не парой
// подклассов: у подкласса другой прототип, значит другой скрытый класс, значит каждое
// обращение к `cache` на общем пути видит две формы вместо одной.
import { computed, getTask, ref } from '../dist/index.js'

const fails = []

function check(name, ok, hint) {
  console.log(`${ok ? '✔' : '✘'} ${name}`)
  if (!ok) {
    fails.push(name)
    if (hint !== undefined) console.log(`    ${hint}`)
  }
}

// Атом: долгоживущий узел
const first = computed(function first() {
  return 1
})
const second = computed(function second() {
  return 2
})
first()
second()

// Задача: одноразовый узел. Вне вычисления активного подписчика нет, поэтому
// getTask всегда создаёт новую.
const task = getTask(undefined, function watchEffect() {
  return 3
}, [])
task()

const sig = ref(0)
sig()

check('два computed — один скрытый класс', %HaveSameMap(first, second))
check(
  'computed и задача — один скрытый класс',
  %HaveSameMap(first, task),
  'разошлись формы: значит подклассы или поля, добавленные после конструктора',
)

// Сигнал — отдельный класс, и это осознанно: у него нет ни кэша, ни задачи.
// Проверяем лишь, что все сигналы одинаковы между собой.
const sig2 = ref('x')
sig2()
check('два ref — один скрытый класс', %HaveSameMap(sig.node, sig2.node))

// Форма не должна разъезжаться после того, как узел пожил: приостанавливался,
// хранил ошибку, был инвалидирован.
const broken = computed(function broken() {
  throw new Error('x')
})
try {
  broken()
} catch {
  /* ошибка кэшируется как значение — это штатный путь */
}

const gate = new Promise(() => {})
const load = () => gate
const suspended = computed(function suspended() {
  return load()
})
try {
  suspended()
} catch {
  /* приостановка */
}

check('computed с ошибкой сохранил форму', %HaveSameMap(first, broken))
check('приостановленный computed сохранил форму', %HaveSameMap(first, suspended))

console.log(`\nОптимизационный статус узла: ${%GetOptimizationStatus(first.read)}`)

if (fails.length > 0) {
  console.error(`\nПРОВАЛ: ${fails.length} проверок формы`)
  process.exit(1)
}
console.log('\nВсе проверки формы пройдены')
