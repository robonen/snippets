// Шифрование ленда: шифруется только payload санда, заголовки остаются
// открытыми (docs/07 §4, идея из baza: `sand_encode`/`sand_open`).
//
// Почему граница — payload, а не пачка целиком. LWW-слияние читает только
// заголовок юнита (`time, peer, tick` для арбитража, `head, self, lead` для
// раскладки) и никогда не смотрит в значение. Если зашифровать только payload,
// пир БЕЗ ключа всё равно может сливать, хранить и досылать ленд — сервер
// остаётся обычным пиром ядра. Если бы шифровалась вся пачка, сервер не мог бы
// ни слить две пачки, ни посчитать дельту, и эту работу пришлось бы
// переизобретать в приложении (так и было в первой редакции brain).
//
// Две формы юнита. Открытая и запечатанная формы различаются только payload и
// битами длины в `meta`: GCM добавляет 16 байт метки, поэтому значение около
// границы inline (47…62 Б) в запечатанной форме переезжает в `ball` и обратно.
// На хранение и LWW это не влияет: ключ юнита и арбитраж читаются из общей
// части, одинаковой у обеих форм. Обе трансформации детерминированы, поэтому
// `seal(open(x)) === x` и `open(seal(y)) === y` побайтово (есть тест).
//
// Нонс не хранится, а выводится. GCM требует уникальный нонс на ключ; хранить
// его негде (пришлось бы менять формат) и незачем — адрес юнита уникален сам.
// Нонс — первые 12 байт SHA-256 от `landId ‖ tag ‖ time ‖ tick ‖ peer ‖ self ‖
// head ‖ lead`; эта же связка целиком идёт в AAD. Уникальность держится на двух
// инвариантах ядра: (1) `(time, tick)` у одного пира строго растёт при каждой
// записи; (2) одновременные экземпляры одного пира используют разные сеансы
// чеканки id (ADR-017), поэтому различаются `self`. Подмешанный landId не даёт
// подсунуть шифртекст одного ленда в другой.
//
// Чего эта граница не даёт: заголовки видны пиру без ключа (кто, когда, в какой
// узел писал) — осознанный размен ради слияния на сервере. Подлинность юнитов
// обеспечивают подписи (`signed.ts`), а не GCM: без них порча payload ловится,
// но подделка заголовка нового юнита — нет.

import { align8, writeU16 } from '../binary/bytes'
import { type LandId, packDecode, packEncode, packPart, type PackParts } from '../binary/pack'
import { SAND_AT, type AnyUnit, SandUnit, Unit, UNIT_AT, UNIT_BYTES, shotKey } from '../binary/unit'
import { shotInto } from '../binary/sha256'
import type { SubtleKey } from './keys'

/**
 * Откуда брать секрет ленда. `null` — ленд открытый: его секция едет как есть.
 * Ключи живут у приложения (связка ключей, замок) — ядро их не хранит и не
 * кэширует (ADR-010: DI).
 */
export interface SecretRing {
  secretOf(land: LandId): SubtleKey | null | Promise<SubtleKey | null>
}

/** Один ключ на всё либо связка по лендам: пачка с сервера везёт НЕСКОЛЬКО лендов. */
export type PackKeys = SubtleKey | SecretRing

function ringOf(keys: PackKeys): SecretRing {
  return 'secretOf' in keys ? keys : { secretOf: () => keys }
}

/**
 * Отказ крипто-слоя: чужой ключ, порча байта, значение не влезает после
 * шифрования. Исключительное, а не значение (PRINCIPLES.md, раздел «Ошибки»).
 */
export class CryptoError extends Error {
  readonly reason: string
  readonly at: string

  constructor(reason: string, at: string, cause?: unknown) {
    super(at === '' ? reason : `${reason} — ${at}`, cause === undefined ? undefined : { cause })
    this.name = 'CryptoError'
    this.reason = reason
    this.at = at
  }
}

const INLINE_MAX = UNIT_BYTES.inlineMax
const INLINE_BIG = UNIT_BYTES.inlineBig
const BALL_MAX = UNIT_BYTES.ballMax
/** Метка GCM — хвост шифртекста. Запечатанный payload короче не бывает. */
const TAG_BYTES = 16
/** Старшие два бита `meta` — `tag` санда; младшие шесть — длина, у форм разная. */
const TAG_MASK = 0b1100_0000

const LAND_BYTES = 16
/** Связка: ленд (16, хвост нулевой) ‖ tag (1) ‖ байты 2…34 юнита (time, tick, peer, self, head, lead). */
const BIND_BYTES = LAND_BYTES + 1 + (SAND_AT.size - UNIT_AT.time)
const NONCE_BYTES = 12

/** Потолок ОТКРЫТОГО значения: после шифрования оно обязано влезть в `ball`. */
const PLAIN_MAX = BALL_MAX - TAG_BYTES

/**
 * Связка юнита с местом: она же AAD, из неё же выводится нонс.
 *
 * Байты 2…34 у обеих форм совпадают (см. шапку), поэтому связка считается
 * одинаково при запечатывании открытой формы и распечатывании запечатанной.
 */
function bindOf(land: LandId, src: Uint8Array): Uint8Array {
  const out = new Uint8Array(BIND_BYTES)
  out.set(land.bin, 0)
  out[LAND_BYTES] = (src[UNIT_AT.meta] as number) & TAG_MASK
  out.set(src.subarray(UNIT_AT.time, SAND_AT.size), LAND_BYTES + 1)
  return out
}

/** Санд с тем же адресом и меткой, но другой полезной нагрузкой. */
function sandWith(src: Uint8Array, payload: Uint8Array): { unit: SandUnit, ball: Uint8Array | null } {
  if (payload.length <= INLINE_MAX) {
    const bin = new Uint8Array(align8(SAND_AT.payload + payload.length))
    bin.set(src.subarray(0, SAND_AT.size), 0)
    bin[UNIT_AT.meta] = ((src[UNIT_AT.meta] as number) & TAG_MASK) | payload.length
    bin.set(payload, SAND_AT.payload)
    return { unit: SandUnit.wrap(bin), ball: null }
  }

  const bin = new Uint8Array(SAND_AT.shot + UNIT_BYTES.shot)
  bin.set(src.subarray(0, SAND_AT.size), 0)
  bin[UNIT_AT.meta] = ((src[UNIT_AT.meta] as number) & TAG_MASK) | INLINE_BIG
  writeU16(bin, SAND_AT.size, payload.length)
  shotInto(bin, SAND_AT.shot, payload, 0, payload.length)
  return { unit: SandUnit.wrap(bin), ball: payload }
}

/** Полезная нагрузка санда: inline из юнита либо приложенный `ball`. */
function payloadOf(unit: SandUnit, balls: ReadonlyMap<string, Uint8Array>, at: string): Uint8Array {
  if (!unit.big()) return unit.bin.subarray(SAND_AT.payload, SAND_AT.payload + unit.size())

  const key = shotKey(unit.shot())
  const ball = balls.get(key)
  // packDecode обязан был приложить ball — его отсутствие означает битую пачку.
  if (ball === undefined) throw new CryptoError(`sand carries external value ${key}, but no ball is attached`, at)
  return ball
}

async function sealUnit(
  unit: SandUnit,
  balls: ReadonlyMap<string, Uint8Array>,
  land: LandId,
  key: SubtleKey,
  at: string,
): Promise<{ unit: SandUnit, ball: Uint8Array | null }> {
  const plain = payloadOf(unit, balls, at)
  if (plain.length > PLAIN_MAX) {
    throw new CryptoError(
      `value takes ${plain.length} B, but after the GCM tag the external cap is ${PLAIN_MAX}`,
      at,
    )
  }

  const bind = bindOf(land, unit.bin)
  const nonce = new Uint8Array(NONCE_BYTES)
  shotInto(nonce, 0, bind, 0, BIND_BYTES)

  const cipher = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: bind },
    key,
    plain as Uint8Array<ArrayBuffer>,
  ))
  return sandWith(unit.bin, cipher)
}

async function openUnit(
  unit: SandUnit,
  balls: ReadonlyMap<string, Uint8Array>,
  land: LandId,
  key: SubtleKey,
  at: string,
): Promise<{ unit: SandUnit, ball: Uint8Array | null }> {
  const cipher = payloadOf(unit, balls, at)
  if (cipher.length < TAG_BYTES) {
    throw new CryptoError(
      `payload ${cipher.length} B is shorter than the GCM tag (${TAG_BYTES}) — the pack does not look sealed`,
      at,
    )
  }

  const bind = bindOf(land, unit.bin)
  const nonce = new Uint8Array(NONCE_BYTES)
  shotInto(nonce, 0, bind, 0, BIND_BYTES)

  let plain: ArrayBuffer
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: bind },
      key,
      cipher as Uint8Array<ArrayBuffer>,
    )
  } catch (cause) {
    // WebCrypto на любом несовпадении бросает пустой OperationError; координата
    // и причина по-человечески — наша работа.
    throw new CryptoError('wrong key, corrupted byte, or swapped address — GCM tag mismatch', at, cause)
  }
  return sandWith(unit.bin, new Uint8Array(plain))
}

type UnitJob = Promise<{ unit: SandUnit, ball: Uint8Array | null } | null> | AnyUnit

async function transform(
  bin: Uint8Array,
  keys: PackKeys,
  work: typeof sealUnit,
  onDrop: ((error: CryptoError) => void) | null,
): Promise<Uint8Array> {
  const ring = ringOf(keys)
  const out: PackParts = []

  for (const [land, part] of packDecode(bin)) {
    // Ленд без секрета едет как есть — открытые ленды (служебные, публичные)
    // живут в одной пачке с запечатанными.
    const key = await ring.secretOf(land)
    if (key === null) {
      out.push([land, part])
      continue
    }
    // Шифрования на юнит запускаются пачкой и ждутся разом: последовательный
    // `await` на 10 000 юнитов стоил бы 10 000 кругов микрозадач.
    const jobs: UnitJob[] = []
    let index = 0
    for (const unit of part.units) {
      if (!(unit instanceof SandUnit)) {
        jobs.push(unit)
        index += 1
        continue
      }
      const job = work(unit, part.balls, land, key, `land ${land.str}, unit #${index}`)
      // Пощада вместо отказа: юнит, который не открыть, выбывает из пачки
      // ПООДИНОЧКЕ (см. openPack). Не-крипто ошибки пощады не заслуживают.
      jobs.push(onDrop === null
        ? job
        : job.catch((error: unknown) => {
            if (!(error instanceof CryptoError)) throw error
            onDrop(error)
            return null
          }))
      index += 1
    }

    const units: AnyUnit[] = []
    const balls = new Map<string, Uint8Array>()
    for (const done of await Promise.all(jobs)) {
      if (done === null) continue
      // gift/seal/pass едут как есть: gift.code уже шифртекст по построению,
      // подпись и паспорт — публичные данные.
      if (done instanceof Unit) {
        units.push(done as AnyUnit)
        continue
      }
      units.push(done.unit)
      if (done.ball !== null) balls.set(shotKey(done.unit.shot()), done.ball)
    }

    out.push([land, packPart({ faces: part.faces, units, balls })])
  }

  return packEncode(out)
}

/**
 * Запечатать пачку: payload каждого санда шифруется секретом ленда, заголовки,
 * фейсы и юниты остальных видов остаются открытыми.
 *
 * Пачка на выходе КАНОНИЧЕСКАЯ (свободные слоты арены не переживают дорогу —
 * ровно как при любом `encode(decode(x))`). Повторное запечатывание уже
 * запечатанной пачки — выход за контракт: дисциплину границы держит вызывающий
 * (хранилище и провод — запечатанное, память ленда — открытое).
 *
 * @throws {CryptoError} если значение после шифрования не влезает в `ball`
 * (открытых больше {@link PLAIN_MAX} байт формат уже не везёт).
 */
export function sealPack(bin: Uint8Array, keys: PackKeys): Promise<Uint8Array> {
  return transform(bin, keys, sealUnit, null)
}

/**
 * Распечатать пачку, запечатанную {@link sealPack} тем же секретом.
 *
 * С `onDrop` юнит, который не открылся, ПРОПУСКАЕТСЯ (та же дисциплина, что у
 * `verifyPack` с неаутентичным): пир без ключа хранит и досылает всё подряд,
 * и один юнит, запечатанный недоступным секретом (устройство успело залить
 * свои заготовки до подключения; смена секретов при отзыве), не должен
 * навсегда глушить каждую его дельту целиком. Выбывший юнит не применяется и
 * не попадает в фейсы — сервер честно пришлёт его снова, и он снова выбудет.
 *
 * @throws {CryptoError} без `onDrop` — на чужом ключе, порче любого байта
 * payload и подмене адреса (юнит из другого ленда, чужие `self`/`head`/`lead`/
 * метка): всё это ловит метка GCM, потому что связка адреса целиком лежит в
 * AAD. Хранилище (`sealedStore`) ходит строгим путём: там чужому секрету
 * взяться неоткуда, и тихий пропуск прятал бы порчу носителя.
 */
export function openPack(
  bin: Uint8Array,
  keys: PackKeys,
  onDrop?: (error: CryptoError) => void,
): Promise<Uint8Array> {
  return transform(bin, keys, openUnit, onDrop ?? null)
}
