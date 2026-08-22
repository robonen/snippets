// Скоростной гейт S3: `order()` против референсного `orderNaive()`.
//
// Бюджет из docs/11-roadmap.md — `order()` на 1000 детей ≤ 2 мс. Отношение к
// наивной версии меряется отдельно и записывается: боевую раскладку писали ради
// него, и если отношение окажется больше единицы — это результат, а не повод
// подкрутить замер (PRINCIPLES.md, правило 2).
import { do_not_optimize, measure } from 'mitata'
import { Replica, ROOT, compare, fixedClock, order, orderNaive, resolveNaive } from './dist/entry.js'
import { record } from './_budgets.mjs'

const results = {}

const round = (n) => Math.round(n * 100) / 100

const fmt = (ns) => {
  if (ns < 1000) return `${ns.toFixed(1)} ns`
  if (ns < 1e6) return `${(ns / 1000).toFixed(2)} µs`
  return `${(ns / 1e6).toFixed(3)} ms`
}

async function gauge(label, fn) {
  const stats = await measure(fn)
  console.log(`  ${label.padEnd(14)} avg ${fmt(stats.avg).padStart(10)}  p50 ${fmt(stats.p50).padStart(10)}  p99 ${fmt(stats.p99).padStart(10)}`)
  return { avg_ns: round(stats.avg), p50_ns: round(stats.p50), p99_ns: round(stats.p99) }
}

// ── Генераторы наборов ───────────────────────────────────────────────────────
// Юниты собираются настоящей `Replica`, а не руками: метки времени, `tick` и
// арбитраж по `peer` должны быть такими же, как в бою, иначе замер меряет не то.

/** Плоский список: один пир вставляет `n` элементов цепочкой. */
function flat(n) {
  const replica = new Replica('p1', fixedClock(1_000_000))
  let lead = ROOT
  for (let i = 0; i < n; i++) lead = replica.insert(lead, i).self
  return replica
}

/** Тот же список, но 30 % элементов накрыты надгробиями. */
function tombstoned(n) {
  const replica = flat(n)
  const items = replica.order()
  // Три из каждых десяти — ровно 30 %, разбросанных по всей длине, а не пачкой
  // в начале: раскладка идёт по цепочке, и слипшиеся надгробия дали бы не тот
  // профиль обхода.
  for (let i = 0; i < items.length; i++) {
    if (i % 10 < 3) replica.remove(items[i].self)
  }
  return replica
}

/** Детерминированный LCG: бенч обязан воспроизводиться от прогона к прогону. */
function lcg(seed) {
  let state = seed >>> 0
  return (max) => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0
    return state % max
  }
}

/** `lead` для позиции `at`: нулевая позиция — начало списка. */
function leadAt(items, at) {
  return at <= 0 ? ROOT : items[at - 1].self
}

/**
 * `moves` перемещений, сделанных двумя пирами вслепую друг от друга и слитых
 * после. Конкурентные `move` — единственный штатный источник колец в цепочке
 * `lead`, а кольца это самый тяжёлый вход для обеих раскладок.
 */
function moved(n, moves) {
  const clock = fixedClock(1_000_000)
  const a = new Replica('p1', clock)
  let lead = ROOT
  for (let i = 0; i < n; i++) lead = a.insert(lead, i).self

  const b = new Replica('p2', clock)
  b.applySands(a.sands())

  const rnd = lcg(20260815)
  for (let i = 0; i < moves / 2; i++) {
    for (const replica of [a, b]) {
      const items = replica.order()
      if (items.length === 0) continue
      const target = items[rnd(items.length)]
      replica.move(target.self, leadAt(items, rnd(items.length + 1)))
    }
  }

  // Слияние до неподвижной точки: приём монотонен по решётке LWW, двух-трёх
  // раундов хватает, потолок — страховка от бесконечного цикла.
  for (let pass = 0; pass < 8; pass++) {
    const taken = a.applySands(b.sands()) + b.applySands(a.sands())
    if (taken === 0) break
  }

  return a
}

/** `heads` голов по `kids` детей в каждой — проверка цены фильтра по `head`. */
function nested(heads, kids) {
  const replica = new Replica('p1', fixedClock(1_000_000))
  const names = []
  for (let h = 0; h < heads; h++) {
    const head = `h${h}`
    names.push(head)
    let lead = ROOT
    for (let i = 0; i < kids; i++) lead = replica.insert(lead, i, head).self
  }
  return { sands: replica.sands(), heads: names }
}

// ── Прогон одного набора ─────────────────────────────────────────────────────

/** Совпадают ли выдачи поэлементно — сторож того, что меряются две одинаковые работы. */
function sameOutput(sands, head) {
  const fast = order(sands, head)
  const slow = orderNaive(sands, head)
  if (fast.length !== slow.length) return false
  for (let i = 0; i < fast.length; i++) {
    if (fast[i] !== slow[i]) return false
  }
  return true
}

/** Полный порядок из `order()`: LWW, а при полном совпадении меток — арбитр по `self`. */
function rank(a, b) {
  const lww = compare(a, b)
  if (lww !== 0) return lww
  if (a.self === b.self) return 0
  return a.self < b.self ? -1 : 1
}

/**
 * Диагностика, а не замер: доля узлов, которые в `order()` реально уходят в
 * `stalled` и укладываются потом каскадом.
 *
 * Быстрый путь `order()` держится на допущении «`lead` уложен раньше ребёнка»:
 * очередь идёт от старого к молодому, и вставка обычно моложе того, за кем
 * встала. Каждый узел, нарушивший допущение, уходит в `stalled` и разбирается
 * потом каскадом — то есть платит за карту, массив и стек вместо одной вставки.
 * `remove` и `move` постят узел заново со свежей меткой и ломают допущение для
 * всех его `lead`-детей разом. Число нужно, чтобы разворот отношения к наивной
 * версии читался как механизм, а не как загадка.
 */
function stalledShare(sands, head) {
  const winners = resolveNaive(sands, head)
  if (winners.size === 0) return 0

  // Считать «у кого `lead` свежее» недостаточно: ожидание заразно. Стоит одному
  // узлу зависнуть — и весь хвост, который стоит за ним, зависает следом, хотя
  // метки в хвосте идеально возрастают. Поэтому очередь проигрывается целиком,
  // с тем же каскадом, что и в `order()`. Дублирование логики здесь осознанное:
  // диагностика обязана мерить настоящий путь, а не пересказ намерения.
  const queue = [...winners.values()].sort((a, b) => rank(b, a))
  const placed = new Set([ROOT])
  const waiting = new Map()

  const release = (from) => {
    const stack = [from.self]
    placed.add(from.self)

    while (stack.length > 0) {
      const key = stack.pop()
      const kids = waiting.get(key)
      if (kids === undefined) continue
      waiting.delete(key)

      for (const kid of kids) {
        if (placed.has(kid.self)) continue
        placed.add(kid.self)
        stack.push(kid.self)
      }
    }
  }

  let stalled = 0
  for (const sand of queue) {
    if (!placed.has(sand.lead)) {
      stalled += 1
      const bucket = waiting.get(sand.lead)
      if (bucket === undefined) waiting.set(sand.lead, [sand])
      else bucket.push(sand)
      continue
    }
    release(sand)
  }

  return round(stalled / winners.size)
}

async function scenario(name, sands, head = ROOT) {
  const visible = order(sands, head).length
  const equal = sameOutput(sands, head)
  const stalled = stalledShare(sands, head)

  console.log(`\n${name}  (юнитов ${sands.length}, видимых ${visible}, в ожидании ${(stalled * 100).toFixed(0)} %)`)
  if (!equal) console.log('  ⚠️  order() и orderNaive() РАСХОДЯТСЯ на этом наборе')

  const fast = await gauge('order', () => do_not_optimize(order(sands, head)))
  const slow = await gauge('orderNaive', () => do_not_optimize(orderNaive(sands, head)))
  const resolve = await gauge('resolveNaive', () => do_not_optimize(resolveNaive(sands, head)))

  const ratio = round(fast.avg_ns / slow.avg_ns)
  const layout = round((fast.avg_ns - resolve.avg_ns) / fast.avg_ns)
  console.log(`  → order/orderNaive ${ratio.toFixed(2)}×${ratio > 1 ? '  (боевая МЕДЛЕННЕЕ наивной)' : ''}`)
  console.log(`  → доля раскладки в order(): ${(layout * 100).toFixed(0)} % (остальное — LWW-свёртка)`)

  results[name] = {
    sands: sands.length,
    visible,
    stalled_share: stalled,
    equal_to_naive: equal,
    order: fast,
    orderNaive: slow,
    resolveNaive: resolve,
    ratio_order_vs_naive: ratio,
    layout_share_of_order: layout,
  }

  return results[name]
}

const SIZES = [100, 1000, 10000]

console.log('\n══ Плоский список ═══════════════════════════════════════════════')
for (const n of SIZES) await scenario(`flat/${n}`, flat(n).sands())

console.log('\n══ 30 % надгробий ═══════════════════════════════════════════════')
for (const n of SIZES) await scenario(`tombstones30/${n}`, tombstoned(n).sands())

console.log('\n══ После 200 конкурентных move ══════════════════════════════════')
for (const n of SIZES) await scenario(`moved200/${n}`, moved(n, 200).sands())

console.log('\n══ Вложенность: 100 голов × 100 детей ═══════════════════════════')
{
  const { sands, heads } = nested(100, 100)
  await scenario('nested/100x100/one-head', sands, heads[50])

  // Полное чтение документа: каждая голова читается своим вызовом, и каждый
  // вызов заново фильтрует весь набор. Это и есть цена «нет индекса по head».
  const allFast = await gauge('order×100', () => {
    for (const head of heads) do_not_optimize(order(sands, head))
  })
  const allSlow = await gauge('orderNaive×100', () => {
    for (const head of heads) do_not_optimize(orderNaive(sands, head))
  })

  results['nested/100x100/all-heads'] = {
    sands: sands.length,
    visible: 100 * 100,
    order: allFast,
    orderNaive: allSlow,
    ratio_order_vs_naive: round(allFast.avg_ns / allSlow.avg_ns),
  }
}

// ── Вердикт по бюджету S3 ────────────────────────────────────────────────────
const BUDGET_NS = 2e6
const gate = results['flat/1000'].order.avg_ns

results.budget = {
  spec: 'order() на 1000 детей ≤ 2 мс (docs/11-roadmap.md, S3)',
  limit_ns: BUDGET_NS,
  measured_ns: gate,
  passed: gate <= BUDGET_NS,
}

console.log('\n══ Бюджет S3 ════════════════════════════════════════════════════')
console.log(`order() на 1000 детей: ${fmt(gate)} при бюджете ${fmt(BUDGET_NS)} — ${gate <= BUDGET_NS ? 'ПРОЙДЕН' : 'ПРОВАЛЕН'}`)

record('order_ns', results)

// Раздел Link — отдельным файлом: у него свои наборы и свои бюджеты, а общий
// журнал `budgets.json` собирается из разделов (см. `record`).
await import('./link.mjs')

// То же для Unit: свои наборы, свои бюджеты, свой раздел журнала.
await import('./unit.mjs')

// То же для Vary: свои наборы, свои бюджеты, свой раздел журнала.
await import('./vary.mjs')

// И цена перекрёстной сверки: боевой разбор против независимого. Идёт последней,
// потому что опирается на те же наборы и читается как продолжение раздела Vary.
await import('./vary-reference.mjs')

// То же для Unit: цена независимого чтения раскладки §2 и цена обещанного там же
// `memcmp` 14 байт — числом, а не догадкой.
await import('./unit-reference.mjs')

// И контейнер: гейт S2 (`packDecode` 10 000 юнитов ≤ 20 мс) плюс цена
// восстановления арены при загрузке файла хранилища.
await import('./pack.mjs')

// Гейт S4: боевой ленд на байтах. Идёт после контейнера, потому что опирается
// на него — `adopt` принимает буфер `packEncode` главой арены.
await import('./land.mjs')

// Гейт S4: слой моделей поверх ленда. Идёт после него, потому что стоит на нём:
// каждое чтение поля — это `order()` по индексу головы, а каждая запись — `post`
// с явным `self`.
await import('./model.mjs')

// Коллекции слоя моделей — своим разделом: свои наборы, свои бюджеты, свой
// раздел журнала. Идёт сразу после `model.mjs`, потому что стоит на тех же
// ячейках поля и меряет то, что построено поверх них.
await import('./model-list.mjs')

// Ссылки, вложенные части и `cast` — тоже своим разделом. Идёт после
// `model.mjs`, потому что его пол СКЛАДЫВАЕТСЯ из уже замеренных там
// `field/cold` и `doc/open`: разыменование ссылки материализует документ, и
// мерить его раньше значило бы сравнивать с числами прошлого прогона.
await import('./model-refs.mjs')

// Гейт S4: сливаемый текст. Идёт после слоя моделей, потому что стоит на нём:
// текст — это два уровня юнитов под тем же ключевым слотом, и его бюджет
// (`text/insert-100k`) меряет ровно то, ради чего заведён уровень абзацев.
await import('./text.mjs')

// Канал вкладок: доставка через настоящий BroadcastChannel и цена рукопожатия.
await import('./wire.mjs')

// Размер бандла — четвёртое измерение из «Гейта производительности», которое
// раньше считали руками. Идёт до кросс-движкового: оно быстрое и не зависит от
// того, поднимется ли Chromium.
await import('./size.mjs')

// Хранилище S5: бюджеты стадии в настоящем Chromium. Идёт перед кросс-движковым
// разделом, потому что оба поднимают браузер, а этот к тому же держит по
// контексту на раздел — пусть его страницы закроются раньше, чем начнётся
// сверка байт.
await import('./idb.mjs')

// Последним — тот же набор в двух движках. Идёт в конце, потому что поднимает
// Chromium и без него все разделы выше уже записаны: браузер, которого нет,
// не должен стоить нам журнала.
await import('./cross.mjs')
