// Перф-гейт S4: сливаемый текст (docs/05 §8.5, строка `text/insert-100k`).
//
// ─── Чем этот раздел отличается от остальных ─────────────────────────────────
//
// Единственный бюджет, который docs/05 даёт тексту, — «вставка символа в текст
// 100 КБ: ≤ 1 мс и ≤ 3 юнита». Он и есть предмет; остальные строки заведены
// здесь и помечены как свои.
//
// Мерить его наивно нельзя дважды.
//
// 1. РАЗМЕР ТЕКСТА ОБЯЗАН БЫТЬ НАСТОЯЩИМ. 100 КБ одной строкой без переводов —
//    это ОДИН абзац, то есть та же задача, от которой уровень абзацев и спасает.
//    Здесь 100 КБ обычного текста: строки по ~78 знаков, 1458 абзацев, ~17 500
//    токенов.
//
// 2. КАЖДАЯ ВСТАВКА ОБЯЗАНА БЫТЬ ПЕРВОЙ. Вторая правка того же места идёт по
//    прогретым кэшам абзаца, и `measure()` мерил бы её, а не первую. Поэтому
//    вставки идут в РАЗНЫЕ абзацы, по одной на абзац, и цена берётся как
//    среднее по проходу, а не через `measure`.
//
// ─── Пол платформы рядом с каждым бюджетом ───────────────────────────────────
//
// PRINCIPLES.md: «Бюджет меняется только замером пола, никогда — фактом
// промаха». Пол вставки собран из той же работы примитивами движка: найти абзац
// (проход по массиву длин), перетокенизировать его (`String.match` той же
// регуляркой) и записать один юнит в ленд.

import { do_not_optimize, measure } from 'mitata'
import {
  computed,
  createSpace,
  fixedClock,
  flush,
  Land,
  Link,
  model,
  ref,
  t,
  text,
  watchEffect,
} from './dist/entry.js'
import { record } from './_budgets.mjs'

/**
 * БЮДЖЕТЫ ЗАФИКСИРОВАНЫ ДО ПЕРВОГО ЗАПУСКА.
 *
 * У каждого — `why`: откуда взято число. Бюджет без объяснения проверяет не код,
 * а память автора.
 */
const BUDGETS = {
  'text/insert-100k': {
    limit_ms: 1,
    why: 'docs/05 §8.5 дословно: вставка символа в текст 100 КБ ≤ 1 мс. Внутри — поиск абзаца по кэшированным длинам (1458 чтений готового числа), перетокенизация ОДНОГО абзаца (~78 знаков) и реконсиляция его ~14 токенов. Уровень абзацев заведён ровно под эту строку: без него пришлось бы разложить все ~18 000 токенов, а order() стоит ≈109 нс на ребёнка (замер S3) — 2 мс только на раскладку',
  },
  'text/insert-units': {
    limit_units: 3,
    why: 'docs/05 §8.5 дословно: ≤ 3 юнита на вставку символа. Счётчик, а не время: лишний юнит виден только в логе и только тому, кто его ищет. Считаются ВСЕ юниты land.size(), включая проигравших по LWW, — именно они и растут при неверной реконсиляции',
  },
  'text/read-warm': {
    limit_ns: 500,
    why: 'тёплое чтение поля — тот же бюджет, что у field/warm: текст читается ТЕМ ЖЕ каналом cell.value, и никакой скидки за то, что под ним 100 КБ, быть не должно. Путь — стрелка канала → cell.value(head) → Map.get по числу → Fiber.read',
  },
  'text/reread-100k': {
    limit_us: 1000,
    why: 'СВОЙ бюджет, строки в docs/05 нет. Первое чтение всего текста ПОСЛЕ правки: правка гасит кэш одного абзаца и кэш склейки, поэтому пересчёт — это 1458 чтений готовых строк плюс сборка 100 КБ. Пол — Array.join тех же строк, мерится рядом; 1 мс это пол с запасом, потому что поверх join лежат чтения файберов',
  },
  'text/point-100k': {
    limit_us: 500,
    why: 'СВОЙ бюджет, строки в docs/05 нет. pointAt в середине 100 КБ — это проход по длинам абзацев до нужного (729 чтений готового числа) плюс скан токенов ОДНОГО абзаца. Спуск в чужой абзац ради его длины сделал бы это чтением всего документа, и бюджет ловит именно такую регрессию',
  },
  'text/units-100k': {
    limit_units: 25000,
    why: 'СВОЙ бюджет, строки в docs/05 нет. Токенизация заведена ради экономии юнитов: посимвольное хранение тех же 100 КБ — это 100 000 юнитов по ~56 Б заголовка. Потолок 25 000 требует выигрыша НЕ МЕНЬШЕ чем вчетверо; фактическое отношение печатается рядом, и именно оно, а не потолок, идёт в текст про «на порядок меньше»',
  },
}

const round = n => Math.round(n * 100) / 100

const fmt = ns => {
  if (ns < 1000) return `${ns.toFixed(1)} ns`
  if (ns < 1e6) return `${(ns / 1000).toFixed(2)} µs`
  return `${(ns / 1e6).toFixed(3)} ms`
}

const count = n => `${n}`

const results = {}
let failed = 0

function verdict(name, measured, limit, unit = fmt) {
  const budget = BUDGETS[name]
  const ok = measured <= limit
  if (!ok) failed += 1
  console.log(
    `  ${name.padEnd(18)} ${unit(measured).padStart(11)} при бюджете ${unit(limit).padStart(11)}  — ${ok ? 'ПРОЙДЕН' : 'ПРОВАЛЕН'}`,
  )
  results[name] = { ...budget, measured, passed: ok }
  return results[name]
}

// ── Стенд ────────────────────────────────────────────────────────────────────

function peerOf(byte) {
  const bin = new Uint8Array(8)
  bin[0] = byte
  return Link.peer(bin)
}

function stand(peer = 0x11) {
  const land = new Land(peerOf(peer), fixedClock(1_000_000))
  const space = createSpace({ land, salt: new Uint8Array([1, 2, 3]), report: () => {} })
  return { land, space }
}

const Paper = model('bench-paper', { body: text() })

/**
 * 100 КБ ОБЫЧНОГО текста.
 *
 * Строки разной длины и с разными словами: одинаковые строки схлопнулись бы по
 * контентному адресу абзаца, и «1284 абзаца» превратились бы в горстку узлов —
 * замер мерил бы дедупликацию, а не текст.
 */
function corpus(bytes) {
  const words = [
    'файбер', 'ленд', 'юнит', 'пешка', 'слияние', 'реплика', 'адрес', 'токен',
    'абзац', 'каретка', 'словарь', 'список', 'запись', 'чтение', 'граф', 'кэш',
  ]
  const lines = []
  let size = 0
  let seed = 20260816
  const next = max => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
    return seed % max
  }
  while (size < bytes) {
    const line = []
    for (let i = 0; i < 10; i++) line.push(words[next(words.length)])
    line.push(String(lines.length))
    const text = `${line.join(' ')}\n`
    lines.push(text)
    size += text.length
  }
  return lines.join('')
}

const TEXT = corpus(100_000)

console.log('\n══ Модели S4: сливаемый текст ═══════════════════════════════════')
console.log(`  корпус: ${TEXT.length} знаков, ${TEXT.split('\n').length - 1} абзацев`)

// ── Постройка и цена в юнитах ────────────────────────────────────────────────

{
  const { land, space } = stand()
  const paper = space.root(Paper)

  const start = process.hrtime.bigint()
  paper.body(TEXT)
  const build = Number(process.hrtime.bigint() - start)

  const units = land.size()
  const tokens = paper.body.tokens().length

  console.log(`  постройка          ${fmt(build).padStart(11)}  (${(build / units).toFixed(0)} нс на юнит)`)
  console.log(`  токенов            ${String(tokens).padStart(11)}`)

  verdict('text/units-100k', units, BUDGETS['text/units-100k'].limit_units, count)
  const perChar = TEXT.length
  results['text/units-100k'].chars = perChar
  results['text/units-100k'].tokens = tokens
  results['text/units-100k'].vs_per_char = round(perChar / units)
  console.log(`  → против посимвольного хранения (${perChar} юнитов): в ${round(perChar / units)} раза меньше`)
}

// ── text/insert-100k и его пол ───────────────────────────────────────────────

/**
 * Пол платформы: ТА ЖЕ работа примитивами движка.
 *
 * «Та же» — не «похожая», и первая редакция этого пола была именно «похожей»:
 * она искала абзац проходом по обычному `number[]`, тогда как боевой поиск идёт
 * по МЕМОИЗИРОВАННЫМ длинам — по одному `computed.keyed` на абзац, дважды (для
 * `from` и для `to`). Разница не в оформлении: массив чисел это одно чтение
 * ячейки, канал — `Map.get` по числу плюс `Fiber.read`. Пол без них показывал
 * 10.1 мкс и объявлял отставание ×11 там, где ×11 был ценой не кода, а
 * невыполненной в поле работы.
 *
 * Полный пол: два прохода по 1458 keyed-каналам, срез строки, перетокенизация
 * той же регуляркой и один `land.write` — без него пол описывал бы работу со
 * строками, а вставка обязана доехать до ленда.
 */
const TOKENS = new RegExp(
  [
    '\\r\\n|\\r|\\n',
    '\\t+',
    '\\p{Extended_Pictographic}\\p{Emoji_Modifier}?(?:\\p{Emoji_Component}\\p{Extended_Pictographic}\\p{Emoji_Modifier}?)*',
    '\\bhttps?:\\/\\/[^\\s,.;:!?")]+(?:[,.;:!?")][^\\s,.;:!?")]+)+',
    '[ \\u00a0]?[\\p{Lu}\\p{Diacritic}\\p{N}]+[\\p{Ll}\\p{Diacritic}\\p{N}]*',
    '[ \\u00a0]?[\\p{Ll}\\p{Diacritic}\\p{N}]+',
    '\\s+(?=\\s)',
    '\\s(?![\\s\\p{Lu}\\p{Ll}\\p{Diacritic}\\p{N}])',
    '[ \\u00a0]?[^\\p{Lu}\\p{Ll}\\p{Diacritic}\\p{N}\\s]+',
    '[\\s\\S]',
  ].join('|'),
  'gu',
)

function insertFloor(runs) {
  const lines = TEXT.split(/(?<=\n)/)

  // По каналу на абзац — ровно то, чем в бою служит `aid.str`.
  const lens = computed.keyed(key => lines[key] ?? '')
  for (let i = 0; i < lines.length; i++) lens(i)

  const { land } = stand(0x22)
  const heads = []
  for (let i = 0; i < runs; i++) heads.push(land.nodeAt(9_000_000 + i))

  const seek = mark => {
    let off = mark
    let at = 0
    while (at < lines.length) {
      const len = lens(at).length
      if (off <= len) break
      off -= len
      at += 1
    }
    return off
  }

  const start = process.hrtime.bigint()
  for (let run = 0; run < runs; run++) {
    // 1. Найти абзац по смещению — ДВА прохода по мемоизированным длинам.
    const mark = ((run * 7919) % lines.length) * 78
    const off = seek(mark)
    do_not_optimize(seek(mark))
    // 2. Перетокенизировать его.
    const line = lines[Math.min(run % lines.length, lines.length - 1)]
    const patched = `${line.slice(0, off)}!${line.slice(off)}`
    do_not_optimize(patched.match(TOKENS))
    // 3. Записать один юнит.
    land.write(heads[run], 0, land.nodeAt(9_500_000 + run), 'слово', 'term')
  }
  return Number(process.hrtime.bigint() - start) / runs
}

{
  const { land, space } = stand()
  const paper = space.root(Paper)
  paper.body(TEXT)
  do_not_optimize(paper.body())

  const lines = TEXT.split(/(?<=\n)/)
  const RUNS = 200

  // Смещения — в РАЗНЫЕ абзацы, по одному на абзац: вторая правка того же
  // абзаца шла бы по прогретым кэшам, и замер мерил бы не первую вставку.
  const spots = []
  let base = 0
  for (let i = 0; i < lines.length; i++) {
    if (spots.length < RUNS && i % Math.floor(lines.length / RUNS) === 0) spots.push(base + 5)
    base += lines[i].length
  }

  // СЧИТАЮТСЯ ПОСТЫ, А НЕ РОСТ ИНДЕКСА, и это не педантизм.
  //
  // `land.size()` считает записи индекса (голова, пир, self). Вставка буквы
  // ВНУТРЬ слова не рождает токен — она заменяет значение существующего, то есть
  // кладёт новую ВЕРСИЮ того же (голова, пир, self), и индекс не растёт вовсе:
  // первая редакция этого замера показывала честный ноль и не мерила ничего.
  // Бюджет docs/05 говорит про юниты, которые уедут собеседнику, а это ровно
  // число вызовов `land.write`.
  const plain = land.write.bind(land)
  let posts = 0
  land.write = (...args) => {
    posts += 1
    return plain(...args)
  }

  const before = land.size()
  const start = process.hrtime.bigint()
  for (let i = 0; i < spots.length; i++) {
    const at = spots[i] + i
    paper.body.write('ы', at, at)
  }
  const spent = Number(process.hrtime.bigint() - start) / spots.length
  const units = posts / spots.length
  const grown = (land.size() - before) / spots.length
  land.write = plain

  const floor = insertFloor(RUNS)

  console.log('')
  verdict('text/insert-100k', spent, BUDGETS['text/insert-100k'].limit_ms * 1e6)
  results['text/insert-100k'].floor_ns = round(floor)
  results['text/insert-100k'].over_floor = round(spent / floor)
  console.log(`  → пол платформы (два прохода по 1458 keyed-каналам + токенизация + один land.write): ${fmt(floor)}, отношение ×${round(spent / floor)}`)

  verdict('text/insert-units', Math.ceil(units), BUDGETS['text/insert-units'].limit_units, count)
  results['text/insert-units'].avg_posts = round(units)
  results['text/insert-units'].avg_index_growth = round(grown)
  console.log(`  → из них новых записей индекса: ${round(grown)} (вставка внутрь слова заменяет значение токена, а не рождает второй)`)

  // ── text/reread-100k: полное чтение ПОСЛЕ правки ──────────────────────────
  {
    const at = spots[0] + 1
    paper.body.write('ю', at, at)
    const from = process.hrtime.bigint()
    do_not_optimize(paper.body())
    const spentRead = Number(process.hrtime.bigint() - from)

    // Пол: `join` тех же строк. С ПРОГРЕВОМ и по среднему из 20 прогонов —
    // единственный холодный вызов `join` на 1458 строках стоил 547 мкс, то есть
    // пол выходил ВЫШЕ измеряемого, и отношение получалось 0.9. Пол ниже цели —
    // всегда признак того, что мерили разную работу, а не того, что код быстрее
    // платформы.
    const parts = paper.body.paragraphs()
    for (let i = 0; i < 5; i++) do_not_optimize(parts.join(''))
    const joinFrom = process.hrtime.bigint()
    for (let i = 0; i < 20; i++) do_not_optimize(parts.join(''))
    const joinCost = Number(process.hrtime.bigint() - joinFrom) / 20

    console.log('')
    verdict('text/reread-100k', spentRead, BUDGETS['text/reread-100k'].limit_us * 1000)
    results['text/reread-100k'].floor_ns = round(joinCost)
    results['text/reread-100k'].over_floor = round(spentRead / joinCost)
    console.log(`  → пол платформы (Array.join тех же ${parts.length} строк): ${fmt(joinCost)}, отношение ×${round(spentRead / joinCost)}`)
  }

  // ── text/point-100k ───────────────────────────────────────────────────────
  {
    const middle = Math.floor(TEXT.length / 2)
    do_not_optimize(paper.body.pointAt(middle))

    const from = process.hrtime.bigint()
    for (let i = 0; i < 50; i++) do_not_optimize(paper.body.pointAt(middle + i))
    const spentPoint = Number(process.hrtime.bigint() - from) / 50

    console.log('')
    verdict('text/point-100k', spentPoint, BUDGETS['text/point-100k'].limit_us * 1000)
  }
}

// ── text/read-warm ───────────────────────────────────────────────────────────

/**
 * Тёплое чтение меряется ВНУТРИ ФАЙБЕРА, с подпиской.
 *
 * Вне файбера `Fiber.read` пропускает `link()`, то есть замер шёл бы по пути,
 * которым прикладной код не ходит никогда. Конструкция та же, что в `model.mjs`:
 * один эффект, K чтений в теле, перезапуск дёргается `ref`, из времени
 * вычитается тот же эффект с пустым телом.
 */
const K = 200

function fiberLoop(read) {
  const bell = ref(0)
  let sink = null
  let n = 0
  const stop = watchEffect(() => {
    bell()
    for (let i = 0; i < K; i++) sink = read()
  })
  return {
    tick: () => {
      bell(++n)
      flush()
      return sink
    },
    stop,
  }
}

{
  const { space } = stand()
  const paper = space.root(Paper)
  paper.body(TEXT)
  const channel = paper.body

  const loaded = fiberLoop(() => channel())
  const empty = fiberLoop(() => 0)
  loaded.tick()
  empty.tick()

  const full = await measure(() => do_not_optimize(loaded.tick()))
  const bare = await measure(() => do_not_optimize(empty.tick()))
  loaded.stop()
  empty.stop()

  const per = Math.max(0, (full.avg - bare.avg) / K)
  console.log('')
  verdict('text/read-warm', round(per), BUDGETS['text/read-warm'].limit_ns)
}

console.log('')
record('text_s4', results)

if (failed > 0) {
  console.log(`\n⚠️  провалено бюджетов: ${failed}`)
  process.exitCode = 1
}
