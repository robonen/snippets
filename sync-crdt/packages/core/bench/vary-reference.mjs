// Цена перекрёстной сверки: боевой разбор против независимого.
//
// `referenceDecode` — не продукт, а измерительный прибор: вторая реализация
// формата, написанная по описанию, чтобы `varyDecode` было с чем сверить. Мерить
// её всё равно надо, и по двум причинам.
//
// Первая — про тесты. Сверка гоняется на 45 000 прогонов в `vary-diff.prop.test.ts`,
// и её цена это цена каждого CI-прогона. Отсюда единственный здешний бюджет:
// независимый разбор не медленнее боевого в 60 раз. Число выбрано ДО замера из
// бюджета времени: 45 000 прогонов должны укладываться в единицы секунд.
//
// Вторая — про сам кодек. Прибор написан прямолинейно: `bigint` вместо чисел,
// свой разбор UTF-8 вместо `TextDecoder`, проверка каждого правила отдельным
// проходом. Разрыв между ним и боевым разбором и есть цена всей оптимизации из
// `vary.ts`, выраженная числом. Без него «быстро» — слово без масштаба.
import { do_not_optimize, measure } from 'mitata'
import { referenceDecode, varyDecode, varyEncode, varyEqual } from './dist/entry.js'
import { record } from './_budgets.mjs'

const round = (n) => Math.round(n * 100) / 100

const fmt = (ns) => {
  if (ns < 1000) return `${ns.toFixed(1)} ns`
  if (ns < 1e6) return `${(ns / 1000).toFixed(2)} µs`
  return `${(ns / 1e6).toFixed(3)} ms`
}

async function gauge(label, fn) {
  const stats = await measure(fn)
  console.log(`  ${label.padEnd(24)} avg ${fmt(stats.avg).padStart(10)}  p50 ${fmt(stats.p50).padStart(10)}  p99 ${fmt(stats.p99).padStart(10)}`)
  return { avg_ns: round(stats.avg), p50_ns: round(stats.p50), p99_ns: round(stats.p99) }
}

/** Во сколько раз прибор вправе быть медленнее боевого разбора. */
const SLOWDOWN_LIMIT = 60

// ── Наборы ───────────────────────────────────────────────────────────────────
// Те же формы, что и в `vary.mjs`: сравнивать разборы имеет смысл только на
// одинаковых байтах. Длинные наборы урезаны — прибор на 32 КБ меряет не формат,
// а скорость `bigint`-арифметики в цикле.

function lcg(seed) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0
    return state >>> 8
  }
}

const rnd = lcg(20260815)

const blob1k = new Uint8Array(1024)
for (let i = 0; i < blob1k.length; i++) blob1k[i] = rnd() & 0xff

const arr100 = []
for (let i = 0; i < 100; i++) arr100.push(rnd() % 1_000_000)

let str1k = ''
while (str1k.length < 1024) str1k += 'lorem ipsum дольор сит амет '
str1k = str1k.slice(0, 1024)

/** Тот же вложенный объект, что и в гейте S2: сверка живёт в основном на нём. */
const nested = {
  id: 'a7f3c2e1',
  title: 'Заголовок задачи',
  done: false,
  weight: 3,
  ratio: 0.375,
  tags: ['work', 'urgent', 'q3'],
  meta: { author: 'peer-8', at: new Date(1_755_000_000_000), rev: 12n },
}

const cases = [
  ['int', 1_234_567],
  ['str-short', 'hello'],
  ['str-1k', str1k],
  ['arr-100', arr100],
  ['nested', nested],
  ['blob-1k', blob1k],
]

const results = {}
const sizes = {}

// Сторож: замер сверки бессмыслен, если сверка на этих наборах расходится.
// Каждый набор проходит оба разбора, и оба обязаны дать одно значение.
for (const [name, value] of cases) {
  const bytes = varyEncode(value)
  sizes[name] = bytes.length
  if (!varyEqual(varyDecode(bytes), value)) throw new Error(`боевой разбор разошёлся на наборе «${name}»`)
  // Прибор отдаёт обычные значения, поэтому сверить его можно тем же
  // `varyEqual`: он считает равенство по байтам повторного кодирования.
  if (!varyEqual(referenceDecode(bytes), value)) throw new Error(`независимый разбор разошёлся на наборе «${name}»`)
}

console.log('\n══ Vary: боевой разбор ══════════════════════════════════════════')
for (const [name, value] of cases) {
  const bytes = varyEncode(value)
  results[`decode/${name}`] = await gauge(`${name} (${sizes[name]} Б)`, () => do_not_optimize(varyDecode(bytes)))
}

console.log('\n══ Vary: независимый разбор (прибор сверки) ═════════════════════')
for (const [name, value] of cases) {
  const bytes = varyEncode(value)
  results[`reference/${name}`] = await gauge(`${name} (${sizes[name]} Б)`, () => do_not_optimize(referenceDecode(bytes)))
}

console.log('\n══ Отношение: во сколько прибор медленнее боевого ═══════════════')
const ratio = {}
for (const [name] of cases) {
  ratio[name] = round(results[`reference/${name}`].avg_ns / results[`decode/${name}`].avg_ns)
  console.log(`  ${name.padEnd(24)} ×${ratio[name]}`)
}

// ── Цена одного прогона свойства ─────────────────────────────────────────────
// Свойство сверки — это `referenceDecode(varyEncode(x))`. Полная цена прогона
// нужна, чтобы число прогонов в тесте выбиралось замером, а не на глаз.

console.log('\n══ Цена одного прогона сверки (encode + independent decode) ═════')
const roundtrip = await gauge('nested', () => {
  do_not_optimize(referenceDecode(varyEncode(nested)))
})
const runs = 45_000
console.log(`  45 000 прогонов ≈ ${fmt(roundtrip.avg_ns * runs)} чистого счёта (без обвязки fast-check)`)

// ── Вердикт ──────────────────────────────────────────────────────────────────

console.log('\n══ Бюджет сверки ════════════════════════════════════════════════')
const worst = Object.entries(ratio).reduce((acc, item) => (item[1] > acc[1] ? item : acc))
const passed = worst[1] <= SLOWDOWN_LIMIT
console.log(`  худшее отношение: «${worst[0]}» ×${worst[1]} при пределе ×${SLOWDOWN_LIMIT} — ${passed ? 'ПРОЙДЕН' : 'ПРОВАЛЕН'}`)

record('vary_reference_ns', {
  ...results,
  bytes: sizes,
  ratio_reference_vs_decode: ratio,
  property_run_ns: roundtrip.avg_ns,
  property_runs_total_ms: round((roundtrip.avg_ns * runs) / 1e6),
  budget: {
    spec: `независимый разбор не медленнее боевого в ${SLOWDOWN_LIMIT} раз (иначе сверка на 45 000 прогонов не влезает в CI)`,
    limit_ratio: SLOWDOWN_LIMIT,
    worst_case: worst[0],
    worst_ratio: worst[1],
    passed,
    note: 'Прибор написан прямолинейно намеренно: bigint вместо чисел, свой разбор UTF-8, каждое правило каноничности отдельной проверкой. Разрыв — это цена оптимизаций vary.ts, а не дефект прибора.',
  },
})
