// Подпись и проверка на ГРАНИЦЕ ПАЧКИ — там же, где шифрование (`sealed.ts`).
//
// `signPack` дописывает в каждую секцию ленда печати (`Seal`) над хэшами её
// САНДОВ; `verifyPack` оставляет только те санды, чей хэш покрыт валидной
// печатью от пира с достаточным рангом, а остальные молча выкидывает. Паспорта
// и печати проходят насквозь — их везёт сервер-релей, чтобы третье устройство
// тоже могло проверить.
//
// Encrypt-then-sign: подписываются хэши уже ЗАПЕЧАТАННЫХ юнитов, поэтому эти
// функции работают ПОСЛЕ `sealPack` и ДО `openPack` — над шифртекстом. Сервер,
// подменивший payload или заголовок, ломает хэш и не может пересобрать печать:
// закрытого ключа у него нет.
//
// ─── Печать детерминирована ──────────────────────────────────────────────────
//
// Метка печати выводится из МАКСИМАЛЬНОЙ метки покрываемых юнитов, а не из
// часов подписанта. Вместе с детерминизмом Ed25519 это даёт побайтово ТУ ЖЕ
// печать при переподписи того же набора (двум серверам, при ретрае до эха) —
// повторная доставка идемпотентна, дубликаты печатей не копятся, а ключ
// хранения (`unitKeyAt`: peer/метка/XOR-свёртка хэшей) различает печати разных
// наборов даже при совпавшей метке.

import { Link } from '../binary/link'
import { packDecode, packEncode, packPart, type PackParts } from '../binary/pack'
import { PassUnit, SandUnit, SealUnit, SHOT_BYTES, shotKey, type AnyUnit } from '../binary/unit'
import { shotInto } from '../binary/sha256'
import { createAuditor, SEAL_MAX, type Auditor, type Signer } from './signer'
import { rateOf, tierAllows, tierOf, TIER } from './rank'
import { leadingZeroBits } from './signer'

/**
 * Хэш юнита — СИНХРОННО, через собственный SHA-256 ядра (`binary/sha256.ts`,
 * дифференциально сверен с WebCrypto). `Unit.hash` асинхронен по контракту
 * WebCrypto, и на пачке в тысячи юнитов это тысячи переходов в натив и кругов
 * микрозадач; `shotInto` на коротком входе в ~20 раз дешевле (замер в шапке
 * sha256.ts) — тот же приём, что у нонса в `sealed.ts`.
 */
function shotOf(unit: AnyUnit): Uint8Array {
  const shot = new Uint8Array(SHOT_BYTES)
  shotInto(shot, 0, unit.bin, 0, unit.bin.length)
  return shot
}

export interface Roster {
  /** Ранг пира: старшие 4 бита tier, младшие — минимальный rate. Нет — deny. */
  rankOf(peer: Link): number | undefined
}

export interface SignOptions {
  /** Требуемая сложность записи (ведущие нули подписи). По умолчанию 0. */
  readonly rate?: number
  /** Приложить паспорт подписанта к секции с новыми печатями. По умолчанию — да. */
  readonly withPass?: boolean
  /**
   * Чьи ПРИЛОЖЕННЫЕ печати считать покрытием. По умолчанию — только свои:
   * санд, покрытый нашей же печатью (эхо), не пере-подписывается. С ростером
   * покрытие расширяется на печати доверенных пиров — чужие живые данные едут
   * под родной печатью, а вот санды ОТОЗВАННОГО пира (он вне ростера) получают
   * нашу печать-поручительство и остаются читаемыми у получателей.
   */
  readonly cover?: Roster
}

/**
 * Подписать пачку: на каждую секцию ленда — печати над хэшами непокрытых
 * сандов и (по умолчанию) паспорт подписанта.
 *
 * Хэши считаются асинхронно (`Unit.hash`, батчем через Promise.all — на пачке
 * в тысячи юнитов последовательный await стоил бы тысяч кругов микрозадач);
 * санды дробятся по {@link SEAL_MAX} на печать.
 */
export async function signPack(bin: Uint8Array, signer: Signer, opts: SignOptions = {}): Promise<Uint8Array> {
  const out: PackParts = []

  for (const [land, part] of packDecode(bin)) {
    // Покрытие: хэши из уже приложенных печатей — наших всегда, доверенных
    // пиров при переданном `cover` (см. SignOptions).
    const covered = new Set<string>()
    let hasPass = false
    for (const unit of part.units) {
      if (unit instanceof SealUnit) {
        const its = unit.peer()
        const trusted = its.str === signer.peer.str
          || (opts.cover !== undefined && allowsPost(opts.cover, its))
        if (trusted) {
          for (const shot of unit.hashes()) covered.add(shotKey(shot))
        }
      }
      else if (unit instanceof PassUnit && unit.peer().str === signer.peer.str) {
        hasPass = true
      }
    }

    const pending: SandUnit[] = []
    const pendingHashes: Uint8Array[] = []
    for (const unit of part.units) {
      if (!(unit instanceof SandUnit)) continue
      const shot = shotOf(unit)
      if (covered.has(shotKey(shot))) continue
      pending.push(unit)
      pendingHashes.push(shot)
    }

    const extra: AnyUnit[] = []
    if ((opts.withPass ?? true) && !hasPass && pending.length > 0) {
      // Метка паспорта нулевая НАМЕРЕННО: паспорт — константа пира (ключ по
      // `peer`), и детерминированные байты делают переиздание точным дублем —
      // приём гасит его как повтор, вместо LWW-чехарды одинаковых паспортов.
      extra.push(await signer.pass({ time: 0, tick: 0 }))
    }

    for (let from = 0; from < pending.length; from += SEAL_MAX) {
      const batch = pendingHashes.slice(from, from + SEAL_MAX)
      // Метка печати — максимум меток покрываемых юнитов: детерминизм (см.
      // шапку). Наборы разных печатей не пересекаются, поэтому у СВОИХ юнитов
      // (метка строго растёт на пира) и максимумы различны; совпадение на чужих
      // юнитах разводит XOR-свёртка в ключе хранения.
      let time = 0
      let tick = 0
      for (let i = from; i < Math.min(from + SEAL_MAX, pending.length); i++) {
        const unit = pending[i] as SandUnit
        const t = unit.time()
        const k = unit.tick()
        if (t > time || (t === time && k > tick)) {
          time = t
          tick = k
        }
      }
      extra.push(await signer.seal(land, batch, { time, tick }, opts.rate ?? 0))
    }

    // Печати и паспорт кладутся ПОСЛЕ данных секции: порядок в пачке — порядок
    // списка, а получатель всё равно собирает их в карты до проверки.
    out.push([land, packPart({ faces: part.faces, units: [...part.units, ...extra], balls: part.balls })])
  }

  return packEncode(out)
}

export interface VerifyResult {
  /** Пачка, очищенная от неаутентичных сандов; печати и паспорта сохранены. */
  readonly pack: Uint8Array
  /** Сколько сандов выброшено как неподписанные или недоверенные. */
  readonly dropped: number
}

/**
 * Проверить пачку против ростера прав.
 *
 * Санд остаётся, если существует валидная печать доверенного пира (tier ≥ post,
 * подпись добила его rate), содержащая хэш санда. Паспорта из пачки
 * подхватываются в проверяльщик (ключ для проверки печатей), но доверяются
 * только пиры из ростера — паспорт лишь поставляет ключ к уже разрешённому
 * `peer` (peer = хэш ключа, подделать нельзя).
 *
 * `shared` — общий проверяльщик между пачками: импорт ключа пира случается
 * один раз на сессию, а не на кадр.
 */
export async function verifyPack(bin: Uint8Array, roster: Roster, shared?: Auditor): Promise<VerifyResult> {
  const auditor = shared ?? createAuditor()
  const out: PackParts = []
  let dropped = 0

  for (const [land, part] of packDecode(bin)) {
    // 1. Паспорта → ключи. Учим только те, чей peer есть в ростере.
    for (const unit of part.units) {
      if (unit instanceof PassUnit && !auditor.knows(unit.peer()) && roster.rankOf(unit.peer()) !== undefined) {
        await auditor.learn(unit)
      }
    }

    // 2. Печати → множество доверенных хэшей. Печать валидна, если подпись
    //    сходится, пир имеет tier ≥ post и подпись добила его rate.
    const trusted = new Set<string>()
    for (const unit of part.units) {
      if (!(unit instanceof SealUnit)) continue
      const rank = roster.rankOf(unit.peer())
      if (rank === undefined || !tierAllows(tierOf(rank), TIER.post)) continue
      if (leadingZeroBits(unit.sign()) < rateOf(rank)) continue
      if (!(await auditor.verify(land, unit))) continue
      for (const shot of unit.hashes()) trusted.add(shotKey(shot))
    }

    // 3. Санды без покрытия — за борт. Паспорта, печати, гифты едут дальше.
    //    Хэшей нет смысла считать вовсе, когда доверенных печатей ноль: все
    //    санды секции обречены, а SHA-256 на каждый — выброшенная работа.
    const kept: AnyUnit[] = []
    if (trusted.size === 0) {
      for (const unit of part.units) {
        if (unit instanceof SandUnit) dropped += 1
        else kept.push(unit)
      }
    }
    else {
      // По ХЭШУ ВСЕГО юнита — им же печать покрывает санд (не `shot()`, тот
      // про выносное значение). Синхронно: см. shotOf.
      for (const unit of part.units) {
        if (!(unit instanceof SandUnit)) {
          kept.push(unit)
          continue
        }
        if (trusted.has(shotKey(shotOf(unit)))) kept.push(unit)
        else dropped += 1
      }
    }

    out.push([land, packPart({ faces: part.faces, units: kept, balls: part.balls })])
  }

  return { pack: packEncode(out), dropped }
}

function allowsPost(roster: Roster, peer: Link): boolean {
  const rank = roster.rankOf(peer)
  return rank !== undefined && tierAllows(tierOf(rank), TIER.post)
}
