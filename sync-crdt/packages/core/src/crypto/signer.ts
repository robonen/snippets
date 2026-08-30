// Подписи (docs/07 §3): аутентичность — свойство юнита, а не канала доставки.
// Идея seal/pass взята из baza.
//
// Подписывается не каждый юнит, а `Seal` — список из ≤15 хэшей запечатанных
// юнитов (encrypt-then-sign: подпись покрывает ровно те байты, что уедут на
// провод, поэтому сервер, меняющий payload, ломает и подпись). Юнит считается
// достоверным, если есть валидный `Seal`, содержащий его хэш. Выигрыш: одна
// ECDSA/EdDSA-операция на десяток изменений.
//
// В подпись идёт `landId ‖ seal.sens()` — байты печати без хвостовой подписи
// плюс адрес ленда. Адрес нужен, чтобы печать нельзя было перенести в другой
// ленд (тот же приём, что у нонса в `sealed.ts`). PoW: `tick` перебирается,
// пока подпись не наберёт `rateBits` ведущих нулей; по умолчанию выключен
// (rate=0, ADR-009).
//
// Алгоритм: Ed25519, где платформа умеет (Node 20+, свежие браузеры), иначе
// ECDSA P-256; выбор записан в meta паспорта. `peer` = SHA-256[0..8) от
// публичного ключа (ADR-007): подделать автора = подобрать прообраз хэша.

import { Link } from '../binary/link'
import { SealUnit, PassUnit, type PassAlgo, type UnitStamp } from '../binary/unit'
import { CryptoError } from './sealed'
import type { SubtleKey, SubtleKeyPair } from './keys'

const SIGN_BYTES = 64
const SHOT_BYTES = 12
const PEER_BYTES = 8
/** Хэшей в одной печати — столько же, сколько влезает в 4 бита meta (docs/03). */
export const SEAL_MAX = 15

const EDDSA = { name: 'Ed25519' } as const
const ECDSA_GEN = { name: 'ECDSA', namedCurve: 'P-256' } as const
const ECDSA_SIGN = { name: 'ECDSA', hash: 'SHA-256' } as const

/** Личность-подписант: закрытая половина, недоступная наружу (ADR docs/07 §2). */
export interface Signer {
  readonly algo: PassAlgo
  /** Публичный ключ пира — 32 Б Ed25519 или 65 Б несжатой точки P-256. */
  readonly pub: Uint8Array
  /** `peer` = SHA-256[0..8) от публичного ключа. Идентичность в юнитах. */
  readonly peer: Link
  /** Паспорт: публичный ключ как юнит, едет в ленде и проверяется получателем. */
  pass(stamp: Omit<UnitStamp, 'peer'>): Promise<PassUnit>
  /** Подписать печать: собрать `Seal` над хэшами с привязкой к ленду и PoW. */
  seal(land: Link, hashes: readonly Uint8Array[], stamp: SealStamp, rateBits?: number): Promise<SealUnit>
}

/** Метка печати: время/тик задаёт часы ленда, `tick` крутит PoW. */
export interface SealStamp {
  readonly time: number
  readonly tick: number
  readonly wide?: boolean
}

function algoParams(algo: PassAlgo): typeof EDDSA | typeof ECDSA_GEN {
  return algo === 'ed25519' ? EDDSA : ECDSA_GEN
}

function signParams(algo: PassAlgo): typeof EDDSA | typeof ECDSA_SIGN {
  return algo === 'ed25519' ? EDDSA : ECDSA_SIGN
}

async function peerOf(pub: Uint8Array): Promise<Link> {
  const digest = await crypto.subtle.digest('SHA-256', pub as Uint8Array<ArrayBuffer>)
  return Link.peer(new Uint8Array(digest).slice(0, PEER_BYTES))
}

/** `landId ‖ sens` — то, что реально уходит в подпись. Копия: WebCrypto читает. */
function bindLand(land: Link, sens: Uint8Array): Uint8Array {
  const out = new Uint8Array(land.bin.length + sens.length)
  out.set(land.bin, 0)
  out.set(sens, land.bin.length)
  return out
}

/** Сколько ведущих нулевых бит у подписи — мера PoW. */
function leadingZeroBits(sign: Uint8Array): number {
  let bits = 0
  for (const byte of sign) {
    if (byte === 0) {
      bits += 8
      continue
    }
    // `Math.clz32(byte)` считает нули в 32-битном слове — вычитаем 24 старших.
    bits += Math.clz32(byte) - 24
    break
  }
  return bits
}

/**
 * Свежая пара подписи. Приватный ключ НЕэкспортируемый: наружу не выходит
 * вовсе (ADR docs/07 §2 — лучше baza, где ключ лежит строкой).
 *
 * Ed25519 пробуется первым; платформа без него получает P-256.
 */
export async function mintSignerPair(prefer?: PassAlgo): Promise<{ algo: PassAlgo, pair: SubtleKeyPair }> {
  // `prefer: 'p256'` — см. mintExchangePair: ключ, который платформа не может
  // сохранить, бесполезен как личность устройства.
  if (prefer !== 'p256') {
    try {
      const pair = await crypto.subtle.generateKey(EDDSA, false, ['sign', 'verify']) as unknown as SubtleKeyPair
      return { algo: 'ed25519', pair }
    }
    catch {
      // Платформа без Ed25519 — P-256 ниже.
    }
  }
  const pair = await crypto.subtle.generateKey(ECDSA_GEN, false, ['sign', 'verify']) as unknown as SubtleKeyPair
  return { algo: 'p256', pair }
}

/** Личность над готовой парой — свежей или поднятой из хранилища (DI, ADR-010). */
export async function signerOf(algo: PassAlgo, pair: SubtleKeyPair): Promise<Signer> {
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  const peer = await peerOf(pub)

  async function rawSign(message: Uint8Array): Promise<Uint8Array> {
    const sig = await crypto.subtle.sign(signParams(algo), pair.privateKey, message as Uint8Array<ArrayBuffer>)
    return new Uint8Array(sig)
  }

  return {
    algo,
    pub,
    peer,

    async pass(stamp): Promise<PassUnit> {
      return PassUnit.make({ peer, time: stamp.time, tick: stamp.tick, algo, key: pub })
    },

    async seal(land, hashes, stamp, rateBits = 0): Promise<SealUnit> {
      if (hashes.length > SEAL_MAX) {
        throw new CryptoError(`a seal fits ${SEAL_MAX} hashes, got ${hashes.length}`, `land ${land.str}`)
      }
      for (const shot of hashes) {
        if (shot.length !== SHOT_BYTES) {
          throw new CryptoError(`a seal hash is ${SHOT_BYTES} B, got ${shot.length}`, `land ${land.str}`)
        }
      }

      // PoW крутит `tick`: каждая метка меняет `sens`, значит и подпись.
      // Заготовка с нулевой подписью нужна только ради `sens()` — байт до
      // хвоста; сам хвост подписи здесь пока произвольный.
      const zero = new Uint8Array(SIGN_BYTES)
      let tick = stamp.tick
      let sign: Uint8Array
      let sens: Uint8Array
      for (;;) {
        const draft = SealUnit.make({
          peer,
          time: stamp.time,
          tick,
          hashes,
          sign: zero,
          ...(stamp.wide === true && { wide: true }),
        })
        sens = draft.sens()
        sign = await rawSign(bindLand(land, sens))
        if (leadingZeroBits(sign) >= rateBits) break
        tick += 1
        if (tick > 0xffff) {
          throw new CryptoError(`PoW rate=${rateBits} not met within a second`, `land ${land.str}`)
        }
      }

      return SealUnit.make({
        peer,
        time: stamp.time,
        tick,
        hashes,
        sign,
        ...(stamp.wide === true && { wide: true }),
      })
    },
  }
}

/** Проверяльщик: только публичная сторона. Держит импортированные ключи пиров. */
export interface Auditor {
  /** Принять паспорт: `peer` == хэш ключа и алгоритм известен. Кэширует ключ. */
  learn(pass: PassUnit): Promise<boolean>
  /** Известен ли публичный ключ этого пира (был валидный паспорт). */
  knows(peer: Link): boolean
  /** Проверить печать: подпись сходится ключом её пира и привязана к ленду. */
  verify(land: Link, seal: SealUnit): Promise<boolean>
}

export function createAuditor(): Auditor {
  /** peer.str → импортированный публичный ключ. */
  const keys = new Map<string, { key: SubtleKey, algo: PassAlgo }>()

  return {
    async learn(pass): Promise<boolean> {
      if (!(await pass.verify())) return false
      const algo = pass.algo()
      try {
        const key = await crypto.subtle.importKey('raw', pass.key() as Uint8Array<ArrayBuffer>, algoParams(algo), false, ['verify'])
        keys.set(pass.peer().str, { key, algo })
        return true
      }
      catch {
        return false
      }
    },

    knows(peer): boolean {
      return keys.has(peer.str)
    },

    async verify(land, seal): Promise<boolean> {
      const known = keys.get(seal.peer().str)
      if (known === undefined) return false
      return crypto.subtle.verify(
        signParams(known.algo),
        known.key,
        seal.sign() as Uint8Array<ArrayBuffer>,
        bindLand(land, seal.sens()) as Uint8Array<ArrayBuffer>,
      )
    },
  }
}

export { leadingZeroBits }
