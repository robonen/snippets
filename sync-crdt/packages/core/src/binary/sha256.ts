// v8:hot — считается на КАЖДОЙ записи длинного значения: `shot` санда это
// SHA-256[0..12) от `ball` (docs/03 §2), а запись синхронна.
//
// ─── Почему своя реализация, хотя рядом лежит WebCrypto ──────────────────────
//
// `unit.ts` прямо обещал обратного: «синхронного SHA-256 в браузере нет, и
// городить свой ради одной подписи значит завести вторую реализацию хэша,
// которую придётся сверять с первой». Обещание пришлось нарушить, и причина
// названа, а не замолчана:
//
//   `Land.write` СИНХРОНЕН — на этом стоит ADR-002 («`pawn.title()` остаётся
//   синхронным, хотя под ним IDB»). Значение длиннее 62 байт обязано уехать в
//   `ball`, а в юните обязан остаться его хэш. Значит хэш нужен ВНУТРИ
//   синхронного вызова, а `crypto.subtle.digest` асинхронен по контракту
//   WebCrypto везде, где мы живём.
//
// Развилок было три, и две отвергнуты по существу:
//   1. Приостанавливать файбер на записи. Отвергнуто: запись приходит из
//      обработчика события, а не из файбера, и приостановить её негде.
//   2. Отложить хэш и дописать его в юнит потом. Отвергнуто: юнит иммутабелен, а
//      его собственный хэш уходит в `Seal` (S6) — дописывание сделало бы
//      подписанные байты зависящими от момента.
//   3. Считать хэш здесь и сверять с WebCrypto ТЕСТОМ. Выбрано.
//
// Опасение «второй источник правды» снимается тем, как это проверяется: боевой
// путь один (эта функция), а WebCrypto остаётся ОРАКУЛОМ дифференциального
// теста — ровно та же схема, что у `orderNaive` против `order` (PRINCIPLES.md,
// правило 2: «референсная наивная реализация и тест эквивалентности»).
//
// ─── Цена ────────────────────────────────────────────────────────────────────
//
// Замер (`bench/store.mjs`, раздел «пол платформы»): 91 Б — 0.62 мкс против
// 11.9 мкс у `crypto.subtle.digest` на том же входе в Node (WebCrypto на
// коротком входе платит за переход в нативный код, замер S2 показывал то же на
// `link/hash`). На 64 КиБ обратное: 235 мкс против 78. Порог примерно 8 КиБ,
// но выбора всё равно нет — асинхронный вариант в синхронную запись не встаёт.

/**
 * Константы алгоритма: первые 32 бита дробных частей кубических корней первых 64
 * простых чисел (FIPS 180-4 §4.2.2). Один раз на модуль (правило 7).
 */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

/** Начальное состояние: дробные части квадратных корней первых восьми простых. */
const H0 = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
])

const BLOCK = 64
const DIGEST = 32

/**
 * Расписание сообщения — скрэтч на модуль, а не аллокация на блок (правило 8).
 *
 * Мутировать его можно потому, что весь путь от входа до выхода синхронный и
 * прямолинейный: между заполнением и использованием нет ни одного вызова наружу,
 * значит второго читателя у скрэтча не бывает.
 */
const W = new Uint32Array(64)

/** Последний блок с добивкой. Максимум два блока: 64 Б хвоста плюс 8 Б длины. */
const TAIL = new Uint8Array(BLOCK * 2)

const STATE = new Uint32Array(8)

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n))
}

/** Один раунд компрессии по 64 байтам, лежащим со смещения `at`. */
function block(bin: Uint8Array, at: number): void {
  for (let i = 0; i < 16; i++) {
    const p = at + i * 4
    W[i] = ((bin[p] as number) << 24) | ((bin[p + 1] as number) << 16) | ((bin[p + 2] as number) << 8) | (bin[p + 3] as number)
  }
  for (let i = 16; i < 64; i++) {
    const x = W[i - 15] as number
    const y = W[i - 2] as number
    const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)
    const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10)
    W[i] = ((W[i - 16] as number) + s0 + (W[i - 7] as number) + s1) >>> 0
  }

  let a = STATE[0] as number
  let b = STATE[1] as number
  let c = STATE[2] as number
  let d = STATE[3] as number
  let e = STATE[4] as number
  let f = STATE[5] as number
  let g = STATE[6] as number
  let h = STATE[7] as number

  for (let i = 0; i < 64; i++) {
    const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
    const ch = (e & f) ^ (~e & g)
    const t1 = (h + s1 + ch + (K[i] as number) + (W[i] as number)) >>> 0
    const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
    const maj = (a & b) ^ (a & c) ^ (b & c)
    const t2 = (s0 + maj) >>> 0

    h = g
    g = f
    f = e
    e = (d + t1) >>> 0
    d = c
    c = b
    b = a
    a = (t1 + t2) >>> 0
  }

  STATE[0] = (STATE[0] as number) + a
  STATE[1] = (STATE[1] as number) + b
  STATE[2] = (STATE[2] as number) + c
  STATE[3] = (STATE[3] as number) + d
  STATE[4] = (STATE[4] as number) + e
  STATE[5] = (STATE[5] as number) + f
  STATE[6] = (STATE[6] as number) + g
  STATE[7] = (STATE[7] as number) + h
}

/**
 * SHA-256 куска буфера — синхронно.
 *
 * Пишет результат в `out` (32 байта) и его же возвращает, чтобы вызывающий мог
 * переиспользовать приёмник: `shotAt` берёт из него первые 12 байт и общего
 * буфера на юнит не заводит.
 *
 * @example
 * ```ts
 * const digest = sha256(payload, 0, payload.length, new Uint8Array(32))
 * ```
 */
export function sha256(bin: Uint8Array, from: number, size: number, out: Uint8Array): Uint8Array {
  STATE.set(H0)

  const whole = size - (size % BLOCK)
  for (let at = 0; at < whole; at += BLOCK) block(bin, from + at)

  // Хвост: остаток, байт 0x80, нули и 8 байт длины в битах (big-endian). Длина
  // помещается в 32 бита с запасом — `ball` не длиннее 65535 байт (docs/03 §2),
  // но формула общая, потому что этой же функцией считается хэш юнита.
  const rest = size - whole
  const span = rest + 9 > BLOCK ? BLOCK * 2 : BLOCK
  TAIL.fill(0, 0, span)
  for (let i = 0; i < rest; i++) TAIL[i] = bin[from + whole + i] as number
  TAIL[rest] = 0x80

  const bits = size * 8
  // Старшие четыре байта длины — через деление, а не сдвиг: сдвиг в JS работает
  // на 32 битах, и вход длиннее 512 МБ дал бы неверный хэш молча.
  const high = Math.floor(bits / 0x1_0000_0000)
  TAIL[span - 8] = (high >>> 24) & 0xff
  TAIL[span - 7] = (high >>> 16) & 0xff
  TAIL[span - 6] = (high >>> 8) & 0xff
  TAIL[span - 5] = high & 0xff
  TAIL[span - 4] = (bits >>> 24) & 0xff
  TAIL[span - 3] = (bits >>> 16) & 0xff
  TAIL[span - 2] = (bits >>> 8) & 0xff
  TAIL[span - 1] = bits & 0xff

  for (let at = 0; at < span; at += BLOCK) block(TAIL, at)

  for (let i = 0; i < 8; i++) {
    const word = STATE[i] as number
    const p = i * 4
    out[p] = (word >>> 24) & 0xff
    out[p + 1] = (word >>> 16) & 0xff
    out[p + 2] = (word >>> 8) & 0xff
    out[p + 3] = word & 0xff
  }
  return out
}

/** Полный дайджест свежим буфером — для тестов и сверки с оракулом. */
export function sha256Of(bin: Uint8Array): Uint8Array {
  return sha256(bin, 0, bin.length, new Uint8Array(DIGEST))
}

/**
 * Приёмник для {@link shotInto}: один на модуль, потому что `shot` кладётся в
 * юнит копированием и наружу не уходит.
 */
const SHOT = new Uint8Array(DIGEST)

/**
 * Первые 12 байт SHA-256 куска буфера — то самое поле `shot` санда.
 *
 * Кладёт результат прямо в `dst` со смещения `at`: промежуточного массива на
 * запись не заводится вовсе.
 */
export function shotInto(dst: Uint8Array, at: number, src: Uint8Array, from: number, size: number): void {
  sha256(src, from, size, SHOT)
  for (let i = 0; i < 12; i++) dst[at + i] = SHOT[i] as number
}
