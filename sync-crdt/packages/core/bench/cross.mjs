// Кросс-движковый раздел: те же сценарии в Node и в Chromium.
//
// ЗАЧЕМ. PRINCIPLES.md, правило 2: «бюджеты замеряются минимум в двух движках;
// расхождение больше 2× — повод разобраться, а не выбрать удобную цифру». До
// этого файла весь журнал снимался только с Node, и обещание было не проверено.
// Стадия S2 к тому же требует одинаковых байт в двух средах — здесь это
// проверяется ещё раз и на другом масштабе: каждый сценарий возвращает отпечаток
// своей выдачи, и отпечатки двух движков обязаны совпасть на 10 000 юнитах.
//
// КАК. Сценарии и секундомер лежат в `cross-cases.mjs`, его грузят оба движка.
// Браузеру файлы отдаёт крошечный http-сервер на localhost: страница обязана
// иметь origin, иначе `import()` в ней невозможен, а грузить бандл строкой
// значило бы мерить не то, что мы собираем.
//
// Chromium берётся у playwright, того же, на котором ездит `pnpm test:browser`.
// Если браузер не установлен — раздел честно пишет в журнал `skipped` с
// причиной, а не молчит и не падает: у бенча нет права ронять прогон.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { record } from './_budgets.mjs'
import { runAll } from './cross-cases.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)

/** Бюджеты зафиксированы ДО первого замера (PRINCIPLES.md, правило 2). */
const BUDGETS = {
  // Гейт стадии S2 (docs/11-roadmap.md) — теперь и в браузере, а не только в Node.
  'pack/decode/10000': 20e6,
  // Второй бюджет S2: кодирование значения ≤ 1 мкс.
  'vary/encode/dict': 1_000,
}

/**
 * Во сколько раз браузеру позволено быть медленнее Node на одном сценарии.
 *
 * Двойка не из воздуха: это порог из PRINCIPLES.md, за которым расхождение
 * движков перестаёт быть шумом и становится поводом разбираться.
 */
const RATIO_LIMIT = 2

const round = (n) => Math.round(n * 100) / 100

const fmt = (ns) => {
  if (ns < 1000) return `${ns.toFixed(1)} ns`
  if (ns < 1e6) return `${(ns / 1000).toFixed(2)} µs`
  return `${(ns / 1e6).toFixed(3)} ms`
}

const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html' }

/** Раздаёт `packages/core` на localhost. Только чтение, только внутри корня. */
async function serve() {
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]
    if (path === '/') {
      res.writeHead(200, { 'content-type': 'text/html' })
      // Карта импорта нужна с тех пор, как в бенч попал `Land`: он держит
      // сигналы на `RefNode`, и бандл получил голый спецификатор `@sync/fiber`
      // (рабочие зависимости tsdown оставляет внешними). В Node он разрешается
      // сам, в браузере — нет, и раздел молча уходил в «пропущено».
      res.end(
        '<!doctype html><meta charset="utf-8"><title>bench</title>'
          + '<script type="importmap">{"imports":{'
          + '"@sync/fiber":"/_fiber/index.js",'
          + '"alien-signals/system":"/_alien/system.mjs"'
          + '}}</script>',
      )
      return
    }

    // Соседний пакет отдаётся под своим префиксом: корень сервера — каталог
    // `core`, и путь наружу он справедливо отвергает. Префикс сохраняет
    // относительные импорты внутри самого бандла файбера.
    if (path.startsWith('/_fiber/') || path.startsWith('/_alien/')) {
      const inner = path.startsWith('/_fiber/')
        ? normalize(join(root, '..', 'fiber', 'dist', path.slice('/_fiber/'.length)))
        : normalize(join(root, '..', 'fiber', 'node_modules', 'alien-signals', 'esm', path.slice('/_alien/'.length)))
      readFile(inner).then(
        (body) => {
          res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
          res.end(body)
        },
        () => res.writeHead(404).end(),
      )
      return
    }

    // Нормализация с проверкой префикса: сервер живёт секунды, но выхода за
    // корень не должно быть даже у него.
    const file = normalize(join(root, path))
    if (!file.startsWith(root)) {
      res.writeHead(403).end()
      return
    }

    readFile(file).then(
      (body) => {
        const dot = file.lastIndexOf('.')
        res.writeHead(200, { 'content-type': TYPES[file.slice(dot)] ?? 'application/octet-stream' })
        res.end(body)
      },
      () => res.writeHead(404).end(),
    )
  })

  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  return { server, origin: `http://127.0.0.1:${server.address().port}` }
}

/** Тот же `runAll`, но внутри страницы. Возвращает уже готовые числа. */
async function runInChromium() {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })
  const { server, origin } = await serve()

  try {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(String(error)))

    await page.goto(origin)
    const out = await page.evaluate(async (base) => {
      const api = await import(`${base}/bench/dist/entry.js`)
      const cases = await import(`${base}/bench/cross-cases.mjs`)
      const result = await cases.runAll(api)
      return { ...result, agent: navigator.userAgent }
    }, origin)

    if (errors.length > 0) throw new Error(errors.join('\n'))
    return out
  } finally {
    await browser.close()
    server.close()
  }
}

// ── Прогон ───────────────────────────────────────────────────────────────────

console.log('\n══ Кросс-движковый прогон: Node против Chromium ══════════════════')

const node = await runAll(await import('./dist/entry.js'))
console.log(`  Node ${process.version}: отпечаток набора ${node.fixture}`)

let chrome = null
let failure = null
try {
  chrome = await runInChromium()
  console.log(`  ${chrome.agent.split(') ').pop()}: отпечаток набора ${chrome.fixture}`)
} catch (error) {
  failure = error instanceof Error ? error.message : String(error)
  console.log(`  ⚠️  Chromium не поднялся: ${failure}`)
}

const results = {}
let passed = true

if (chrome === null) {
  // «Браузера нет» и «наш код не поехал» — РАЗНЫЕ исходы, и сливать их нельзя.
  // Первое — обстоятельство машины: гейт честно пропускается. Второе — наш
  // дефект, и молчаливый пропуск делает его невидимым: ровно так S4 незаметно
  // убил двухдвижковый гейт, добавив в бандл голый спецификатор `@sync/fiber`.
  // Отличаем по тому, поднялся ли браузер вообще.
  const noBrowser = /playwright|executable doesn't exist|browserType\.launch|Cannot find package/i.test(failure ?? '')
  passed = noBrowser

  console.log(
    noBrowser
      ? '\n  Браузера на машине нет — раздел пропущен, это обстоятельство, а не дефект.'
      : '\n  ✗ ПРОВАЛЕН: браузер поднялся, но набор в нём не отработал. Это наш дефект, а не отсутствие браузера.',
  )

  record('cross_runtime_ns', {
    spec: 'один набор в двух движках: гейт S2 в обоих и расхождение ≤ 2× (PRINCIPLES.md, правило 2)',
    skipped: noBrowser,
    passed,
    why: failure,
    node: node.cases,
  })

  if (!passed) process.exitCode = 1
} else {
  const sameFixture = node.fixture === chrome.fixture
  if (!sameFixture) {
    passed = false
    console.log('  ⚠️  НАБОРЫ РАЗОШЛИСЬ: движки построили разные исходные данные, сравнение чисел не имеет смысла')
  }

  console.log('\n  сценарий                      Node        Chromium      отношение   отпечаток')
  for (const [name, item] of Object.entries(node.cases)) {
    const other = chrome.cases[name]
    const ratio = round(other.ns / item.ns)
    const same = item.check === other.check
    const withinRatio = ratio <= RATIO_LIMIT

    if (!same || !withinRatio) passed = false

    console.log(
      `  ${name.padEnd(20)} ${fmt(item.ns).padStart(11)} ${fmt(other.ns).padStart(13)}` +
      `${`${ratio.toFixed(2)}×`.padStart(12)}   ${same ? `${item.check} ✓` : `${item.check} ≠ ${other.check} ✗`}`,
    )

    results[name] = {
      note: item.note,
      node_ns: item.ns,
      chromium_ns: other.ns,
      ratio: ratio,
      same_bytes: same,
      check: same ? item.check : { node: item.check, chromium: other.check },
      within_ratio: withinRatio,
    }
  }

  console.log('\n══ Бюджеты кросс-движкового раздела ═════════════════════════════')

  const budget = {}
  for (const [name, limit] of Object.entries(BUDGETS)) {
    for (const [engine, data] of [['node', node], ['chromium', chrome]]) {
      const measured = data.cases[name].ns
      const ok = measured <= limit
      passed &&= ok
      budget[`${name}/${engine}`] = { limit_ns: limit, measured_ns: measured, passed: ok }
      console.log(
        `  ${`${name} @ ${engine}`.padEnd(34)} ${fmt(measured).padStart(11)} при бюджете ${fmt(limit).padStart(10)}` +
        ` — ${ok ? 'ПРОЙДЕН' : 'ПРОВАЛЕН'}`,
      )
    }
  }

  const worst = Object.entries(results).reduce(
    (top, [name, item]) => (item.ratio > top.ratio ? { name, ratio: item.ratio } : top),
    { name: '', ratio: 0 },
  )
  console.log(
    `  ${'худшее отношение движков'.padEnd(34)} ${`${worst.ratio.toFixed(2)}×`.padStart(11)} при пороге` +
    ` ${`${RATIO_LIMIT}×`.padStart(10)} — ${worst.ratio <= RATIO_LIMIT ? 'ПРОЙДЕН' : 'ПРОВАЛЕН'} (${worst.name})`,
  )
  console.log(`  ${'байты совпали во всех сценариях'.padEnd(34)} ${Object.values(results).every(i => i.same_bytes) ? 'ДА' : 'НЕТ'}`)

  record('cross_runtime_ns', {
    spec: 'один набор в двух движках: гейт S2 в обоих и расхождение ≤ 2× (PRINCIPLES.md, правило 2)',
    node: process.version,
    chromium: chrome.agent,
    fixture: { node: node.fixture, chromium: chrome.fixture, same: sameFixture },
    cases: results,
    budget: {
      passed,
      ratio_limit: RATIO_LIMIT,
      worst_ratio: { case: worst.name, ratio: worst.ratio, passed: worst.ratio <= RATIO_LIMIT },
      ...budget,
    },
  })
}
