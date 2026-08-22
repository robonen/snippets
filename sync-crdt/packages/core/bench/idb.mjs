// Гейт производительности S5: хранилище на IndexedDB, в настоящем Chromium.
//
// ─── Бюджеты зафиксированы ДО первого запуска ────────────────────────────────
//
// Три числа взяты из docs/11-roadmap.md (строка S5) и не правились по факту
// замера: «бюджет меняется только замером пола, никогда — фактом промаха»
// (PRINCIPLES.md). Рядом с каждым меряется ПОЛ ПЛАТФОРМЫ — цена той же работы у
// голого IndexedDB, — и если бюджет окажется ниже пола, он не «не выполнен», он
// неверен, и это записывается прямо здесь.
//
// ─── Почему раздел не идёт в Node ────────────────────────────────────────────
//
// IndexedDB в Node нет вовсе. Подделка есть (`fake-indexeddb`, ею идёт основной
// тестовый набор), но её числа — это цена ЧУЖОГО JS поверх обычных объектов, а
// не цена платформы: ни транзакций, ни structured clone, ни LevelDB. Раздел,
// снятый с подделки, врал бы уверенно и молча.

import { inChromium, noBrowser } from './_page.mjs'
import { record } from './_budgets.mjs'

/**
 * Бюджеты стадии. Числа — из docs/11 §3, строка S5.
 *
 * `why` у каждого объясняет, откуда обещание, а `floor` называет, чем меряется
 * пол платформы для этого же гейта.
 */
const BUDGETS = {
  'load/100k': {
    limit_ms: 500,
    why: 'docs/11 §3, S5: холодная загрузка ленда из 100 000 юнитов. Это время до первого'
      + ' экрана приложения, поэтому обещание пользовательское, а не внутреннее.',
    floor: 'floor.read_ms — один getAll по тем же страницам и склейка их в образ',
  },
  'save/batch-1000': {
    limit_ms: 30,
    why: 'docs/11 §3, S5: сохранение батча из 1000 юнитов. Батч — это тик правок (docs/06 §6),'
      + ' и 30 мс это два кадра: дольше — и запись начнёт заикаться на вводе.',
    floor: 'floor.write_ms — одна транзакция с тем же числом страниц того же размера',
  },
  'file/churn-10k': {
    limit_ratio: 1.3,
    why: 'docs/11 §3, S5: после 10 000 save/delete файл ≤ 1.3× от полезного объёма.'
      + ' Это проверка того, что арена переиспользует байты перекрытых версий, а не'
      + ' растёт по числу правок (долг «Ленд S4», docs/11).',
    floor: '1.0× — образ без единой дыры; ниже единицы значения не бывает',
  },
}

/** Раскладка прогона. Вынесена, чтобы числа в отчёте читались вместе с ними. */
const PLAN = {
  batch: 1000,
  batches: 100,
  page: 4096,
  churn: 10_000,
  churnUnits: 2_000,
  churnStep: 100,
  sweepBatches: 20,
  spread: 2_000,
  spreadUnits: 5_000,
  rounds: 3,
  canaryRows: 20,
  pages: [512, 4096, 16_384, 65_536],
  batchSizes: [1, 10, 100, 1000, 10_000],
  batchUnits: 2_000,
}

const fmt = (ms) => (ms < 1 ? `${(ms * 1000).toFixed(0)} мкс` : `${ms.toFixed(2)} мс`)
const pad = (text, n) => String(text).padStart(n)

console.log('\n══ Хранилище S5: IndexedDB в Chromium ═══════════════════════════')

let data = null
let failure = null

try {
  data = await inChromium(async ({ origin, fresh }) => {
    /** Раздел в СВОЁМ контексте: разбор в `_page.mjs` и в шапке `idb-cases.mjs`. */
    async function section(name, input) {
      const { page, close } = await fresh()
      try {
        return await page.evaluate(async ([base, plan, what, given]) => {
          const api = await import(`${base}/bench/dist/entry.js`)
          const cases = await import(`${base}/bench/idb-cases.mjs`)
          const out = await cases.run(api, plan, what, given)
          return { ...out, agent: navigator.userAgent }
        }, [origin, PLAN, name, input ?? null])
      } finally {
        await close()
      }
    }

    const main = await section('main')
    const floor = await section('floor', main.main)
    const churn = await section('churn')
    const page = await section('page')
    const batch = await section('batch')
    const shape = await section('shape')

    return {
      agent: main.agent,
      main: main.main,
      floor: floor.floor,
      churn: churn.churn,
      page: page.page,
      batch: batch.batch,
      shape: shape.shape,
      canary: {
        note: 'одна и та же транзакция голого IndexedDB до и после раздела: дрейф самой базы',
        main: main.canary,
        floor: floor.canary,
        churn: churn.canary,
        page: page.canary,
        batch: batch.canary,
        shape: shape.canary,
      },
    }
  })
} catch (error) {
  failure = error instanceof Error ? error.message : String(error)
}

if (data === null) {
  const absent = noBrowser(failure)
  console.log(
    absent
      ? `  Браузера на машине нет — раздел пропущен, это обстоятельство, а не дефект.\n  ${failure}`
      : `  ✗ ПРОВАЛЕН: браузер поднялся, но набор в нём не отработал. Это наш дефект.\n  ${failure}`,
  )
  record('idb_ms', {
    spec: 'хранилище на IndexedDB: бюджеты S5 в настоящем браузере',
    skipped: absent,
    passed: absent,
    why: failure,
  })
  if (!absent) process.exitCode = 1
} else {
  const { main, floor, churn } = data
  console.log(`  ${data.agent.split(') ').pop()}`)
  console.log(`  ленд: ${main.units} юнитов, ${(main.live_bytes / 1e6).toFixed(2)} МБ полезных,`
    + ` страница ${PLAN.page} Б`)

  console.log('\n  ── Сохранение батчами по 1000 ──────────────────────────────')
  console.log(`  первый батч            ${pad(fmt(main.save_first_ms), 12)}`)
  console.log(`  медиана 100 батчей     ${pad(fmt(main.save_median_ms), 12)}`)
  console.log(`  последний (на 99k)     ${pad(fmt(main.save_last_ms), 12)}`)
  console.log(`  худший                 ${pad(fmt(main.save_max_ms), 12)}`)
  console.log(`  ПОЛ: та же транзакция  ${pad(fmt(floor.write_ms), 12)}  (${floor.write_rows} страниц)`)

  console.log('\n  ── Холодная загрузка ───────────────────────────────────────')
  console.log(`  store.load, первая     ${pad(fmt(main.load_first_ms), 12)}  (${(main.load_bytes / 1e6).toFixed(2)} МБ)`)
  console.log(`  store.load, медиана    ${pad(fmt(main.load_ms), 12)}`)
  console.log(`  + land.adopt           ${pad(fmt(main.adopt_ms), 12)}`)
  console.log(`  ПОЛ: getAll + склейка  ${pad(fmt(floor.read_ms), 12)}  (${floor.read_rows} страниц)`)

  console.log('\n  ── Арена после 10 000 правок ───────────────────────────────')
  console.log(`  файл/полезный объём    ${pad(`${churn.stored_over_live}×`, 12)}`)
  console.log(`  файл вырос за прогон   ${pad(`${churn.grew}×`, 12)}`)
  console.log(`  юнитов осталось        ${pad(churn.units, 12)}`)

  console.log('\n  ── Развёртка по странице ───────────────────────────────────')
  console.log(`  ${'страница'.padEnd(10)}${'батч подряд'.padStart(13)}${'load'.padStart(11)}`
    + `${'правка вразброс'.padStart(17)}${'Б на правку'.padStart(13)}${'файл/польза'.padStart(13)}`)
  for (const [size, item] of Object.entries(data.page)) {
    console.log(`  ${`${size} Б`.padEnd(10)}${pad(fmt(item.save_median_ms), 13)}${pad(fmt(item.load_ms), 11)}`
      + `${pad(`${item.spread_us_per_edit} мкс`, 17)}${pad(item.spread_bytes_per_edit, 13)}`
      + `${pad(`${item.stored_over_live}×`, 13)}`)
  }

  console.log(`\n  ── Развёртка по размеру батча (${PLAN.batchUnits} юнитов) ───────────────`)
  console.log(`  ${'батч'.padEnd(10)}${'транзакций'.padStart(12)}${'всего'.padStart(14)}${'на юнит'.padStart(14)}`)
  for (const [size, item] of Object.entries(data.batch)) {
    console.log(`  ${size.padEnd(10)}${pad(item.transactions, 12)}${pad(fmt(item.total_ms), 14)}`
      + `${pad(`${item.per_unit_us} мкс`, 14)}`)
  }

  console.log('\n  ── Канарейка: дрейф самой базы внутри раздела ──────────────')
  console.log('  (одна и та же транзакция голого IndexedDB до и после раздела;')
  console.log('   каждый раздел идёт в СВОЁМ контексте браузера — иначе дрейф ×23.7 на прогон)')
  for (const [what, item] of Object.entries(data.canary)) {
    if (what === 'note') continue
    console.log(`  ${what.padEnd(10)}${pad(fmt(item.before_ms), 10)} →${pad(fmt(item.after_ms), 10)}`
      + `${pad(`×${item.drift}`, 10)}`)
  }

  console.log('\n  ── Цена зеркала и цена durability ──────────────────────────')
  for (const [what, item] of Object.entries(data.shape)) {
    console.log(`  ${what.padEnd(20)}${pad(fmt(item.save_median_ms), 12)}`
      + `${pad(`${(item.stored_bytes / 1024).toFixed(0)} КиБ`, 14)}`
      + `${pad(`записано ${(item.written_bytes / 1024).toFixed(0)} КиБ`, 24)}`)
  }

  // ── Вердикт ────────────────────────────────────────────────────────────────
  const verdicts = {
    'load/100k': { measured: main.load_ms, limit: BUDGETS['load/100k'].limit_ms, floor: floor.read_ms },
    'save/batch-1000': {
      measured: main.save_median_ms,
      limit: BUDGETS['save/batch-1000'].limit_ms,
      floor: floor.write_ms,
    },
    'file/churn-10k': { measured: churn.stored_over_live, limit: BUDGETS['file/churn-10k'].limit_ratio, floor: 1 },
  }

  console.log('\n══ Бюджеты S5 ═══════════════════════════════════════════════════')
  let passed = true
  const budget = {}

  for (const [name, item] of Object.entries(verdicts)) {
    const ok = item.measured <= item.limit
    const belowFloor = item.limit < item.floor
    passed &&= ok

    const unit = name === 'file/churn-10k' ? '×' : ' мс'
    console.log(
      `  ${name.padEnd(18)}${pad(item.measured + unit, 12)} при бюджете ${pad(item.limit + unit, 10)}`
      + `  пол ${pad(round(item.floor) + unit, 10)} — ${ok ? 'ПРОЙДЕН' : 'ПРОВАЛЕН'}`
      + (belowFloor ? '  ⚠️ БЮДЖЕТ НИЖЕ ПОЛА — он неверен, а не не выполнен' : ''),
    )

    budget[name] = {
      ...BUDGETS[name],
      measured: item.measured,
      floor_ms: round(item.floor),
      over_floor: round(item.measured / item.floor),
      passed: ok,
      budget_below_floor: belowFloor,
    }
  }

  record('idb_ms', {
    spec: 'хранилище на IndexedDB: бюджеты S5 в настоящем браузере (docs/11 §3, S5)',
    chromium: data.agent,
    plan: PLAN,
    main,
    floor,
    churn,
    page: data.page,
    batch: data.batch,
    shape: data.shape,
    budget: { passed, ...budget },
  })

  if (!passed) process.exitCode = 1
}

function round(n) {
  return Math.round(n * 1000) / 1000
}
