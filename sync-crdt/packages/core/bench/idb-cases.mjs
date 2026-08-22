// Сценарии хранилища. Грузятся В СТРАНИЦУ и меряют настоящий IndexedDB.
//
// ПОЧЕМУ ЗДЕСЬ, А НЕ В NODE. Подделка (`fake-indexeddb`) — это чужой JS поверх
// обычных объектов: у неё нет ни LevelDB под спудом, ни structured clone, ни
// собственной цены транзакции. Бюджеты стадии S5 («load 100 000 юнитов
// ≤ 500 мс», «save батчем 1000 ≤ 30 мс») — это утверждения о ПЛАТФОРМЕ, и
// мерить их на подделке значило бы мерить чужую реализацию спецификации.
//
// ─── Две ловушки этого замера, обе пойманы прогоном ──────────────────────────
//
// 1. **Один прогон конфигурации — это жребий, а не число.** Два прогона
//    неизменного кода дали `page/16384` 0.8 → 2.2 мс (×2.75) и
//    `durability-relaxed` 7.2 → 16.1 мс (×2.24). Отсюда медиана по раундам.
// 2. **База ДЕГРАДИРУЕТ по ходу прогона.** Когда раундов стало пять, медленнее
//    стало ВСЁ сразу: `batch/1` 5.1 → 16.3 с, `mirrors-1` 4.5 → 24.9 мс, хотя
//    работа не менялась. То есть число зависит от того, сколько базе досталось
//    ДО него, и сравнивать конфигурации, снятые подряд, нельзя вовсе. Отсюда
//    три средства, и первые два оказались недостаточны:
//    — развёртки идут КРУГОВЫМ ОБХОДОМ (в каждом раунде — все конфигурации по
//      очереди), чтобы дрейф достался всем поровну;
//    — до и после каждого раздела меряется КАНАРЕЙКА, та же транзакция голого
//      IndexedDB, и её дрейф печатается рядом с числами;
//    — КАЖДЫЙ РАЗДЕЛ идёт В СВОЁМ КОНТЕКСТЕ БРАУЗЕРА, с пустым хранилищем.
//      Без этого не помогало ничего: база на замер дала дрейф ×10.4, одна общая
//      база — ×23.7 (хуже, потому что дело в объёме, прошедшем через origin, а
//      не в числе баз). Разделять контексты — единственный способ мерить второй
//      раздел в тех же условиях, что и первый.
//
// ПОЧЕМУ ОДИН НАБОР ПАЧЕК НА ВСЕ СЦЕНАРИИ. «Замер сравнивает то, что вы
// уравняли, а не то, что назвали» (PRINCIPLES.md): развёртки обязаны получать
// ПОБАЙТОВО одни и те же пачки, иначе разница чисел окажется разницей наборов.

const round = (n) => Math.round(n * 1000) / 1000

// ОДНА БАЗА НА ВЕСЬ ПРОГОН, а сценарии разведены ЛЕНДАМИ.
//
// Первая редакция заводила базу под каждый замер и удаляла её следом — около
// сотни `open`/`deleteDatabase` за прогон. Канарейка показала, чем это кончается:
// одна и та же транзакция голого IndexedDB дорожала за прогон в 10.4 раза
// (0.5 → 5.2 мс), то есть числа последних разделов измеряли не код, а износ
// базы. Ленды разведены ключом (`[land, side, page]`), убираются `drop`, и
// база остаётся одна.
let counter = 0
const dbName = (what) => `bench-${what}-${(counter += 1)}-${Math.floor(Math.random() * 1e9)}`

/** Общая база прогона. Заводится один раз, удаляется в конце. */
const DB = `bench-store-${Math.floor(Math.random() * 1e9)}`

/** Свой ленд на каждый замер: пространство ключей у них не пересекается. */
let landSeed = 0
function nextLand(api) {
  landSeed += 1
  const area = new Uint8Array(8)
  area[0] = landSeed & 0xff
  area[1] = (landSeed >> 8) & 0xff
  return api.Link.land(api.Link.peer(new Uint8Array(8).fill(0xa1)), area)
}

function landOf(api, seed) {
  const land = new api.Land(api.Link.peer(new Uint8Array(8).fill(seed)), api.fixedClock(1_000_000))
  land.track()
  return land
}

function landId(api, seed = 0xa1) {
  return api.Link.land(api.Link.peer(new Uint8Array(8).fill(seed)), new Uint8Array(8))
}

/**
 * `count` пачек по `size` юнитов, собранных настоящим лендом.
 *
 * Значение — строка в 30–40 байт: обычное поле формы, которое ЛОЖИТСЯ ВНУТРЬ
 * юнита. Выносные значения меряются отдельно и намеренно: у них другая цена, и
 * смешивать их в «средний юнит» значит получить число, которого нет ни у кого.
 */
function packsOf(api, count, size) {
  const land = landOf(api, 0x11)
  const id = landId(api)
  const out = []
  let lead = api.LAND_ROOT

  for (let batch = 0; batch < count; batch++) {
    for (let i = 0; i < size; i++) {
      lead = land.post(api.LAND_ROOT, lead, `поле формы ${batch}/${i}`).self
    }
    out.push(land.flush(id))
  }
  return out
}

function volume(packs) {
  let out = 0
  for (const pack of packs) out += pack.length
  return out
}

function median(times) {
  const sorted = [...times].sort((a, b) => a - b)
  return sorted[sorted.length >> 1]
}

/** Медиана по каждому числовому полю набора замеров. */
function middle(runs) {
  const out = {}
  for (const key of Object.keys(runs[0])) {
    const values = runs.map((run) => run[key])
    out[key] = typeof values[0] === 'number' ? median(values) : values[0]
  }
  return out
}

/** Последовательные повторы: параллельные исказили бы замер очередью базы. */
async function series(count, task) {
  const out = []
  for (let i = 0; i < count; i++) out.push(await task(i))
  return out
}

/**
 * Развёртка КРУГОВЫМ ОБХОДОМ: в каждом раунде все конфигурации по очереди.
 *
 * Так дрейф базы (ловушка 2 в шапке) достаётся всем конфигурациям поровну, а не
 * штрафует ту, что стоит в списке последней.
 */
async function sweep(rounds, configs, task) {
  const runs = new Map(configs.map(([key]) => [key, []]))
  for (let r = 0; r < rounds; r++) {
    for (const [key, spec] of configs) runs.get(key).push(await task(spec, r))
  }
  const out = {}
  for (const [key, list] of runs) out[key] = middle(list)
  return out
}

// ── Пол платформы ────────────────────────────────────────────────────────────
//
// «Бюджет ниже пола платформы — неверный бюджет» (PRINCIPLES.md). Пол здесь —
// цена ТОЙ ЖЕ работы у голого IndexedDB: одна транзакция с тем же числом
// записей того же размера и одно чтение того же объёма. Всё, что мы делаем
// сверх, — разбор, индекс, арена — обязано укладываться в разницу.

function open(factory, name) {
  return new Promise((done, fail) => {
    const request = factory.open(name, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('raw')
    request.onsuccess = () => done(request.result)
    request.onerror = () => fail(request.error)
  })
}

function commit(tx) {
  return new Promise((done, fail) => {
    tx.oncomplete = () => done()
    tx.onerror = () => fail(tx.error)
    tx.onabort = () => fail(tx.error)
  })
}

function ask(request) {
  return new Promise((done, fail) => {
    request.onsuccess = () => done(request.result)
    request.onerror = () => fail(request.error)
  })
}

/** Пол записи: `rows` записей по `page` байт одной транзакцией. */
async function floorWrite(rows, page, rounds) {
  const name = dbName('floor-write')
  const db = await open(indexedDB, name)
  const bin = new Uint8Array(page)
  const times = []

  try {
    for (let r = 0; r < rounds; r++) {
      const at = performance.now()
      const tx = db.transaction('raw', 'readwrite', { durability: 'relaxed' })
      const store = tx.objectStore('raw')
      for (let i = 0; i < rows; i++) store.put(bin.slice(), [r, i])
      await commit(tx)
      times.push(performance.now() - at)
    }
  } finally {
    db.close()
    await ask(indexedDB.deleteDatabase(name))
  }

  return median(times)
}

/** Пол чтения: один `getAll` по `rows` записям в `page` байт плюс склейка образа. */
async function floorRead(rows, page, rounds) {
  const name = dbName('floor-read')
  const db = await open(indexedDB, name)
  const bin = new Uint8Array(page)

  try {
    const tx = db.transaction('raw', 'readwrite', { durability: 'relaxed' })
    const store = tx.objectStore('raw')
    for (let i = 0; i < rows; i++) store.put(bin.slice(), i)
    await commit(tx)

    const times = []
    for (let r = 0; r < rounds; r++) {
      const at = performance.now()
      const read = db.transaction('raw', 'readonly').objectStore('raw')
      const values = await ask(read.getAll())
      // Склейка в один образ — она же есть и у нас, значит и в полу обязана быть.
      const image = new Uint8Array(values.length * page)
      for (let i = 0; i < values.length; i++) image.set(values[i], i * page)
      if (image.length === 0) throw new Error('пол чтения ничего не прочитал')
      times.push(performance.now() - at)
    }
    return median(times)
  } finally {
    db.close()
    await ask(indexedDB.deleteDatabase(name))
  }
}

// ── Сценарии ─────────────────────────────────────────────────────────────────

async function saveAll(store, id, packs) {
  const times = []
  for (const pack of packs) {
    const at = performance.now()
    await store.save(id, pack)
    times.push(performance.now() - at)
  }
  return times
}

async function coldLoad(api, make, id) {
  const store = make()
  const at = performance.now()
  const bin = await store.load(id)
  const load = performance.now() - at

  // Приём в ленд — не часть бюджета хранилища, но без него число «500 мс»
  // читается как обещание пользователю, которого оно не даёт.
  const land = landOf(api, 0x99)
  const adoptAt = performance.now()
  land.adopt(bin)
  const adopt = performance.now() - adoptAt

  await store.close()
  return { load, adopt, bytes: bin.length }
}

/**
 * Правки ВРАЗБРОС по живому ленду — тот самый сценарий «правят текст».
 *
 * Отличается от дописывания батча ровно тем, ради чего меряется: страницы
 * пачкаются не подряд, и крупная страница платит за каждый исправленный юнит
 * целиком. Возвращает время и байты, реально уехавшие в базу.
 */
async function spreadEdits(api, page, plan) {
  const store = api.idbStore({ name: DB, page })
  const land = landOf(api, 0x33)
  const id = nextLand(api)
  const alive = []

  let lead = api.LAND_ROOT
  for (let i = 0; i < plan.spreadUnits; i++) {
    lead = land.post(api.LAND_ROOT, lead, `поле формы ${i}`).self
    alive.push(lead)
  }
  await store.save(id, land.flush(id))

  const base = store.written()
  const at = performance.now()
  let done = 0
  while (done < plan.spread) {
    for (let i = 0; i < plan.churnStep && done < plan.spread; i++, done++) {
      // Шаг 7919 — простой: правки ложатся по всему ленду, а не подряд.
      land.write(api.LAND_ROOT, api.LAND_ROOT, alive[(done * 7919) % alive.length], `правка ${done}`)
    }
    await store.save(id, land.flush(id))
  }
  const ms = performance.now() - at
  const written = store.written() - base

  await store.drop(id)
  await store.close()
  return { ms, written }
}

/**
 * Один раздел замера. Зовётся из своего, чистого контекста браузера.
 *
 * Возвращает и числа раздела, и его канарейку: читатель обязан видеть, в каких
 * условиях они сняты.
 */
export async function run(api, plan, section, input) {
  const before = await floorWrite(plan.canaryRows, plan.page, 15)
  const out = await measure(api, plan, section, input)
  const after = await floorWrite(plan.canaryRows, plan.page, 15)
  return {
    ...out,
    canary: { before_ms: round(before), after_ms: round(after), drift: round(after / before) },
  }
}

/** Тело раздела. Каждая ветка сама решает, какие пачки ей нужны. */
async function measure(api, plan, section, input) {
  const id = landId(api)
  const results = {}

  // ── 1. Главный сценарий: 100 000 юнитов ───────────────────────────────────
  if (section === 'main') {
    const packs = packsOf(api, plan.batches, plan.batch)
    const make = () => api.idbStore({ name: DB, page: plan.page })
    const store = make()
    const times = await saveAll(store, id, packs)
    await store.close()

    const first = await coldLoad(api, make, id)
    const cold = middle(await series(plan.rounds, () => coldLoad(api, make, id)))

    const probe = api.idbStore({ name: DB, page: plan.page })
    const live = await probe.live(id)
    const stored = await probe.bytes(id)
    const units = await probe.units(id)
    await probe.drop(id)
    await probe.close()

    results.main = {
      units,
      pack_bytes: volume(packs),
      save_first_ms: round(times[0]),
      save_median_ms: round(median(times)),
      save_last_ms: round(times[times.length - 1]),
      save_max_ms: round(Math.max(...times)),
      save_total_ms: round(times.reduce((a, b) => a + b, 0)),
      load_first_ms: round(first.load),
      load_ms: round(cold.load),
      adopt_ms: round(cold.adopt),
      load_bytes: cold.bytes,
      live_bytes: live,
      stored_bytes: stored,
      stored_over_live: round(stored / live),
    }
  }

  // ── 2. Пол платформы ──────────────────────────────────────────────────────
  if (section === 'floor') {
    const rows = Math.ceil((plan.batch * input.live_bytes) / (input.units * plan.page))
    const pages = Math.ceil(input.live_bytes / plan.page)
    results.floor = {
      note: `запись ${rows} страниц по ${plan.page} Б одной транзакцией; чтение ${pages} страниц одним getAll`,
      write_rows: rows,
      write_ms: round(await floorWrite(rows, plan.page, 15)),
      read_rows: pages,
      read_ms: round(await floorRead(pages, plan.page, 5)),
    }
  }

  // ── 3. Арена: 10 000 правок ───────────────────────────────────────────────
  if (section === 'churn') {
    const id = nextLand(api)
    const store = api.idbStore({ name: DB, page: plan.page })
    const land = landOf(api, 0x22)
    const alive = []
    let lead = api.LAND_ROOT
    for (let i = 0; i < plan.churnUnits; i++) {
      lead = land.post(api.LAND_ROOT, lead, `поле формы ${i}`).self
      alive.push(lead)
    }
    await store.save(id, land.flush(id))
    const before = await store.bytes(id)

    // Правки идут ПАЧКАМИ: столько же операций, но транзакций меньше. Бюджет
    // здесь про РАЗМЕР ФАЙЛА, а не про время, и число транзакций на него не
    // влияет — влияет то, попадает ли новая версия в прежний слот.
    const at = performance.now()
    let done = 0
    while (done < plan.churn) {
      for (let i = 0; i < plan.churnStep && done < plan.churn; i++, done++) {
        // Треть правок меняет ДЛИНУ значения: слот освобождается и берётся
        // заново — то самое, ради чего в образе живёт аллокатор.
        const value = done % 3 === 0
          ? `поле формы ${done} — значительно длиннее прежнего, чтобы слот сменился`
          : `поле формы ${done}`
        land.write(api.LAND_ROOT, api.LAND_ROOT, alive[(done * 7919) % alive.length], value)
      }
      await store.save(id, land.flush(id))
    }
    const churnMs = performance.now() - at

    const live = await store.live(id)
    const after = await store.bytes(id)
    const units = await store.units(id)
    await store.drop(id)
    await store.close()

    results.churn = {
      note: `${plan.churn} правок поверх ${plan.churnUnits} юнитов, пачками по ${plan.churnStep}`,
      units,
      before_bytes: before,
      after_bytes: after,
      live_bytes: live,
      stored_over_live: round(after / live),
      grew: round(after / before),
      total_ms: round(churnMs),
    }
  }

  // ── 4. Развёртка по странице ──────────────────────────────────────────────
  //
  // ДВА РЕЖИМА, И ЭТО ГЛАВНОЕ ЗДЕСЬ. Дописывание батча пачкает страницы ПОДРЯД,
  // и крупная страница на нём всегда выигрывает: записей меньше. Правка живого
  // документа пачкает их ВРАЗБРОС, и там крупная страница платит за каждый
  // исправленный юнит целой страницей. Мерить только первое и выбирать по нему
  // умолчание значило бы оптимизировать импорт данных за счёт того самого
  // сценария, ради которого затевается local-first.
  if (section === 'page') {
    const slice = packsOf(api, plan.sweepBatches, plan.batch)
    const raw = await sweep(plan.rounds, plan.pages.map(page => [`${page}`, page]), async (page) => {
      const own = nextLand(api)
      const make = () => api.idbStore({ name: DB, page })
      const store = make()
      const times = await saveAll(store, own, slice)
      await store.close()

      const cold = await coldLoad(api, make, own)
      const probe = api.idbStore({ name: DB, page })
      const stored = await probe.bytes(own)
      const live = await probe.live(own)
      await probe.drop(own)
      await probe.close()

      const spread = await spreadEdits(api, page, plan)

      return {
        save_median_ms: median(times),
        save_total_ms: times.reduce((a, b) => a + b, 0),
        load_ms: cold.load,
        stored_over_live: stored / live,
        spread_us_per_edit: (spread.ms * 1000) / plan.spread,
        spread_bytes_per_edit: spread.written / plan.spread,
      }
    })

    results.page = {}
    for (const [key, item] of Object.entries(raw)) {
      results.page[key] = {
        save_median_ms: round(item.save_median_ms),
        save_total_ms: round(item.save_total_ms),
        load_ms: round(item.load_ms),
        stored_over_live: round(item.stored_over_live),
        spread_us_per_edit: round(item.spread_us_per_edit),
        spread_bytes_per_edit: Math.round(item.spread_bytes_per_edit),
      }
    }
  }

  // ── 5. Развёртка по размеру батча ─────────────────────────────────────────
  //
  // Прямой ответ на вопрос «сколько юнитов в одной транзакции»: одни и те же
  // юниты, разложенные по-разному.
  if (section === 'batch') {
    const owned = new Map()
    for (const size of plan.batchSizes) owned.set(size, packsOf(api, plan.batchUnits / size, size))

    const raw = await sweep(plan.rounds, plan.batchSizes.map(size => [`${size}`, size]), async (size) => {
      const own = nextLand(api)
      const store = api.idbStore({ name: DB, page: plan.page })
      const at = performance.now()
      for (const pack of owned.get(size)) await store.save(own, pack)
      const total = performance.now() - at
      const writes = store.writes()
      const written = store.written()
      await store.drop(own)
      await store.close()
      return { total_ms: total, transactions: writes, written_bytes: written }
    })

    results.batch = {}
    for (const [key, item] of Object.entries(raw)) {
      results.batch[key] = {
        units: plan.batchUnits,
        transactions: item.transactions,
        written_bytes: item.written_bytes,
        total_ms: round(item.total_ms),
        per_unit_us: round((item.total_ms * 1000) / plan.batchUnits),
      }
    }
  }

  // ── 6. Цена зеркала и цена durability ─────────────────────────────────────
  if (section === 'shape') {
    const slice = packsOf(api, plan.sweepBatches, plan.batch)
    const shapes = [
      ['mirrors-1', { mirrors: 1 }],
      ['mirrors-2', { mirrors: 2 }],
      ['durability-relaxed', { durability: 'relaxed' }],
      ['durability-strict', { durability: 'strict' }],
    ]

    const raw = await sweep(plan.rounds, shapes, async (options) => {
      const own = nextLand(api)
      const store = api.idbStore({ name: DB, page: plan.page, ...options })
      const times = await saveAll(store, own, slice)
      const stored = await store.bytes(own)
      const written = store.written()
      await store.drop(own)
      await store.close()
      return {
        save_median_ms: median(times),
        save_total_ms: times.reduce((a, b) => a + b, 0),
        stored_bytes: stored,
        written_bytes: written,
      }
    })

    results.shape = {}
    for (const [key, item] of Object.entries(raw)) {
      results.shape[key] = {
        save_median_ms: round(item.save_median_ms),
        save_total_ms: round(item.save_total_ms),
        stored_bytes: item.stored_bytes,
        written_bytes: item.written_bytes,
      }
    }
  }

  return results
}
