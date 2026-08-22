// Асинхронный путь: сколько стоит приостановка и не текут ли одноразовые задачи.
// До сих пор мерился только синхронный путь, хотя вся модель существует ради этого.
import { measure } from 'mitata'
import { computed, flush, isSuspend, setSuspendTraces, ref, sync } from '../dist/index.js'
import { record } from './_budgets.mjs'

if (typeof globalThis.gc !== 'function') {
  console.error('нужен флаг --expose-gc')
  process.exit(1)
}

const results = {}
const fails = []
const fmt = (ns) => (ns < 1000 ? `${ns.toFixed(1)} ns` : `${(ns / 1000).toFixed(2)} µs`)
const round = (n) => Math.round(n * 100) / 100

const settle = () => {
  globalThis.gc()
  globalThis.gc()
  return process.memoryUsage().heapUsed
}

async function gauge(name, fn) {
  const stats = await measure(fn)
  results[name] = { avg_ns: round(stats.avg) }
  console.log(`${name.padEnd(44)} ${fmt(stats.avg).padStart(10)}`)
  return stats.avg
}

function check(name, ok, detail, value) {
  console.log(`${ok ? '✔' : '✘'} ${name} — ${detail}`)
  if (!ok) fails.push(name)
  if (value !== undefined) results[name] = value
}

/** Прочитать, дождавшись приостановки, если она случилась. */
async function pull(fiber) {
  for (;;) {
    try {
      return fiber()
    } catch (error) {
      if (!isSuspend(error)) throw error
      await error
      flush()
    }
  }
}

// Стек приостановки стоит 12.7 мкс из 14.7 (см. bench/probe-async.mjs), поэтому по
// умолчанию выключен. Здесь меряем обе ветки — цена отладки должна быть видна.
console.log('── Стоимость приостановки ──')

// ── Полный круг: инвалидация → приостановка → разрешение → значение ──────────
{
  const tick = ref(0)
  let counter = 0
  const load = () => Promise.resolve(++counter)
  const view = computed(function view() {
    tick()
    return sync(load)
  })
  await pull(view)

  let i = 0
  await gauge('круг приостановка→возобновление', async () => {
    tick(++i)
    return await pull(view)
  })
}

// ── Базовая линия: тот же круг, но без файберов ──────────────────────────────
{
  let counter = 0
  await gauge('  базовая линия: голый await', async () => {
    return await Promise.resolve(++counter)
  })
}

// ── Из чего складывается круг ────────────────────────────────────────────────
{
  const tick = ref(0)
  let counter = 0
  const load = () => Promise.resolve(++counter)
  const view = computed(function view() {
    tick()
    return sync(load)
  })
  await pull(view)

  let i = 0
  await gauge('  из них: приостановка (read до throw)', () => {
    tick(++i)
    try {
      view()
    } catch {
      /* приостановка — ожидаемый путь */
    }
  })

  // Повторное чтение уже приостановленного файбера: значения нет, но и работы нет.
  await gauge('  из них: чтение приостановленного', () => {
    try {
      view()
    } catch {
      /* всё ещё ждём */
    }
  })

  await gauge('  из них: flush() вхолостую', () => flush())

  // Цепочка из двух промисов — столько же, сколько ждёт файбер.
  await gauge('  из них: await двух связанных промисов', async () => {
    return await Promise.resolve(1).then((v) => v)
  })
}

// ── Цена включённых трейсов приостановки ─────────────────────────────────────
{
  const tick = ref(0)
  let counter = 0
  const load = () => Promise.resolve(++counter)
  const view = computed(function view() {
    tick()
    return sync(load)
  })
  await pull(view)

  setSuspendTraces(true)
  let i = 0
  const withTraces = await gauge('круг с включёнными трейсами', async () => {
    tick(++i)
    return await pull(view)
  })
  setSuspendTraces(false)

  const without = results['круг приостановка→возобновление'].avg_ns
  console.log(`  трейсы дороже в ${(withTraces / without).toFixed(1)} раза`)
}

// ── Глубина: десять вложенных приостановок ───────────────────────────────────
{
  const DEPTH = 10
  const tick = ref(0)
  let counter = 0
  const loaders = Array.from({ length: DEPTH }, () => () => Promise.resolve(++counter))

  let node = computed(function level0() {
    tick()
    return sync(loaders[0])
  })
  for (let level = 1; level < DEPTH; level++) {
    const prev = node
    const loader = loaders[level]
    node = computed(function level() {
      return prev() + sync(loader)
    })
  }
  const root = node
  await pull(root)

  let i = 0
  const deep = await gauge(`цепочка из ${DEPTH} приостановок`, async () => {
    tick(++i)
    return await pull(root)
  })
  const single = results['круг приостановка→возобновление'].avg_ns
  console.log(`  на одну ступень: ${fmt(deep / DEPTH)} (одиночная: ${fmt(single)})`)
}

console.log('\n── Утечки одноразовых задач ──')

// ── Десять тысяч кругов: рост кучи должен быть близок к нулю ─────────────────
{
  const tick = ref(0)
  let counter = 0
  const load = () => Promise.resolve(++counter)
  const view = computed(function view() {
    tick()
    return sync(load)
  })
  await pull(view)

  const ROUNDS = 10_000
  const before = settle()
  for (let i = 0; i < ROUNDS; i++) {
    tick(i + 1)
    await pull(view)
  }
  const after = settle()

  const perRound = (after - before) / ROUNDS
  // Если бы задача переживала круг, каждый оставлял бы после себя примерно вес узла.
  check(
    'куча после 10 000 кругов',
    perRound < 16,
    `${perRound.toFixed(2)} Б/круг (вес узла ~144 Б), бюджет < 16`,
    round(perRound),
  )

  let edges = 0
  for (let cursor = view.node.deps; cursor !== undefined; cursor = cursor.nextDep) edges++
  check('рёбер после кругов', edges <= 2, `${edges} (сигнал + не более одной задачи)`, edges)
}

// ── Родитель уничтожен, пока задача ждёт ─────────────────────────────────────
{
  const ROUNDS = 5_000
  const pending = []

  const before = settle()
  for (let i = 0; i < ROUNDS; i++) {
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    const load = () => gate
    const orphan = computed(function orphan() {
      return sync(load)
    })
    try {
      orphan()
    } catch (error) {
      if (!isSuspend(error)) throw error
    }
    // Родителя выбрасываем, не дождавшись: задача осталась висеть на промисе.
    // `computed()` вешает узел на канал одним уровнем: `channel.node` и есть
    // `Fiber`. Лишнее `.node` роняло весь раздел на `undefined` — дефект самого
    // бенча, найденный при прогоне S4, а не регресс ядра.
    orphan.node.dispose()
    pending.push(release)
  }
  for (const release of pending) release('поздно')
  // Сбрасываем собственные ссылки: `release` замыкает промис, промис держит обёртки.
  // Без этой строки замер показывал утечку, которой нет, — держал её сам тест.
  pending.length = 0
  // Пять тысяч цепочек «промис → обёртка → обёртка» разбираются за несколько оборотов
  // очереди микрозадач; одного `await` не хватает, и замер показывал чужой мусор.
  await new Promise((resolve) => setTimeout(resolve, 0))
  flush()
  const after = settle()

  const perOrphan = (after - before) / ROUNDS
  check(
    'брошенный родитель с висящей задачей',
    perOrphan < 400,
    `${perOrphan.toFixed(1)} Б/шт, бюджет < 400`,
    round(perOrphan),
  )
}

record('async', results)

if (fails.length > 0) {
  console.error(`\nПРОВАЛ: ${fails.length} проверок асинхронного пути`)
  process.exit(1)
}
console.log('\nАсинхронный путь в норме')
