// Гейт производительности S4: боевой `Land`, у которого источник истины — байты
// (ADR-016).
//
// ─── Бюджеты зафиксированы ДО первого запуска ────────────────────────────────
//
// Так требует PRINCIPLES.md: бюджет проверяет не только код, но и автора —
// промах бывает признаком того, что обещание было выдумано. Опорные числа взяты
// из трёх прототипов, замеренных под едиными условиями и ОБЯЗАТЕЛЬНО с уровнем
// пиров в индексе (без него прототип «бинарный» экономил на работе S7 и
// сравнивался как равный — см. «Замер сравнивает то, что вы уравняли»).
//
// Рядом с каждым бюджетом меряется ПОЛ ПЛАТФОРМЫ: во что тот же объём работы
// обходится примитиву движка. Бюджет ниже пола — неверный бюджет, и правится он
// замером пола, а не фактом промаха.
//
// ─── Почему файл сам себя перезапускает ──────────────────────────────────────
//
// Замер памяти без `--expose-gc` не просто неточен — он МОЛЧА врёт. `globalThis.gc?.()`
// с опциональным вызовом превращается в пустое место, мусор предыдущего прогона
// не оседает, и `memory/per-unit` выдаёт −4840 Б: число, которого не бывает.
// Прогон при этом зелёный, потому что минимум из отрицательных значений проходит
// любой бюджет сверху. Ровно тот же класс дефекта, что молчаливый пропуск
// браузерного раздела: проверка есть, сработать не может.
//
// Через `pnpm bench` флаг стоит, а `node bench/land.mjs` руками — обычное дело
// при отладке. Поэтому файл поднимает себя сам, а не полагается на то, что его
// позовут правильно.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

if (typeof globalThis.gc !== 'function') {
  const again = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { stdio: 'inherit' })
  process.exit(again.status ?? 1)
}

import { do_not_optimize, measure } from 'mitata'
import { LAND_ROOT, Land, Link, computed, fixedClock, packDecode, packEncode, packPart } from './dist/entry.js'
import { record } from './_budgets.mjs'

const ROOT = LAND_ROOT

/**
 * Бюджеты. `limit` — наносекунды, у памяти — байты на юнит.
 *
 * `why` объясняет, откуда взято число: это и есть проверка на выдуманность.
 */
const BUDGETS = {
  'build/10000': {
    limit: 4e6,
    why: 'локальная запись ≤ 400 нс/юнит: прототип на `Link` платил 799, из них ~330 — сами ссылки, а здесь байты пишутся прямо в арену',
  },
  'order/1000': {
    limit: 30e3,
    why: '21.8 мкс — группировка на Int32Array (ADR-016); + обход плотного списка детей и материализация видов',
  },
  'apply/fresh-1000': {
    limit: 400e3,
    why: '306 мкс у «ленивого» с тем же трёхуровневым индексом плюс копия байт',
  },
  'read/warm': {
    limit: 72,
    why: 'дано техзаданием S4; у прототипов 22.2 и 68.6 нс — разброс из-за карты версий против плотного массива',
  },
  'invalidate/one-of-10000': {
    limit: 1.5e3,
    why: '579 нс у «ленивого», 1.65 мкс у «бинарного»; берём нижнюю границу с запасом на трёхуровневый индекс',
  },
  'wire/adopt-10000': {
    limit: 4e6,
    why: '2.87 мс у «ленивого» (чужой буфер главой арены) + плотная нумерация трёх id на юнит',
  },
  'wire/units-10000': {
    limit: 1.5e6,
    why: 'путь ВЫДАЧИ, которого гейт раньше не касался вовсе. Пол: `SandUnit` на юнит — 56.8 нс разбора (замер S2) × 10 000 ≈ 570 мкс, плюс обход трёхуровневого индекса. Число зафиксировано ДО первого запуска',
  },
  'wire/roundtrip-10000': {
    limit: 2.5e6,
    why: 'то, что делает реплика-транзит: `units()` + `packEncode`. Пол — сумма двух: ~570 мкс на виды и 220 мкс на кодирование пачки (замер S2)',
  },
  'memory/per-unit': {
    limit: 190,
    why: '166 Б опорных (ленд с уровнем пиров, никто не читал) + 8 на обратную таблицу «номер → id» + 12 на плотный список детей и метку головы + запас',
  },
}

const results = {}
const round = n => Math.round(n * 100) / 100

const fmt = (ns) => {
  if (ns < 1000) return `${ns.toFixed(1)} ns`
  if (ns < 1e6) return `${(ns / 1000).toFixed(2)} µs`
  return `${(ns / 1e6).toFixed(3)} ms`
}

async function gauge(label, fn) {
  const stats = await measure(fn)
  console.log(`  ${label.padEnd(26)} avg ${fmt(stats.avg).padStart(10)}  p50 ${fmt(stats.p50).padStart(10)}  p99 ${fmt(stats.p99).padStart(10)}`)
  return { avg_ns: round(stats.avg), p50_ns: round(stats.p50), p99_ns: round(stats.p99) }
}

/** Однократный прогон с ручным таймером: нужен там, где повтор меняет работу. */
function timed(count, fn) {
  const started = performance.now()
  for (let i = 0; i < count; i++) fn(i)
  return ((performance.now() - started) * 1e6) / count
}

function usage() {
  // Без `--expose-gc` сюда не попасть: файл перезапускает себя в шапке. Вызов
  // обычный, а не опциональный, — молчаливое «ничего не делаем» и есть тот
  // дефект, из-за которого замер выдавал отрицательные байты.
  globalThis.gc()
  globalThis.gc()
  const mem = process.memoryUsage()
  // `heapUsed` в одиночку соврал бы в пользу байтового представления: арена
  // лежит вне кучи V8.
  return mem.heapUsed + mem.arrayBuffers
}

// ── Наборы ───────────────────────────────────────────────────────────────────

function peerOf(tag) {
  const bin = new Uint8Array(8)
  bin[0] = tag
  return Link.peer(bin)
}

const LAND_ID = Link.land(peerOf(0x11), new Uint8Array(8))

/** Плоский список: один пир вставляет `n` элементов цепочкой. */
function chain(n, tag = 0x11, clock = fixedClock(1_000_000)) {
  const land = new Land(peerOf(tag), clock)
  let lead = ROOT
  for (let i = 0; i < n; i++) lead = land.post(ROOT, lead, i).self
  return land
}

function packOf(land) {
  return packEncode([[LAND_ID, packPart({ units: land.units() })]])
}

// ── Локальная запись ─────────────────────────────────────────────────────────

console.log('\n══ S4 · Land на байтах ══════════════════════════════════════════')
console.log('\nЛокальная запись (build/10000)')

results['build/10000'] = await gauge('build/10000', () => {
  do_not_optimize(chain(10_000))
})

// Пол платформы для записи: во что обходятся сам кодек значения и копия байт,
// без индексов и без арены.
{
  const scratch = new Uint8Array(64 * 1024)
  const { varyEncode } = await import('./dist/entry.js')
  const floor = await gauge('floor/encode+memcpy', () => {
    for (let i = 0; i < 1000; i++) {
      const payload = varyEncode(i)
      scratch.set(payload, (i * 56) & 0xffc0)
    }
  })
  results['floor/encode+memcpy'] = floor
  console.log(`  → пол на юнит: ${fmt(floor.avg_ns / 1000)}`)
}

// ── Раскладка ────────────────────────────────────────────────────────────────

console.log('\nРаскладка (order/1000)')
{
  const land = chain(1000)
  const warm = land.order(ROOT)
  if (warm.length !== 1000) throw new Error(`order отдал ${warm.length} из 1000 — замер мерил бы не то`)

  results['order/1000'] = await gauge('order/1000', () => do_not_optimize(land.order(ROOT)))

  // Тот же вызов на веере вместо цепочки: у всех детей один `lead`, то есть
  // одна группа на тысячу конкурентов — единственное место, где включается
  // сортировка.
  const fan = new Land(peerOf(0x11), fixedClock(1_000_000))
  for (let i = 0; i < 1000; i++) fan.post(ROOT, ROOT, i)
  fan.order(ROOT)
  results['order/1000-fan'] = await gauge('order/1000 (веер)', () => do_not_optimize(fan.order(ROOT)))
}

// ── Приём ────────────────────────────────────────────────────────────────────

console.log('\nПриём (apply)')
{
  const source = chain(1000, 0x22)
  const units = source.units()

  results['apply/fresh-1000'] = await gauge('apply/fresh-1000', () => {
    const land = new Land(peerOf(0x11), fixedClock(1_000_000))
    land.apply(units)
    do_not_optimize(land)
  })

  // Повторная доставка — самый частый вид трафика в сети: сверка состояний
  // присылает то, что уже есть. Отдельный путь, отдельное число, бюджета нет.
  const settled = new Land(peerOf(0x11), fixedClock(1_000_000))
  settled.apply(units)
  if (settled.apply(units) !== 0) throw new Error('повторная доставка изменила состояние — приём не идемпотентен')
  results['apply/repeat-1000'] = await gauge('apply/repeat-1000', () => do_not_optimize(settled.apply(units)))
}

// ── Провод ───────────────────────────────────────────────────────────────────

console.log('\nПровод (10 000 юнитов)')
{
  const bin = packOf(chain(10_000))

  results['wire/adopt-10000'] = await gauge('wire/adopt-10000', () => {
    const land = new Land(peerOf(0x22), fixedClock(1_000_000))
    land.adopt(bin)
    do_not_optimize(land)
  })

  results['wire/apply-10000'] = await gauge('wire/apply-10000', () => {
    const land = new Land(peerOf(0x22), fixedClock(1_000_000))
    for (const [, part] of packDecode(bin)) land.apply(part.units)
    do_not_optimize(land)
  })

  // Пол: разбор пачки сам по себе. Это чужой код (S2) и его долг: `packDecode`
  // заводит `SandUnit` на каждый юнит, включая те, что не переживут LWW.
  results['floor/packDecode-10000'] = await gauge('floor/packDecode-10000', () => do_not_optimize(packDecode(bin)))

}

// ── Чтение ───────────────────────────────────────────────────────────────────

console.log('\nЧтение')
{
  const land = chain(10_000)
  const nodes = land.order(ROOT).map(view => view.self)
  for (const node of nodes) land.read(node)

  // Кольцо из 1024 узлов, а не один и тот же: чтение одного узла подряд
  // оказывается инвариантом цикла, и V8 выносит его наружу (в прототипе такая
  // редакция показывала 0.25 нс — число, которого не бывает).
  let cursor = 0
  results['read/warm'] = await gauge('read/warm', () => {
    cursor = (cursor + 1) & 1023
    do_not_optimize(land.read(nodes[cursor]))
  })

  // Пол: `Map.get` с SMI-ключом — минимум, во что обходится «найти значение по
  // номеру узла» на структуре, которую не мы пишем.
  const map = new Map()
  for (let i = 0; i < 10_000; i++) map.set(i, i)
  results['floor/map-get-smi'] = await gauge('floor/map-get-smi', () => do_not_optimize(map.get(5000)))
}

// ── Гранулярность ────────────────────────────────────────────────────────────

console.log('\nГранулярность (10 000 подписанных каналов)')
{
  const land = chain(10_000)
  const nodes = land.order(ROOT).map(view => view.self)
  const target = nodes[5000]

  // Чужой пир правит ОДИН узел много раз: каждая правка обязана быть свежее
  // предыдущей, иначе замер померил бы отвергнутый юнит (в прототипе это
  // поймала строка `invalidate/recomputed 0`, а не тест).
  const source = new Land(peerOf(0x22), fixedClock(2_000_000))
  const twin = source.nodeOf(land.idOf(target))
  const edits = []
  for (let i = 0; i < 40_000; i++) edits.push(source.write(ROOT, ROOT, twin, i).unit)

  let runs = 0
  const channels = nodes.map(node => computed(() => {
    runs += 1
    return land.read(node)
  }))
  for (const channel of channels) channel()

  runs = 0
  land.apply([edits[0]])
  for (const channel of channels) channel()
  const recomputed = runs
  console.log(`  invalidate/recomputed      ${recomputed} из ${channels.length}`)

  const channel = channels[5000]
  let cursor = 1
  timed(10_000, () => {
    land.apply([edits[cursor++]])
    channel()
  })
  const per = timed(20_000, () => {
    land.apply([edits[cursor++]])
    channel()
  })
  console.log(`  ${'invalidate/one-of-10000'.padEnd(26)} avg ${fmt(per).padStart(10)}`)

  results['invalidate/one-of-10000'] = { avg_ns: round(per) }
  results['invalidate/recomputed'] = recomputed
}

// ── Память ───────────────────────────────────────────────────────────────────

console.log('\nПамять (10 000 юнитов)')
{
  const bin = packOf(chain(10_000))

  /** Ленд, принятый с КОПИЕЙ байт: `adopt` держал бы чужой буфер, и замер считал бы память пачки. */
  const build = () => {
    const land = new Land(peerOf(0x22), fixedClock(1_000_000))
    let parts = packDecode(bin)
    for (const [, part] of parts) land.apply(part.units)
    parts = null
    return land
  }

  // Ленды НЕ выбрасываются между прогонами, и это не мелочь: двух `gc()` не
  // хватает, чтобы осел мусор предыдущего прогона, и `before` следующего
  // оказывается завышен ровно на него. Первая редакция замера показывала так
  // −0.8 Б на юнит — число, которого не бывает. С накоплением каждый прогон
  // меряет ровно один свежий ленд, а первый прогон всё равно выбрасывается: на
  // нём оседает разогрев всего, что было выше.
  const kept = []
  const samples = []
  for (let pass = 0; pass < 4; pass++) {
    const before = usage()
    kept.push(build())
    samples.push((usage() - before) / 10_000)
  }

  const perUnit = Math.min(...samples.slice(1))
  console.log(`  ${'memory/per-unit'.padEnd(26)} ${perUnit.toFixed(1)} Б  (прогоны ${samples.map(s => s.toFixed(1)).join(' / ')})`)
  results['memory/per-unit'] = round(perUnit)

  // Пол: сами байты юнитов в арене. Ниже него ленд не бывает физически.
  const floor = kept[0].bytes() / 10_000
  console.log(`  ${'floor/arena-bytes'.padEnd(26)} ${floor.toFixed(1)} Б`)
  results['floor/arena-bytes'] = round(floor)

  // Рабочее состояние: всё прочитано и на всё подписаны. Ради этого числа
  // ADR-016 и переписал вывод — память определяется числом подписок, а не
  // представлением юнита.
  {
    const land = kept[kept.length - 1]
    const before = usage()
    const channels = land.order(ROOT).map(view => computed(() => land.read(view.self)))
    for (const channel of channels) channel()
    const perRead = perUnit + (usage() - before) / 10_000
    console.log(`  ${'memory/per-unit-read'.padEnd(26)} ${perRead.toFixed(1)} Б  (+ вид, ячейка, сигнал и канал на узел)`)
    results['memory/per-unit-read'] = round(perRead)
    do_not_optimize(channels.length)
  }

  do_not_optimize(kept.length)
}

// ── Путь выдачи ──────────────────────────────────────────────────────────────
//
// Идёт ПОСЛЕДНИМ, и это не вкусовщина. `units()` заводит `SandUnit` на каждый из
// 10 000 юнитов НА КАЖДОЙ итерации — те самые +194 Б/юнит, ради отказа от которых
// источником истины сделаны байты (ADR-016). Поставленный перед разделом
// «Память», он оставлял за собой мусор, который не успевал осесть к взятию
// базовой линии: замер выдавал −4918 Б на юнит, то есть число, которого не
// бывает. Так уже ошибались в этом же файле (журнал правок, п. 1), и второй раз
// это не совпадение, а свойство соседства: аллоцирующий сценарий рядом с замером
// памяти портит замер, а не себя.
//
// До этого места гейт мерил только приём. Между тем `units()` зовётся на КАЖДОЙ
// сверке с собеседником (S7, `diff`), то есть лежит на горячем пути синхронизации.
{
  // Пачка собирается здесь заново: `bin` из раздела «Провод» лежит в его области,
  // а тащить его наружу значило бы связать два раздела ради экономии миллисекунды.
  const outbound = packOf(chain(10_000))
  const filled = new Land(peerOf(0x22), fixedClock(1_000_000))
  filled.adopt(outbound)

  console.log('\nПуть выдачи (units)')
  results['wire/units-10000'] = await gauge('wire/units-10000', () => do_not_optimize(filled.units()))

  // Полный круг «отдал — упаковал»: то, что делает реплика-транзит.
  results['wire/roundtrip-10000'] = await gauge('wire/roundtrip-10000', () => {
    do_not_optimize(packEncode([[LAND_ID, packPart({ units: filled.units() })]]))
  })
}

// ── Вердикт ──────────────────────────────────────────────────────────────────

console.log('\n══ Бюджеты S4 ═══════════════════════════════════════════════════')

let failed = 0
const verdict = {}

for (const [name, budget] of Object.entries(BUDGETS)) {
  const measured = name === 'memory/per-unit' ? results[name] : results[name]?.avg_ns
  const bytes = name === 'memory/per-unit'
  const passed = measured !== undefined && measured <= budget.limit
  if (!passed) failed += 1

  const shown = bytes ? `${measured?.toFixed(1)} Б` : fmt(measured ?? Number.NaN)
  const limit = bytes ? `${budget.limit} Б` : fmt(budget.limit)
  console.log(`${passed ? '✓' : '✗'} ${name.padEnd(26)} ${shown.padStart(10)} при бюджете ${limit.padStart(10)}`)
  if (!passed) console.log(`    почему бюджет такой: ${budget.why}`)

  verdict[name] = { limit: budget.limit, measured, passed, why: budget.why }
}

// Гранулярность — не число, а инвариант: разбудить обязан ровно один канал.
const single = results['invalidate/recomputed'] === 1
if (!single) failed += 1
console.log(`${single ? '✓' : '✗'} invalidate/recomputed      ${results['invalidate/recomputed']} при требовании 1`)
verdict['invalidate/recomputed'] = { limit: 1, measured: results['invalidate/recomputed'], passed: single }

console.log(`\nИтог: ${Object.keys(verdict).length - failed} из ${Object.keys(verdict).length} бюджетов пройдено`)

record('land_s4', { ...results, budgets: verdict })
