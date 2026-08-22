// Наборы и секундомер для кросс-движкового замера. Один и тот же файл грузят
// Node (`bench/cross.mjs`) и страница в Chromium — иначе сравнивались бы не два
// движка, а две редакции бенча.
//
// ПОЧЕМУ не mitata, которой меряют остальные разделы: она рассчитана на Node, а
// сравнение движков имеет смысл только когда секундомер у обоих буквально один.
// Здесь он простой до неинтересного: прогрев, `rounds` кругов по `iters`
// операций, медиана по кругам. Абсолютные числа выйдут чуть грубее mitata —
// но сравнимыми, а нужны именно они.
//
// ПОЧЕМУ наборы строятся здесь, а не берутся из `pack.mjs`: тот файл при импорте
// сразу всё меряет и пишет журнал. Генераторы намеренно повторены — и повторены
// с тем же LCG и тем же зерном, чтобы наборы в двух движках совпали побайтово.

/** Детерминированный LCG: наборы в Node и в Chromium обязаны совпасть до байта. */
function lcg(seed) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0
    return (state >>> 16) & 0xff
  }
}

/** FNV-1a 32 бита. Не крипта, а отпечаток: им сверяются выдачи двух движков. */
export function fnv(bytes) {
  let hash = 0x811c9dc5
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i]
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/** Куда уходят результаты, чтобы движок не выбросил замеряемый вызов целиком. */
let sink = 0

export function sinkValue() {
  return sink
}

function keep(value) {
  sink = (sink + value) >>> 0
}

/**
 * Медиана наносекунд на операцию.
 *
 * Медиана, а не среднее: в браузере между кругами случается работа, которой мы
 * не заказывали (GC, тик рендера), и она бьёт по среднему, а не по середине.
 *
 * ПОЧЕМУ `iters` у сценариев такие крупные: `performance.now()` в Chromium
 * загрублён до 5 мкс (защита от тайминговых атак), и мерить им один вызов
 * кодека нельзя вовсе. Круг из 20 000 операций даёт разрешение 0.25 нс на
 * операцию, из 20 разборов пачки — 250 нс на разбор при самом разборе около
 * миллисекунды. Отсюда же подозрительно круглые числа в браузерной колонке:
 * это шаг часов, а не выдумка.
 */
export function gauge(run, iters, rounds = 11) {
  for (let i = 0; i < iters; i++) run()

  const samples = []
  for (let r = 0; r < rounds; r++) {
    const started = performance.now()
    for (let i = 0; i < iters; i++) run()
    samples.push(((performance.now() - started) * 1e6) / iters)
  }

  samples.sort((a, b) => a - b)
  return samples[(samples.length - 1) >> 1]
}

/** То же для асинхронного вызова: `Link.hash` синхронным не бывает нигде. */
export async function gaugeAsync(run, iters, rounds = 7) {
  for (let i = 0; i < iters; i++) await run()

  const samples = []
  for (let r = 0; r < rounds; r++) {
    const started = performance.now()
    for (let i = 0; i < iters; i++) await run()
    samples.push(((performance.now() - started) * 1e6) / iters)
  }

  samples.sort((a, b) => a - b)
  return samples[(samples.length - 1) >> 1]
}

/**
 * Сценарии кросс-движкового замера.
 *
 * Взяты те точки, где расхождение движков вообще возможно и при этом дорого:
 * UTF-8 со суррогатными парами, сортировка ключей словаря, разбор контейнера
 * (гейт S2) и WebCrypto — единственное место, где мы вызываем чужую реализацию.
 */
export function makeCases(api) {
  const { Link, SandUnit, packDecode, packEncode, packPart, varyDecode, varyEncode } = api

  const rnd = lcg(20260815)
  const bin = (size) => {
    const out = new Uint8Array(size)
    for (let i = 0; i < size; i++) out[i] = rnd()
    return out
  }

  const peers = []
  for (let i = 0; i < 8; i++) peers.push(Link.peer(bin(8)))
  const land = Link.land(peers[0], bin(8))

  /** Типичное значение модели: словарь с не-ASCII ключами и строкой с эмодзи. */
  const value = {
    имя: 'ёжик',
    tags: ['a', 'b', 'c'],
    note: 'в тумане \u{1F32B}\u{FE0F} и рядом \u{1F468}‍\u{1F469}‍\u{1F467}',
    at: 1_700_000_000_000,
    ok: true,
    n: 42,
  }
  const valueBytes = varyEncode(value)

  const text = `ёжик ${'\u{1F32B}\u{FE0F}'.repeat(20)} в тумане`

  function flat(n) {
    const units = []
    for (let i = 0; i < n; i++) {
      units.push(SandUnit.make({
        peer: peers[i & 7],
        time: 1_700_000_000 + (i & 1023),
        tick: i & 3,
        self: Link.pawn(Link.hole, bin(6)),
        head: Link.pawn(Link.hole, bin(6)),
        lead: Link.pawn(Link.hole, bin(6)),
        value: { n: i, s: 'item' },
      }))
    }
    return [[land, packPart({ units })]]
  }

  const parts = flat(10_000)
  const packed = packEncode(parts)

  const links = []
  for (let i = 0; i < 64; i++) links.push(Link.pawn(Link.land(Link.peer(bin(8)), bin(8)), bin(6)).str)

  const hashInput = bin(64)

  return {
    // Отпечаток набора: если два движка построили разные исходные данные,
    // сравнивать их скорости бессмысленно, и это надо увидеть первым делом.
    fixture: fnv(packed),
    cases: [
      {
        name: 'vary/encode/dict',
        note: 'кодирование значения — бюджет S2 ≤ 1 мкс',
        iters: 20_000,
        run: () => keep(varyEncode(value).length),
        check: () => fnv(varyEncode(value)),
      },
      {
        name: 'vary/decode/dict',
        note: 'разбор того же значения',
        iters: 20_000,
        run: () => keep(varyDecode(valueBytes) === null ? 0 : 1),
        check: () => fnv(varyEncode(varyDecode(valueBytes))),
      },
      {
        name: 'vary/encode/emoji',
        note: 'строка из суррогатных пар — тот самый UTF-8, где движки и расходятся',
        iters: 20_000,
        run: () => keep(varyEncode(text).length),
        check: () => fnv(varyEncode(text)),
      },
      {
        name: 'pack/decode/10000',
        note: 'гейт S2 — разбор пачки на 10 000 юнитов ≤ 20 мс',
        iters: 20,
        run: () => keep(packDecode(packed).length),
        check: () => fnv(packEncode(packDecode(packed))),
      },
      {
        name: 'pack/encode/10000',
        note: 'обратная сторона провода',
        iters: 20,
        run: () => keep(packEncode(parts).length),
        check: () => fnv(packEncode(parts)),
      },
      {
        name: 'link/parse',
        note: 'разбор текста ссылки: свой base64url в обе стороны',
        iters: 5_000,
        run: () => {
          for (const str of links) keep(Link.parse(str).bin.length)
        },
        check: () => fnv(new TextEncoder().encode(links.map(str => Link.parse(str).str).join(''))),
      },
      {
        name: 'link/hash',
        note: 'WebCrypto — единственное место, где считает не наш код',
        iters: 2_000,
        async: true,
        run: async () => keep((await Link.hash(hashInput)).bin.length),
        check: async () => fnv((await Link.hash(hashInput, 22)).bin),
      },
    ],
  }
}

/** Прогон всех сценариев одним движком. Вызывается и в Node, и на странице. */
export async function runAll(api) {
  const { fixture, cases } = makeCases(api)
  const out = { fixture, cases: {} }

  for (const item of cases) {
    const ns = item.async
      ? await gaugeAsync(item.run, item.iters)
      : gauge(item.run, item.iters)
    out.cases[item.name] = {
      note: item.note,
      ns: Math.round(ns * 100) / 100,
      check: await item.check(),
    }
  }

  out.sink = sinkValue()
  return out
}
