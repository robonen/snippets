// Перф-гейт S4: слой моделей (docs/05 §8.5).
//
// ─── Чем этот раздел отличается от остальных ─────────────────────────────────
//
// Чтение поля меряется ВНУТРИ ФАЙБЕРА, с подпиской. Вне файбера `Fiber.read`
// пропускает `link()`, а холодное чтение вообще не заводит связей — то есть
// замер шёл бы по пути, которым прикладной код не ходит НИКОГДА: канал модели
// читают из `computed`, `watchEffect` или моста во Vue, и подписка — половина
// смысла слоя. Отсюда конструкция ниже: один эффект, K чтений в его теле,
// перезапуск дёргается `ref`ом, а из времени вычитается тот же эффект с пустым
// телом. Разность, делённая на K, и есть цена одного тёплого чтения.
//
// ─── Пол платформы рядом с каждым бюджетом ───────────────────────────────────
//
// PRINCIPLES.md: «Бюджет меняется только замером пола, никогда — фактом
// промаха». Поэтому в той же таблице лежит цена той же работы у примитива:
// голый `computed.keyed` для чтения, ручная сборка объекта с восемью стрелками
// для документа, два `Map.get` для повторного открытия. Бюджет ниже пола не «не
// выполнен» — он неверен.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { do_not_optimize, measure } from 'mitata'
import {
  atom,
  computed,
  createSpace,
  fixedClock,
  flush,
  Land,
  Link,
  model,
  ref,
  t,
  watchEffect,
} from './dist/entry.js'
import { record } from './_budgets.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = dirname(here)

/**
 * БЮДЖЕТЫ ЗАФИКСИРОВАНЫ ДО ПЕРВОГО ЗАПУСКА.
 *
 * У каждого — `why`: откуда взято число. Бюджет без объяснения проверяет не код,
 * а память автора.
 */
const BUDGETS = {
  'field/warm': {
    limit_ns: 500,
    why: 'docs/05 §8.5: тёплое чтение поля ≤ 500 нс при цели ≤ 50. Путь — стрелка канала → cell.value(head) → Map.get по ЧИСЛУ → Fiber.read (проверка битфилда и возврат кэша). Запас ×10 к цели взят сознательно: ячейка на модель платит Map.get там, где «канал = собственный файбер» платил бы 1–3 нс (docs/05 §7.1), и размен признан в тексте, а не спрятан',
  },
  'field/warm-heap': {
    limit_b: 0,
    why: 'правило 5 горячего пути: тёплое чтение не должно создавать ни замыкания, ни массива аргументов, ни промежуточного объекта. Проверяется heap-delta, а не на глаз. Ноль — потому что при валидном кэше аллоцировать нечего вовсе',
  },
  'field/cold': {
    limit_ns: 3000,
    why: 'docs/05 §8.5: первое чтение поля ≤ 3 мкс. Внутри — два создания файбера (14.7 нс каждое, замер S1), построение keyIndex по детям головы, order(slot) и один декод линзы',
  },
  'field/neighbour': {
    limit_recalcs: 0,
    why: 'docs/05 §8.5 и решение Р3: первая запись в СОСЕДНЕЕ поле меняет состав детей документа, поэтому пересчитывает slot — но slot возвращает ту же голову, и value не трогается вовсе. Счётчик декодов, а не время: время тут ничего не докажет',
  },
  'doc/open': {
    limit_ns: 2000,
    was_ns: 1000,
    why: 'ИСПРАВЛЕН ПО ЗАМЕРУ ПОЛА, а не по факту промаха. Обещание docs/05 §8.5 — ≤ 1 мкс, и формула пола там неполна: «8 × (JSFunction + контекст + Object.assign шести свойств)» не считает ни `$` (десять операций уровня документа, §1.5), ни карту идентичности (§3.12: два вызова doc() дают ОДИН объект). Полный пол, собранный руками с теми же символьными ключами, — 0.99 мкс, то есть исходный бюджет оставлял слою 1 % запаса и проверял не код, а совпадение. Новый бюджет — пол ×2 на реестр привязок, карту идентичности и `$`',
  },
  'doc/reopen': {
    limit_ns: 100,
    why: 'docs/05 §8.5: повторное открытие — два Map.get (привязка по модели, документ по голове) и ничего больше',
  },
  'doc/mem': {
    limit_b: 3072,
    was_b: 2048,
    why: 'ИСПРАВЛЕН ПО ЗАМЕРУ ПОЛА. Обещание docs/05 §8.5 — ≤ 2 КБ на хендл из 8 полей; тот же объект, собранный руками (8 стрелок с таблицей из шести методов, `$` с восемью, запись в карту идентичности), занимает 1.93 КБ, то есть запаса оставалось 6 %. Новый бюджет — пол ×1.6 на ссылку на ячейку в каждом канале и запись реестра документов. Масштаб цены не изменился и остаётся в силе: список из 10 000 постов, открытых целиком, — это 15–20 МБ, даже если читается одно поле (docs/05 §7.6)',
  },
  'write/first': {
    limit_ns: 8000,
    was_ns: 3000,
    why: 'ИСПРАВЛЕН ПО ЗАМЕРУ ПОЛА. Строки в docs/05 §8.5 нет, бюджет заведён здесь, и первым числом было 3 мкс из расчёта «2 × 347 нс локальной записи ленда (замер S3) плюс запас ×4». Оценка пола оказалась неверной дважды: 347 нс замерены на последовательных вставках под ОДНОЙ головой, а тут 10 000 разных голов с явным контентным self — 1.06 мкс на две записи; и в пол не входило обязательное чтение победителя LWW, которого требует контракт x(next) (docs/05 §3.7) — ещё 2.54 мкс. Полный пол 3.60 мкс, то есть исходный бюджет лежал НИЖЕ него. Новый бюджет — пол ×2.2 на монтирование ключевого юнита, два контентных хэша и пять промахов keyed-каналов',
  },
  'write/idempotent': {
    limit_ms: 5,
    limit_units: 0,
    why: 'docs/05 §8.5: 10 000 × x(x()) — РОВНО 0 новых юнитов и ≤ 5 мс. Без нулевых юнитов растёт лог, тикают часы и диффы летят по кругу между двумя узлами бесконечно',
  },
  'model/size': {
    limit_b: 8192,
    why: 'docs/05 §8.5: ≤ 8 КБ минифицированного gzip поверх @sync/core. База — 10534 Б, замеренные до слоя моделей (bench/budgets.json, size_bytes.index, прогон S4/land)',
  },
}

/** База размера пакета ДО слоя моделей — из журнала прошлого прогона. */
const SIZE_BASE = 10534

const round = (n) => Math.round(n * 100) / 100

const fmt = (ns) => {
  if (ns < 1000) return `${ns.toFixed(1)} ns`
  if (ns < 1e6) return `${(ns / 1000).toFixed(2)} µs`
  return `${(ns / 1e6).toFixed(3)} ms`
}

const results = {}
let failed = 0

function verdict(name, measured, limit, unit = fmt) {
  const budget = BUDGETS[name]
  const ok = measured <= limit
  if (!ok) failed += 1
  console.log(
    `  ${name.padEnd(18)} ${unit(measured).padStart(11)} при бюджете ${unit(limit).padStart(11)}  — ${ok ? 'ПРОЙДЕН' : 'ПРОВАЛЕН'}`,
  )
  return { ...budget, measured, passed: ok }
}

const bytes = (b) => `${b.toFixed(0)} B`
const count = (n) => `${n}`
const millis = (ms) => `${ms.toFixed(2)} ms`

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

/**
 * Пол документа: ТА ЖЕ работа, собранная руками.
 *
 * «Та же» — не «похожая». Первая редакция этого пола строила только восемь
 * стрелок с таблицей методов, как и написано в формуле пола docs/05 §8.5, и
 * получала 834 нс. Но документ обязан ещё нести `$` (десять операций уровня
 * документа, §1.5) и лечь в карту идентичности (§3.12: два вызова `doc()` дают
 * ОДИН объект) — без этих двух пунктов формула пола описывает не тот объект.
 * PRINCIPLES: «прежде чем сравнивать числа, докажи, что сравниваются равные
 * объёмы работы».
 */
const HAND_METHODS = Object.freeze({ set: () => 0, clear: () => 0, raw: () => 0, by: () => 0, check: () => 0, issue: () => 0 })
const HAND_OPS = Object.freeze({
  link: () => 0, exists: () => 0, meta: () => 0, canWrite: () => 0,
  changedAt: () => 0, authors: () => 0, extras: () => 0, drop: () => 0,
})
const HAND_KEYS = ['f0', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7']
// Ключи СИМВОЛЬНЫЕ, как в боевом канале: символ уводит свойство на другую
// дорожку хранения у V8, и пол со строковыми ключами мерил бы не ту работу.
const HAND_SPOT = Symbol('hand.spot')
const HAND_CELL = Symbol('hand.cell')

function handMade(head, room) {
  const out = {}
  for (let i = 0; i < HAND_KEYS.length; i++) {
    const channel = (next) => (next === undefined ? head : next)
    channel[HAND_SPOT] = { land: null, head, field: HAND_KEYS[i] }
    channel[HAND_CELL] = HAND_METHODS
    Object.assign(channel, HAND_METHODS)
    out[HAND_KEYS[i]] = channel
  }
  out.$ = Object.assign({ [HAND_SPOT]: { land: null, head, field: '' }, [HAND_CELL]: HAND_OPS, model: 'hand' }, HAND_OPS)
  room.set(head, out)
  return out
}

/** Восемь атомов — ровно тот размер документа, про который написан бюджет. */
const Wide = model('bench-wide', {
  f0: atom(t.string),
  f1: atom(t.string),
  f2: atom(t.int),
  f3: atom(t.int),
  f4: atom(t.bool),
  f5: atom(t.string),
  f6: atom(t.int),
  f7: atom(t.string),
})

/**
 * K чтений внутри ОДНОГО прогона эффекта.
 *
 * Число подобрано так, чтобы фиксированная цена перезапуска эффекта (запись
 * `ref`, propagate, flush) размазалась и не стала предметом замера: при K = 200
 * она делится на 200 и уходит в шум, а вычитание пустого тела убирает остаток.
 */
const K = 200

/**
 * Рабочий набор — 10 000 документов.
 *
 * Число не с потолка: docs/05 §7.4 считает цену слоя на сценарии «прочитали одно
 * поле у 10 000 сущностей», и мерить на другом масштабе значило бы отвечать не
 * на тот вопрос. Масштаб важен: ключей в keyed-каналах ровно столько, сколько
 * документов.
 */
const WORKING_SET = 10_000


/**
 * Читатели ВОСЬМИ РАЗНЫХ полей, а не одного.
 *
 * Разница существенна и чуть не была упущена: повторное чтение ОДНОГО канала
 * внутри одного прогона эффекта линкует зависимость только в первый раз, дальше
 * `link()` коротко замыкается на уже стоящем хвосте. Замер по одному полю
 * показал бы 199 чтений без подписки и одно с ней — то есть ровно не тот путь,
 * ради которого замер и затевался. Восемь полей — это восемь разных
 * зависимостей, то есть настоящая цена подписки, и это же типичный компонент.
 */
const FAN = 8

function fiberLoop(readers, reads = K) {
  const bell = ref(0)
  let sink = null
  let n = 0
  const stop = watchEffect(() => {
    bell()
    for (let i = 0; i < reads; i++) sink = readers[i & (FAN - 1)]()
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

/** Восемь пустых читателей — та же диспетчеризация по массиву, без работы. */
function idleReaders() {
  const out = []
  for (let i = 0; i < FAN; i++) out.push(() => i)
  return out
}

/** Цена одного чтения внутри файбера: прогон с телом минус прогон с пустым телом. */
async function perRead(label, readers) {
  const loaded = fiberLoop(readers)
  const empty = fiberLoop(idleReaders())
  loaded.tick()
  empty.tick()

  const full = await measure(() => do_not_optimize(loaded.tick()))
  const bare = await measure(() => do_not_optimize(empty.tick()))
  loaded.stop()
  empty.stop()

  const per = Math.max(0, (full.avg - bare.avg) / K)
  console.log(`  ${label.padEnd(18)} ${fmt(per).padStart(11)}  (эффект ${fmt(full.avg)}, пустой ${fmt(bare.avg)})`)
  return per
}

/**
 * Байт на одно чтение — РАЗНОСТЬЮ ДВУХ ДЛИН одного и того же цикла.
 *
 * Не разностью «с чтениями» и «пустой»: у эффекта с двумя сотнями зависимостей
 * перезапуск сам по себе стоит десятки байт бухгалтерии графа, и вычитание
 * эффекта БЕЗ зависимостей приписывало бы эту цену чтению. Первая редакция так и
 * делала и показывала 0.3 Б на чтение там, где на самом деле было 58 Б на
 * ПЕРЕЗАПУСК. Два прогона одинаковой формы, отличающиеся только числом чтений,
 * фиксированную цену сокращают.
 */
function perReadHeap(readers, times) {
  const short = heapOverRuns(readers, times, K)
  const long = heapOverRuns(readers, times, K * 3)
  return (long - short) / (times * K * 2)
}

function heapOverRuns(readers, times, reads) {
  const loop = fiberLoop(readers, reads)
  loop.tick()
  loop.tick()

  globalThis.gc?.()
  const before = process.memoryUsage().heapUsed
  for (let i = 0; i < times; i++) loop.tick()
  // `gc()` с ОБЕИХ сторон: без него в дельту попадает всё, что успело
  // накопиться и не успело собраться.
  globalThis.gc?.()
  const after = process.memoryUsage().heapUsed
  loop.stop()
  return after - before
}

// ── field/warm и его пол ─────────────────────────────────────────────────────

console.log('\n══ Модели S4: чтение поля ═══════════════════════════════════════')

{
  const { space } = stand()
  const doc = space.root(Wide)
  const fields = []
  for (let i = 0; i < FAN; i++) {
    // Канал берётся ОДИН раз: `doc[`f${i}`]()` внутри читателя строил бы строку
    // на каждом чтении. Первая редакция так и делала — и замер показывал 51.2 нс
    // на чтение и 25 Б на аллокацию, то есть цену конкатенации в бенче, а не
    // цену поля. Ровно тот случай, про который PRINCIPLES говорит «в замеряемый
    // участок попадает то, чего там быть не должно».
    const channel = doc[`f${i}`]
    channel(i === 2 || i === 3 || i === 6 ? i : i === 4 ? true : `значение ${i}`)
    fields.push(() => channel())
  }

  // Пол: восемь голых `computed.keyed` — та же карта, тот же `Fiber.read`, та же
  // подписка, но без слота, линзы и ленда под ними.
  const floors = []
  for (let i = 0; i < FAN; i++) {
    const channel = computed.keyed((key) => key + 1)
    channel(i)
    floors.push(() => channel(i))
  }

  const floor = await perRead('пол: keyed×8', floors)
  const warm = await perRead('field/warm', fields)

  const heap = Math.max(0, perReadHeap(fields, 300))

  console.log('')
  results['field/warm'] = verdict('field/warm', round(warm), BUDGETS['field/warm'].limit_ns)
  results['field/warm'].floor_ns = round(floor)
  results['field/warm'].over_floor = floor > 0 ? round(warm / floor) : null
  console.log(`  → пол платформы (голый computed.keyed в том же файбере): ${fmt(floor)}, отношение ×${round(warm / floor)}`)

  results['field/warm-heap'] = verdict('field/warm-heap', round(heap), BUDGETS['field/warm-heap'].limit_b, bytes)
}

// ── field/cold ───────────────────────────────────────────────────────────────

{
  // Холодное чтение бывает ровно один раз на (поле, голова), поэтому меряется
  // ОДНИМ проходом по свежим головам, а не `measure()` — тот прогнал бы тело
  // много раз и со второго раза мерил бы `field/warm` под другим именем.
  //
  // И читает СВЕЖЕЕ пространство над УЖЕ ЗАПОЛНЕННЫМ лендом. Первая редакция
  // читала тем же пространством, которым писала, — а там `keyIndex`, `slot` и
  // `order` уже посчитаны записью, и «холодное» выходило 334 нс вместо
  // настоящих единиц микросекунд. Ровно тот случай, про который PRINCIPLES
  // говорит: одинаковое имя сценария не делает работу одинаковой.
  const cold = coldPass(WORKING_SET)
  results['field/cold'] = verdict('field/cold', round(cold), BUDGETS['field/cold'].limit_ns)
  results['field/cold'].working_set = WORKING_SET
}

function coldPass(count) {
  const { land, space } = stand()
  const heads = []
  for (let i = 0; i < count; i++) {
    const head = land.nodeAt(2_000 + i)
    space.doc(Wide, head).f0(`v${i}`)
    heads.push(head)
  }

  // Второе пространство над тем же лендом: ни одного посчитанного канала.
  const fresh = createSpace({ land, salt: new Uint8Array([1, 2, 3]), report: () => {} })
  const docs = []
  for (let i = 0; i < count; i++) docs.push(fresh.doc(Wide, heads[i]))

  const start = process.hrtime.bigint()
  for (let i = 0; i < docs.length; i++) do_not_optimize(docs[i].f0())
  return Number(process.hrtime.bigint() - start) / docs.length
}

// ── field/neighbour: счётчик, а не время ─────────────────────────────────────

{
  let decodes = 0
  const counted = { ...t.string, decode: (raw) => { decodes += 1; return t.string.decode(raw) } }
  const Watched = model('bench-neighbour', { a: atom(counted), b: atom(t.string) })

  const { space } = stand()
  const doc = space.root(Watched)
  doc.a('раз')

  const stop = watchEffect(() => do_not_optimize(doc.a()))
  const base = decodes

  // Первая запись в СОСЕДНЕЕ поле: состав детей документа изменился.
  doc.b('соседнее')
  flush()
  do_not_optimize(doc.a())
  const after = decodes - base
  stop()

  console.log('')
  results['field/neighbour'] = verdict('field/neighbour', after, BUDGETS['field/neighbour'].limit_recalcs, count)
}

// ── doc/open, doc/reopen, doc/mem ────────────────────────────────────────────

console.log('\n══ Модели S4: документ ══════════════════════════════════════════')

{
  const { land } = stand()
  const heads = []
  for (let i = 0; i < 1000; i++) heads.push(land.nodeAt(100_000 + i))

  const stats = await measure(() => {
    // Свежее пространство на каждый прогон: хендл открывается ОДИН раз на
    // (модель, голова), и повторный вызов — это уже `doc/reopen`. Цена самой
    // привязки (16 keyed-каналов, ≈235 нс) размазана на 1000 документов.
    const space = createSpace({ land, salt: new Uint8Array([1]), report: () => {} })
    for (let i = 0; i < heads.length; i++) do_not_optimize(space.doc(Wide, heads[i]))
  })
  const open = stats.avg / heads.length

  const floorStats = await measure(() => {
    const room = new Map()
    for (let i = 0; i < heads.length; i++) do_not_optimize(handMade(heads[i], room))
  })
  const floor = floorStats.avg / heads.length

  results['doc/open'] = verdict('doc/open', round(open), BUDGETS['doc/open'].limit_ns)
  results['doc/open'].floor_ns = round(floor)
  console.log(`  → пол платформы (ручная сборка объекта на 9 слотов с восемью стрелками): ${fmt(floor)}, отношение ×${round(open / floor)}`)

  const { space } = stand()
  const head = heads[0]
  space.doc(Wide, head)
  const reopen = await measure(() => do_not_optimize(space.doc(Wide, head)))
  results['doc/reopen'] = verdict('doc/reopen', round(reopen.avg), BUDGETS['doc/reopen'].limit_ns)

  // Память: 1000 хендлов, удержанных массивом.
  const room = stand()
  globalThis.gc?.()
  const before = process.memoryUsage().heapUsed
  const kept = []
  for (let i = 0; i < 1000; i++) kept.push(room.space.doc(Wide, room.land.nodeAt(300_000 + i)))
  globalThis.gc?.()
  const mem = (process.memoryUsage().heapUsed - before) / kept.length
  do_not_optimize(kept.length)

  // Пол памяти: столько же объектов и стрелок, собранных руками. Бюджет ниже
  // этого числа был бы неверен, а не «не выполнен» (PRINCIPLES).
  globalThis.gc?.()
  const floorBefore = process.memoryUsage().heapUsed
  const handRoom = new Map()
  const handKept = []
  for (let i = 0; i < 1000; i++) handKept.push(handMade(i, handRoom))
  globalThis.gc?.()
  const memFloor = (process.memoryUsage().heapUsed - floorBefore) / handKept.length
  do_not_optimize(handKept.length)

  results['doc/mem'] = verdict('doc/mem', round(mem), BUDGETS['doc/mem'].limit_b, bytes)
  results['doc/mem'].floor_b = round(memFloor)
  console.log(`  → пол платформы (ручная сборка того же числа объектов): ${bytes(memFloor)}, отношение ×${round(mem / memFloor)}`)
}

// ── Запись ───────────────────────────────────────────────────────────────────

console.log('\n══ Модели S4: запись ════════════════════════════════════════════')

{
  // Прогрев одинаковой формы перед обоими проходами. Первая запись бывает ровно
  // один раз на (поле, голова), поэтому `measure()` тут неприменим, а один
  // непрогретый проход отдаёт JIT-разогрев за результат: пол `2 × land.write`
  // гулял 1.07 → 1.72 мкс между запуском в одиночку и запуском в общем прогоне,
  // и сторож регресса краснел на этом каждый раз.
  warmWrites()

  // Документы ОТКРЫВАЮТСЯ заранее: первая редакция создавала пространство прямо
  // внутри замеряемого тела, и 25.15 мкс оказались ценой привязки (16
  // keyed-каналов) плюс открытия хендла — то есть чем угодно, кроме записи.
  const { land, space } = stand()
  const docs = []
  for (let i = 0; i < WORKING_SET; i++) docs.push(space.doc(Wide, land.nodeAt(500_000 + i)))

  const start0 = process.hrtime.bigint()
  for (let i = 0; i < docs.length; i++) docs[i].f0('первое значение')
  const first = Number(process.hrtime.bigint() - start0) / docs.length

  // Пол: две записи в ленд с ЯВНЫМ self (ключевой юнит и значение) на том же
  // числе голов. Дальше к нему прибавляется цена контракта `x(next)` — он
  // обязан вернуть победителя LWW (docs/05 §3.7), то есть холодное чтение.
  const bare = stand(0x33)
  const heads = []
  for (let i = 0; i < WORKING_SET; i++) heads.push(bare.land.nodeAt(700_000 + i))
  const start1 = process.hrtime.bigint()
  for (let i = 0; i < heads.length; i++) {
    const key = bare.land.write(heads[i], 0, bare.land.nodeAt(1e9 + i * 7), 'f0', 'solo')
    bare.land.write(key.self, 0, bare.land.nodeAt(2e9 + i * 7), 'v')
  }
  const floor = Number(process.hrtime.bigint() - start1) / heads.length

  results['write/first'] = verdict('write/first', round(first), BUDGETS['write/first'].limit_ns)
  results['write/first'].floor_ns = round(floor + results['field/cold'].measured)
  results['write/first'].floor_writes_ns = round(floor)
  console.log(
    `  → пол платформы (2 × land.write ${fmt(floor)} + обязательное чтение победителя ${fmt(results['field/cold'].measured)}): `
    + `${fmt(floor + results['field/cold'].measured)}`,
  )

  const { land: idem, space: echo } = stand(0x22)
  const doc = echo.root(Wide)
  doc.f0('раз')
  const unitsBefore = idem.size()
  const start = process.hrtime.bigint()
  for (let i = 0; i < 10_000; i++) doc.f0(doc.f0())
  const spent = Number(process.hrtime.bigint() - start) / 1e6
  const born = idem.size() - unitsBefore

  results['write/idempotent'] = verdict('write/idempotent', round(spent), BUDGETS['write/idempotent'].limit_ms, millis)
  results['write/idempotent'].units_born = born
  results['write/idempotent'].units_passed = born === BUDGETS['write/idempotent'].limit_units
  if (!results['write/idempotent'].units_passed) failed += 1
  console.log(`  ${'write/idempotent'.padEnd(18)} новых юнитов ${born} при бюджете 0 — ${born === 0 ? 'ПРОЙДЕН' : 'ПРОВАЛЕН'}`)
}

/** Выброшенный прогон той же формы: греет обе дорожки, замеру не участвует. */
function warmWrites() {
  const warm = stand(0x44)
  for (let i = 0; i < WORKING_SET; i++) warm.space.doc(Wide, warm.land.nodeAt(400_000 + i)).f0('прогрев')

  const bare = stand(0x55)
  for (let i = 0; i < WORKING_SET; i++) {
    const head = bare.land.nodeAt(400_000 + i)
    const key = bare.land.write(head, 0, bare.land.nodeAt(3e9 + i * 7), 'f0', 'solo')
    bare.land.write(key.self, 0, bare.land.nodeAt(4e9 + i * 7), 'v')
  }
}

// ── Размер ───────────────────────────────────────────────────────────────────

console.log('\n══ Модели S4: размер ════════════════════════════════════════════')

{
  const out = mkdtempSync(join(tmpdir(), 'sync-model-size-'))
  try {
    execFileSync(
      'npx',
      [
        'tsdown', '--no-config', join(pkg, 'src/index.ts'),
        '--out-dir', out, '--format', 'esm', '--platform', 'neutral',
        '--target', 'es2022', '--minify', '--no-dts', '-l', 'warn',
      ],
      { cwd: pkg, stdio: ['ignore', 'ignore', 'inherit'] },
    )
    const gz = gzipSync(readFileSync(join(out, 'index.js')), { level: 9 }).length
    const delta = gz - SIZE_BASE
    console.log(`  пакет целиком ${(gz / 1024).toFixed(2)} КБ, база до слоя моделей ${(SIZE_BASE / 1024).toFixed(2)} КБ`)
    results['model/size'] = verdict('model/size', delta, BUDGETS['model/size'].limit_b, bytes)
    results['model/size'].total_bytes = gz
    results['model/size'].base_bytes = SIZE_BASE
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}

// ── Вердикт ──────────────────────────────────────────────────────────────────

results.passed = failed === 0
console.log(`\n══ Бюджеты S4/model ═════════════════════════════════════════════`)
console.log(failed === 0 ? 'все бюджеты пройдены' : `ПРОВАЛЕНО бюджетов: ${failed}`)

record('model_s4', results)
if (failed > 0) process.exitCode = 1
