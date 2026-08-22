// Перф-гейт S4: ссылки, вложенные части и `cast` (docs/05 §8.5).
//
// ─── Чем этот раздел отличается от `model.mjs` ───────────────────────────────
//
// Тем же, чем и он: чтение поля меряется ВНУТРИ ФАЙБЕРА, с подпиской. Вне
// файбера `Fiber.read` пропускает `link()`, и замер шёл бы по пути, которым
// прикладной код не ходит никогда. Гарнитура повторена, а не вынесена в общий
// модуль, намеренно: два раздела бенча — это два независимых свидетеля, и общая
// обвязка сделала бы их одним.
//
// ─── Что здесь ловится, чего не поймает `model.mjs` ──────────────────────────
//
// Ссылка отличается от атома тем, что её чтение МАТЕРИАЛИЗУЕТ ДОКУМЕНТ. Значит
// пол у неё не «декод плюс Map.get», а «декод плюс открытие хендла», и разница
// между тёплым и холодным разыменованием — это цена всего `doc/open` (docs/05
// §7.6). Бюджет обязан считать её явно, иначе он проверяет не тот объём работы.

import { do_not_optimize, measure } from 'mitata'
import {
  atom,
  cast,
  coreOf,
  createSpace,
  fixedClock,
  flush,
  Land,
  link,
  links,
  Link,
  list,
  model,
  part,
  ref,
  t,
  watchEffect,
} from './dist/entry.js'
import { record } from './_budgets.mjs'

/**
 * БЮДЖЕТЫ ЗАФИКСИРОВАНЫ ДО ПЕРВОГО ЗАПУСКА.
 *
 * У каждого — `why`: откуда взято число и из чего сложен пол. Бюджет без
 * объяснения проверяет не код, а память автора; бюджет ниже пола не «не
 * выполнен», а неверен (PRINCIPLES, «Гейт производительности»).
 */
const BUDGETS = {
  'cast/warm': {
    limit_ns: 50,
    why: 'docs/05 §8.5 называет цену перевода вида: ≤ 50 нс, пол — два Map.get. У нас их ровно два: ядро → спека → ключ в реестре ячеек и голова → канал в самой ячейке. Данных `cast` не касается вовсе',
  },
  'cast/units': {
    limit_units: 0,
    why: 'docs/05 §1.7 и §3.11: перевод вида не мигрирует данные. Ноль — не «мало», а свойство: вид не участвует в хранении, поэтому писать при переводе нечего в принципе. Счётчик постов, а не время',
  },
  'link/warm': {
    limit_ns: 500,
    why: 'та же строка docs/05 §8.5, что и `field/warm`: разыменование при валидном кэше — это стрелка канала → cell.value(head) → Map.get по числу → Fiber.read. Документ на тёплом пути уже построен и лежит в реестре, поэтому цена не отличается от атома',
  },
  'link/cold': {
    limit_ns: 8000,
    why: 'строки в docs/05 §8.5 нет — бюджет заводится здесь, и пол складывается из ДВУХ уже замеренных величин: холодное чтение поля (`field/cold`, 2.44 мкс журнала) плюс материализация документа-цели (`doc/open`, 1.58 мкс), итого ≈ 4.0 мкс. Плюс разбор пешки и перевод относительной ссылки в абсолютную. Бюджет — пол ×2: меньше значило бы обещать, что открытие цели бесплатно, а §7.6 говорит обратное',
  },
  'part/warm': {
    limit_ns: 500,
    why: 'тот же путь, что у `link/warm`: часть есть всегда, её адрес предсказан, и тёплое чтение — это Map.get плюс Fiber.read. Отдельная строка нужна потому, что у части адрес считается ХЭШЕМ, и промах кэша здесь стоил бы дороже, чем у ссылки',
  },
  'ensure/first': {
    limit_ns: 20_000,
    why: 'пол — сумма трёх замеренных: первая запись поля (`write/first`, 6.20 мкс журнала: монтирование ключевого юнита плюс запись значения плюс обязательное чтение победителя LWW), открытие документа-цели (`doc/open`, 1.58 мкс) и холодное чтение ссылки обратно (`field/cold`, 2.44 мкс) — итого ≈ 10.2 мкс. Сверх пола `ensure` платит ещё два контентных хэша (адрес сущности и адрес ключевого юнита). Бюджет — пол ×2',
  },
  'ensure/idempotent': {
    limit_ns: 1000,
    limit_units: 0,
    why: 'повторный `ensure` обязан быть чтением: он находит уже записанную ссылку и возвращает тот же документ. РОВНО 0 новых юнитов — без этого два места кода, зовущие ensure, рождают две сущности, а эхо между пирами не сходится никогда. Пол — тёплое чтение ссылки (`link/warm`) плюс Map.get',
  },
  'links/rebuild-1000': {
    limit_ns: 3_000_000,
    why: 'пол — `order()` на 1000 детей (109 мкс, замер S3) плюс 1000 × (декод пешки + resolve + nodeOf + открытие документа 1.58 мкс) ≈ 1.7 мс. Это цена, названная в docs/05 §7.6: список из 10 000 сущностей, открытых целиком, стоит открытия. Бюджет — пол ×1.8',
  },
}

const round = (n) => Math.round(n * 100) / 100

const fmt = (ns) => {
  if (ns < 1000) return `${ns.toFixed(1)} ns`
  if (ns < 1e6) return `${(ns / 1000).toFixed(2)} µs`
  return `${(ns / 1e6).toFixed(3)} ms`
}

const count = (n) => `${n}`

const results = {}
let failed = 0

function verdict(name, measured, limit, unit = fmt) {
  const budget = BUDGETS[name]
  const ok = measured <= limit
  if (!ok) failed += 1
  console.log(
    `  ${name.padEnd(20)} ${unit(measured).padStart(11)} при бюджете ${unit(limit).padStart(11)}  — ${ok ? 'ПРОЙДЕН' : 'ПРОВАЛЕН'}`,
  )
  return { ...budget, measured, passed: ok }
}

// ── Стенд ────────────────────────────────────────────────────────────────────

function peerOf(byte) {
  const bin = new Uint8Array(8)
  bin[0] = byte
  return Link.peer(bin)
}

const HOME = Link.land(peerOf(0x01), new Uint8Array(8))
const SALT = new Uint8Array([1, 2, 3])

function stand(peer = 0x11) {
  const land = new Land(peerOf(peer), fixedClock(1_000_000))
  const space = createSpace({ land, id: HOME, salt: SALT, report: () => {} })
  return { land, space }
}

const Owner = model('bench-owner', {
  name: atom(t.string),
})

const Meter = model('bench-meter', {
  views: atom(t.int),
})

// Имя своё, не общее с `model-list.mjs`. Имена моделей ГЛОБАЛЬНЫ (docs/05 §7.2),
// а оба файла грузятся в один процесс `bench/run.mjs` — поэтому одинаковое имя
// роняло весь прогон на `TypeError: модель «bench-card» уже объявлена`, и с ним
// молча переставали идти ВСЕ разделы после этого: размер пакета, хранилище S5 и
// кросс-движковая сверка S2. Ровно тот случай, про который PRINCIPLES говорит
// «проверка, которой нет, видна; проверка, которая не дошла, — нет».
const Card = model('bench-refs-card', {
  title: atom(t.string),
  tags: list(t.string),
  owner: link('bench-owner'),
  crew: links('bench-owner'),
  stats: part('bench-meter'),
})

/** Спека вида — МОДУЛЬНАЯ константа: мемо ячейки идёт по объекту спеки. */
const AS_ATOM = atom(t.maybe(t.string))

// ── Гарнитура чтения внутри файбера (см. шапку) ──────────────────────────────

const K = 200
const FAN = 8
const WORKING_SET = 10_000

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

/** Сколько юнитов постилось за действие — единственная честная точка счёта. */
function posted(space, fn) {
  const core = coreOf(space)
  const was = core.post
  let n = 0
  core.post = (head, lead, self, value, tag) => {
    n += 1
    was(head, lead, self, value, tag)
  }
  try {
    fn()
  } finally {
    core.post = was
  }
  return n
}

// ── Тёплое разыменование ─────────────────────────────────────────────────────

console.log('\n══ Модели S4: ссылки и части ════════════════════════════════════')

{
  const { land, space } = stand()
  const cards = []
  for (let i = 0; i < FAN; i++) {
    const card = space.doc(Card, land.nodeAt(1000 + i))
    card.owner.ensure().name(`имя ${i}`)
    card.stats().views(i)
    cards.push(card)
  }

  const owners = cards.map(card => () => card.owner())
  const parts = cards.map(card => () => card.stats())

  const warm = await perRead('link/warm', owners)
  const partWarm = await perRead('part/warm', parts)

  console.log('')
  results['link/warm'] = verdict('link/warm', round(warm), BUDGETS['link/warm'].limit_ns)
  results['part/warm'] = verdict('part/warm', round(partWarm), BUDGETS['part/warm'].limit_ns)
}

// ── Холодное разыменование ───────────────────────────────────────────────────

{
  // Холодное чтение бывает ровно один раз на (поле, голова), поэтому меряется
  // ОДНИМ проходом по свежим головам, а не `measure()` — тот прогнал бы тело
  // много раз и со второго раза мерил бы тёплый путь под другим именем.
  //
  // И читает СВЕЖЕЕ пространство над УЖЕ ЗАПОЛНЕННЫМ лендом: в том, которым
  // писали, `keyIndex`, `slot` и реестр документов уже посчитаны записью.
  const { land, space } = stand()
  const heads = []
  for (let i = 0; i < WORKING_SET; i++) {
    const head = land.nodeAt(200_000 + i)
    space.doc(Card, head).owner.ensure().name(`имя ${i}`)
    heads.push(head)
  }

  const fresh = createSpace({ land, id: HOME, salt: SALT, report: () => {} })
  const docs = []
  for (let i = 0; i < heads.length; i++) docs.push(fresh.doc(Card, heads[i]))

  const start = process.hrtime.bigint()
  for (let i = 0; i < docs.length; i++) do_not_optimize(docs[i].owner())
  const cold = Number(process.hrtime.bigint() - start) / docs.length

  // Пол в ТОМ ЖЕ прогоне: холодное чтение обычного атома на тех же головах плюс
  // открытие документа-цели. Сравниваются равные объёмы работы, а не названия.
  const bare = createSpace({ land, id: HOME, salt: SALT, report: () => {} })
  const plain = []
  for (let i = 0; i < heads.length; i++) plain.push(bare.doc(Card, heads[i]))
  const startFloor = process.hrtime.bigint()
  for (let i = 0; i < plain.length; i++) do_not_optimize(plain[i].title())
  const floorRead = Number(process.hrtime.bigint() - startFloor) / plain.length

  const room = createSpace({ land, id: HOME, salt: SALT, report: () => {} })
  const startOpen = process.hrtime.bigint()
  for (let i = 0; i < heads.length; i++) do_not_optimize(room.doc(Owner, land.nodeAt(900_000 + i)))
  const floorOpen = Number(process.hrtime.bigint() - startOpen) / heads.length

  results['link/cold'] = verdict('link/cold', round(cold), BUDGETS['link/cold'].limit_ns)
  results['link/cold'].floor_ns = round(floorRead + floorOpen)
  results['link/cold'].floor_read_ns = round(floorRead)
  results['link/cold'].floor_open_ns = round(floorOpen)
  console.log(
    `  → пол платформы (холодное чтение поля ${fmt(floorRead)} + открытие документа-цели ${fmt(floorOpen)}): `
    + `${fmt(floorRead + floorOpen)}, отношение ×${round(cold / (floorRead + floorOpen))}`,
  )
}

// ── Создание ─────────────────────────────────────────────────────────────────

console.log('\n══ Модели S4: создание ══════════════════════════════════════════')

{
  // Прогрев той же формы: первая запись бывает ровно один раз на (поле, голова),
  // поэтому `measure()` неприменим, а один непрогретый проход отдаёт
  // JIT-разогрев за результат.
  {
    const warm = stand(0x44)
    for (let i = 0; i < WORKING_SET; i++) warm.space.doc(Card, warm.land.nodeAt(400_000 + i)).owner.ensure()
  }

  const { land, space } = stand(0x22)
  const docs = []
  for (let i = 0; i < WORKING_SET; i++) docs.push(space.doc(Card, land.nodeAt(500_000 + i)))

  const start = process.hrtime.bigint()
  for (let i = 0; i < docs.length; i++) do_not_optimize(docs[i].owner.ensure())
  const first = Number(process.hrtime.bigint() - start) / docs.length

  results['ensure/first'] = verdict('ensure/first', round(first), BUDGETS['ensure/first'].limit_ns)

  const again = await measure(() => do_not_optimize(docs[0].owner.ensure()))
  const born = posted(space, () => {
    for (let i = 0; i < 10_000; i++) do_not_optimize(docs[i % docs.length].owner.ensure())
  })

  results['ensure/idempotent'] = verdict('ensure/idempotent', round(again.avg), BUDGETS['ensure/idempotent'].limit_ns)
  results['ensure/idempotent'].units_born = born
  results['ensure/idempotent'].units_passed = born === 0
  if (born !== 0) failed += 1
  console.log(`  ${'ensure/idempotent'.padEnd(20)} новых юнитов ${born} при бюджете 0 — ${born === 0 ? 'ПРОЙДЕН' : 'ПРОВАЛЕН'}`)
}

// ── Множественная ссылка ─────────────────────────────────────────────────────

{
  const { land, space } = stand(0x33)
  const head = land.nodeAt(700_000)
  const card = space.doc(Card, head)
  const crew = []
  for (let i = 0; i < 1000; i++) {
    const owner = space.doc(Owner, land.nodeAt(710_000 + i))
    owner.name(`член ${i}`)
    crew.push(owner)
  }
  card.crew(crew)

  // Холодная пересборка: свежее пространство над тем же лендом, то есть тысяча
  // разборов пешки и тысяча открытий документа.
  const stats = await measure(() => {
    const fresh = createSpace({ land, id: HOME, salt: SALT, report: () => {} })
    do_not_optimize(fresh.doc(Card, head).crew().length)
  })

  results['links/rebuild-1000'] = verdict(
    'links/rebuild-1000',
    round(stats.avg),
    BUDGETS['links/rebuild-1000'].limit_ns,
  )
}

// ── cast ─────────────────────────────────────────────────────────────────────

console.log('\n══ Модели S4: cast ══════════════════════════════════════════════')

{
  const { land, space } = stand(0x55)
  const card = space.doc(Card, land.nodeAt(800_000))
  card.tags(['vue', 'crdt'])

  // Прогрев: первая спека заводит ячейку, дальше это два Map.get.
  cast(card.tags, AS_ATOM)

  const stats = await measure(() => do_not_optimize(cast(card.tags, AS_ATOM)))

  // Пол: два `Map.get` по картам того же порядка величины.
  const one = new Map([[AS_ATOM, new Map([['tags', card.tags]])]])
  const floorStats = await measure(() => do_not_optimize(one.get(AS_ATOM).get('tags')))

  results['cast/warm'] = verdict('cast/warm', round(stats.avg), BUDGETS['cast/warm'].limit_ns)
  results['cast/warm'].floor_ns = round(floorStats.avg)
  console.log(`  → пол платформы (два Map.get): ${fmt(floorStats.avg)}, отношение ×${round(stats.avg / floorStats.avg)}`)

  const born = posted(space, () => {
    for (let i = 0; i < 1000; i++) {
      do_not_optimize(cast(card.tags, AS_ATOM)())
      do_not_optimize(cast(card.stats, Meter).views())
    }
  })

  results['cast/units'] = { ...BUDGETS['cast/units'], measured: born, passed: born === 0 }
  if (born !== 0) failed += 1
  console.log(`  ${'cast/units'.padEnd(20)} ${count(born).padStart(11)} при бюджете ${count(0).padStart(11)}  — ${born === 0 ? 'ПРОЙДЕН' : 'ПРОВАЛЕН'}`)
}

// ── Вердикт ──────────────────────────────────────────────────────────────────

results.passed = failed === 0
console.log('\n══ Бюджеты S4/model-refs ════════════════════════════════════════')
console.log(failed === 0 ? 'все бюджеты пройдены' : `ПРОВАЛЕНО бюджетов: ${failed}`)

record('model_s4_refs', results)
if (failed > 0) process.exitCode = 1
