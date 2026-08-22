// Перф-гейт S4: коллекции слоя моделей — список, словарь, части, индекс.
//
// Отдельным файлом от `model.mjs` по той же причине, по которой у Link, Unit и
// Vary свои разделы: у него свои наборы, свои бюджеты и свой раздел журнала.
// Общий у них только стенд, и он тут заново — двадцать строк дешевле связи между
// двумя разделами, которые правят разные руки.
//
// ─── Чем меряется тёплое чтение ──────────────────────────────────────────────
//
// ВНУТРИ ФАЙБЕРА, с подпиской. Вне файбера `Fiber.read` пропускает `link()`, то
// есть замер шёл бы по пути, которым прикладной код не ходит НИКОГДА: канал
// модели читают из `computed`, `watchEffect` или моста во Vue. Отсюда
// конструкция: один эффект, K чтений в теле, перезапуск дёргается `ref`ом, а из
// времени вычитается тот же эффект с пустым телом.
//
// ─── Пол платформы рядом с каждым бюджетом ───────────────────────────────────
//
// PRINCIPLES: «Бюджет меняется только замером пола, никогда — фактом промаха».
// Поэтому рядом с каждым числом лежит цена той же работы у примитива: голый
// `computed.keyed` для тёплого чтения, `land.order()` для пересборки, `Map.get`
// для повторного открытия.

import { do_not_optimize, measure } from 'mitata'
import {
  atom,
  computed,
  createSpace,
  dict,
  fixedClock,
  flush,
  index,
  Land,
  Link,
  list,
  model,
  parts,
  ref,
  t,
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
  'list/read-1000': {
    limit_ns: 50,
    why: 'docs/05 §8.5: тёплое чтение списка на 1000 элементах ≤ 50 нс. Массив лежит готовым в cell.value и не пересобирается, поэтому цена та же, что у любого тёплого чтения поля: Map.get по ЧИСЛУ плюс Fiber.read (проверка битфилда и возврат кэша). ПОЛ ИСПРАВЛЕН ПО ЗАМЕРУ: первая редакция брала два голых computed.keyed — по числу каналов решения Р3, — и получала 29.7 нс против измеренных 18.1, то есть пол выше замеряемого. Формула описывала ХОЛОДНЫЙ путь: тёплое чтение трогает ОДИН канал, `slot` читается только при пересчёте `value` и в тёплом пути не участвует вовсе',
  },
  'list/rebuild-1000': {
    limit_ns: 300_000,
    why: 'docs/05 §8.5: пересборка списка на 1000 элементах ≤ 300 мкс. Внутри — order() на 1000 детей (109 мкс, замер S3) плюс 1000 декодов линзы. Пол — тот же order() на тех же данных, меряется в этом же прогоне',
  },
  'list/reconcile-1000': {
    limit_ms: 2,
    limit_units: 1,
    why: 'docs/05 §8.5 и требование DoD стадии: «прочитал массив, поменял один элемент, записал обратно» на 1000 элементах — РОВНО ОДИН юнит и ≤ 2 мс. Юнит важнее времени: N юнитов вместо одного это растущий лог, тикающие часы и диффы по кругу между двумя узлами',
  },
  'dict/warm': {
    limit_ns: 500,
    why: 'строки в docs/05 §8.5 нет, бюджет заведён здесь и взят РАВНЫМ field/warm (≤ 500 нс при цели ≤ 50). Путь тот же плюс один шаг: cell.slot(head) → keyIndex(slot).get(ключ) → cell.value(keySelf), то есть три кэшированных чтения вместо двух. Пол — три голых computed.keyed в том же файбере',
  },
  'dict/keys-1000': {
    limit_ns: 300_000,
    why: 'та же работа, что у list/rebuild-1000, и тот же бюджет: order() на 1000 детей плюс 1000 декодов ключа. Ключи, в отличие от значений словаря, отдельным каналом НЕ кэшируются (dict.ts: кэш занят значением под ключом, потому что горячее чтение — это x(key), а не keys()), поэтому цена меряется, а не предполагается',
  },
  'parts/open': {
    limit_ns: 500,
    why: 'строки в docs/05 §8.5 нет. Обращение к части по ключу — это untracked keyIndex.get, Map.get реестра документов и ничего больше, то есть doc/reopen (бюджет 100 нс) плюс разрешение ключа. Взято ×5 к doc/reopen: путь идёт через mountKey, который на существующем ключе стоит один Map.get, и через две карты привязки',
  },
  'index/keys': {
    limit_ns: 500_000,
    why: 'docs/05 §8.5: три уровня, 1000 листьев ≤ 500 мкс. Внутри — три order() по цепочке уровней плюс декод ключей уровня. Меряется ХОЛОДНЫМ: свежее пространство над заполненным лендом, иначе замер показал бы цену Map.get',
  },
}

const round = (n) => Math.round(n * 100) / 100

const fmt = (ns) => {
  if (ns < 1000) return `${ns.toFixed(1)} ns`
  if (ns < 1e6) return `${(ns / 1000).toFixed(2)} µs`
  return `${(ns / 1e6).toFixed(3)} ms`
}

const millis = (ms) => `${ms.toFixed(3)} ms`

const results = {}
let failed = 0

function verdict(name, measured, limit, unit = fmt) {
  const budget = BUDGETS[name]
  const ok = measured <= limit
  if (!ok) failed += 1
  console.log(
    `  ${name.padEnd(20)} ${unit(measured).padStart(11)} при бюджете ${unit(limit).padStart(11)}  — ${ok ? 'ПРОЙДЕН' : 'ПРОВАЛЕН'}`,
  )
  results[name] = { ...budget, measured, passed: ok }
  return results[name]
}

// ── Стенд ────────────────────────────────────────────────────────────────────

const SALT = new Uint8Array([7, 11, 13])

function peerOf(byte) {
  const bin = new Uint8Array(8)
  bin[0] = byte
  return Link.peer(bin)
}

function stand(peer = 0x11) {
  const land = new Land(peerOf(peer), fixedClock(1_000_000))
  const space = createSpace({ land, salt: SALT, report: () => {} })
  return { land, space }
}

/** Что лежит внутри части и внутри листа индекса. */
model('bench-card', { title: atom(t.string) })

const Shelf = model('bench-shelf', {
  tags: list(t.string),
  counts: dict(t.string, t.int),
  cards: parts(t.string, 'bench-card'),
  archive: index(3, 'bench-card'),
})

const SIZE = 1000

/** Тысяча непохожих значений: повторы схлопнулись бы по контентному адресу. */
function thousand() {
  const out = []
  for (let i = 0; i < SIZE; i++) out.push(`элемент-${i}`)
  return out
}

// ── Цена одного чтения внутри файбера ────────────────────────────────────────

const K = 200
const FAN = 8

function fiberLoop(readers) {
  const bell = ref(0)
  let sink = null
  let n = 0
  const stop = watchEffect(() => {
    bell()
    for (let i = 0; i < K; i++) sink = readers[i & (FAN - 1)]()
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

function idleReaders() {
  const out = []
  for (let i = 0; i < FAN; i++) out.push(() => i)
  return out
}

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
  console.log(`  ${label.padEnd(20)} ${fmt(per).padStart(11)}  (эффект ${fmt(full.avg)}, пустой ${fmt(bare.avg)})`)
  return per
}

/** Восемь голых keyed-каналов — пол тёплого чтения. */
function keyedFloor(levels) {
  const out = []
  for (let i = 0; i < FAN; i++) {
    // `levels` каналов подряд: у списка их два (slot, value), у словаря три.
    const chain = []
    for (let k = 0; k < levels; k++) chain.push(computed.keyed((key) => key + k))
    out.push(() => {
      let sum = i
      for (let k = 0; k < chain.length; k++) sum = chain[k](i)
      return sum
    })
  }
  return out
}

// ── Список ───────────────────────────────────────────────────────────────────

console.log('\n══ Модели S4: список ════════════════════════════════════════════')

{
  const items = thousand()
  const readers = []
  const spaces = []
  for (let i = 0; i < FAN; i++) {
    const at = stand(0x11 + i)
    at.space.root(Shelf).tags(items)
    spaces.push(at)
    const channel = at.space.root(Shelf).tags
    readers.push(() => channel())
  }

  const floor = await perRead('пол: keyed×1', keyedFloor(1))
  const warm = await perRead('list/read-1000', readers)
  console.log('')
  verdict('list/read-1000', round(warm), BUDGETS['list/read-1000'].limit_ns)
  results['list/read-1000'].floor_ns = round(floor)
  results['list/read-1000'].over_floor = floor > 0 ? round(warm / floor) : null
  console.log(`  → пол платформы (один голый computed.keyed в том же файбере): ${fmt(floor)}, отношение ×${round(warm / floor)}`)

  // Пересборка: СВЕЖЕЕ пространство над уже заполненным лендом. Читать тем же,
  // которым писали, значило бы мерить `Map.get` — там `keyIndex`, `slot` и
  // `order` уже посчитаны записью (ровно та ошибка, что разобрана в `model.mjs`).
  const filled = spaces[0]
  const rebuild = await measure(() => {
    const fresh = createSpace({ land: filled.land, salt: SALT, report: () => {} })
    do_not_optimize(fresh.root(Shelf).tags().length)
  })

  // Пол: тот же `order()` на тех же детях, без слоя моделей над ним.
  const slot = filled.land.order(0).find((view) => view.value === 'tags').self
  const orderFloor = await measure(() => do_not_optimize(filled.land.order(slot).length))

  verdict('list/rebuild-1000', round(rebuild.avg), BUDGETS['list/rebuild-1000'].limit_ns)
  results['list/rebuild-1000'].floor_ns = round(orderFloor.avg)
  console.log(`  → пол платформы (land.order() на тех же ${SIZE} детях): ${fmt(orderFloor.avg)}, отношение ×${round(rebuild.avg / orderFloor.avg)}`)
}

// ── Реконсиляция: юниты важнее времени ───────────────────────────────────────

{
  const at = stand(0x21)
  const shelf = at.space.root(Shelf)
  shelf.tags(thousand())

  const next = shelf.tags().slice()
  next[SIZE / 2] = 'подменённый'

  const born = countWrites(at.land, () => {
    const start = process.hrtime.bigint()
    shelf.tags(next)
    return Number(process.hrtime.bigint() - start) / 1e6
  })

  verdict('list/reconcile-1000', round(born.value), BUDGETS['list/reconcile-1000'].limit_ms, millis)
  results['list/reconcile-1000'].units_born = born.units
  results['list/reconcile-1000'].units_passed = born.units === BUDGETS['list/reconcile-1000'].limit_units
  if (!results['list/reconcile-1000'].units_passed) failed += 1
  console.log(
    `  ${'list/reconcile-1000'.padEnd(20)} новых юнитов ${born.units} при бюджете 1 — ${born.units === 1 ? 'ПРОЙДЕН' : 'ПРОВАЛЕН'}`,
  )
}

/**
 * Сколько ЮНИТОВ родила операция.
 *
 * Считаются записи, а не рост `land.size()`: тот считает слоты `(голова, пир,
 * self)`, поэтому перезапись собственной прежней версии узла его не увеличивает
 * — а реконсиляция как раз перезаписывает узел тем же `self`, и «поменял один
 * элемент» показывало бы ноль независимо от того, родился юнит или десять.
 */
function countWrites(land, act) {
  const original = land.write.bind(land)
  let units = 0
  land.write = (...args) => {
    units += 1
    return original(...args)
  }
  try {
    return { value: act(), units }
  } finally {
    delete land.write
  }
}

// ── Словарь ──────────────────────────────────────────────────────────────────

console.log('\n══ Модели S4: словарь ═══════════════════════════════════════════')

{
  const readers = []
  const rooms = []
  for (let i = 0; i < FAN; i++) {
    const at = stand(0x31 + i)
    const shelf = at.space.root(Shelf)
    for (let k = 0; k < SIZE; k++) shelf.counts(`ключ-${k}`, k)
    rooms.push(at)
    const channel = shelf.counts
    readers.push(() => channel(`ключ-7`))
  }

  const floor = await perRead('пол: keyed×3', keyedFloor(3))
  const warm = await perRead('dict/warm', readers)
  console.log('')
  verdict('dict/warm', round(warm), BUDGETS['dict/warm'].limit_ns)
  results['dict/warm'].floor_ns = round(floor)
  results['dict/warm'].over_floor = floor > 0 ? round(warm / floor) : null
  console.log(`  → пол платформы (три голых computed.keyed в том же файбере): ${fmt(floor)}, отношение ×${round(warm / floor)}`)

  const filled = rooms[0]
  const keys = await measure(() => {
    const fresh = createSpace({ land: filled.land, salt: SALT, report: () => {} })
    do_not_optimize(fresh.root(Shelf).counts.keys().length)
  })
  verdict('dict/keys-1000', round(keys.avg), BUDGETS['dict/keys-1000'].limit_ns)
}

// ── Части ────────────────────────────────────────────────────────────────────

console.log('\n══ Модели S4: части и индекс ════════════════════════════════════')

{
  const at = stand(0x41)
  const shelf = at.space.root(Shelf)
  for (let i = 0; i < 100; i++) shelf.cards(`c${i}`).title(`карточка ${i}`)

  const open = await measure(() => do_not_optimize(shelf.cards('c7')))
  verdict('parts/open', round(open.avg), BUDGETS['parts/open'].limit_ns)
}

{
  // Трёхуровневый индекс на 1000 листьев: 10 × 10 × 10.
  const at = stand(0x51)
  const shelf = at.space.root(Shelf)
  for (let a = 0; a < 10; a++) {
    for (let b = 0; b < 10; b++) {
      for (let c = 0; c < 10; c++) shelf.archive.ensure([`g${a}`, `m${b}`, `t${c}`])
    }
  }

  const keys = await measure(() => {
    const fresh = createSpace({ land: at.land, salt: SALT, report: () => {} })
    const archive = fresh.root(Shelf).archive
    do_not_optimize(archive.keys([]).length + archive.keys(['g3']).length + archive.keys(['g3', 'm4']).length)
  })
  verdict('index/keys', round(keys.avg), BUDGETS['index/keys'].limit_ns)
}

// ── Вердикт ──────────────────────────────────────────────────────────────────

results.passed = failed === 0
console.log('\n══ Бюджеты S4/collections ═══════════════════════════════════════')
console.log(failed === 0 ? 'все бюджеты пройдены' : `ПРОВАЛЕНО бюджетов: ${failed}`)

record('model_s4_collections', results)
if (failed > 0) process.exitCode = 1
