// Идентичность устройства для обмена секретами лендов (docs/07 §2, §4).
//
// Здесь живёт РОВНО обмен ключами: пара ECDH, взаимный ключ двух устройств и
// обёртка секрета ленда в 16 байт `gift.code`. Подписи (`Seal`, Ed25519/P-256)
// — отдельная стадия: до них юниты защищены только AEAD-меткой payload'а, и это
// записано в docs/07 «Что отложено».
//
// ─── Выбор алгоритма ─────────────────────────────────────────────────────────
//
// X25519, где платформа его умеет (Node ≥ 20, свежие браузеры), иначе ECDH
// P-256. Выбор фиксируется строкой в самой идентичности и едет рядом с публичным
// ключом: пары разных кривых взаимного ключа не выведут, и это честный отказ на
// границе, а не тихая деградация.
//
// ─── Почему обёртка секрета — AES-CTR, а не GCM ──────────────────────────────
//
// `gift.code` — ровно 16 байт (docs/03 §2): метке GCM в нём места нет. CTR
// сохраняет длину, а недостающую целостность даёт сама природа секрета: порча
// любого бита обёртки даёт другой секрет, и первый же `openPack` им честно
// падает на метке GCM юнита. То есть подмена кода — это отказ в обслуживании,
// но не подмена данных; ровно тот же расклад, что у baza с его `close()`.
// Счётчик CTR выводится из связки гифта тем же приёмом, что нонс юнита
// (`sealed.ts`): взаимный ключ пары устройств живёт долго, и статический
// счётчик означал бы одну гамму на все обёртки.

import { shotInto } from '../binary/sha256'
import type { SubtleKey, SubtleKeyPair } from './keys'
import { SECRET_BYTES } from './secret'
import { CryptoError } from './sealed'

/** Кривая обмена. Фиксируется при создании пары и едет рядом с публичным ключом. */
export type ExchangeAlgo = 'x25519' | 'p256'

/** Идентичность устройства: кривая, публичный ключ и вывод взаимного ключа. */
export interface Identity {
  readonly algo: ExchangeAlgo
  /** Сырой публичный ключ: 32 Б у X25519, несжатая точка 65 Б у P-256. */
  readonly pub: Uint8Array
  /** Взаимный ключ с другим устройством — для {@link wrapSecret}. */
  mutual(algo: ExchangeAlgo, pub: Uint8Array): Promise<SubtleKey>
  /**
   * Взаимный ключ AES-GCM — для обёрток ПРОИЗВОЛЬНОЙ длины (связка секретов
   * целиком при подключении устройства). Отдельный вывод (`info` другой):
   * один и тот же материал на двух задачах связал бы их между собой.
   */
  mutualSealed(algo: ExchangeAlgo, pub: Uint8Array): Promise<SubtleKey>
}

function algoParams(algo: ExchangeAlgo): { name: string, namedCurve?: string } {
  return algo === 'x25519' ? { name: 'X25519' } : { name: 'ECDH', namedCurve: 'P-256' }
}

/**
 * Свежая пара обмена. Приватный ключ НЕэкспортируемый: наружу он не выходит
 * вовсе — хранить его объект `CryptoKey` умеет IndexedDB через structured clone.
 *
 * X25519 пробуется первым; платформа без него получает P-256. Отказ обеих —
 * исключение: без ECDH обмен секретами невозможен, и молчать об этом нельзя.
 */
export async function mintExchangePair(): Promise<{ algo: ExchangeAlgo, pair: SubtleKeyPair }> {
  try {
    // Форму `{name}` без параметров типы относят к одноключевой ветке — но
    // X25519 всегда даёт пару; каст через unknown честнее ложного оверлоада.
    const pair = await crypto.subtle.generateKey({ name: 'X25519' }, false, ['deriveBits']) as unknown as SubtleKeyPair
    return { algo: 'x25519', pair }
  } catch {
    const pair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveBits'],
    ) as SubtleKeyPair
    return { algo: 'p256', pair }
  }
}

/**
 * Идентичность над готовой парой — свежей из {@link mintExchangePair} или
 * поднятой из хранилища приложения (ядро ключи не хранит, ADR-010: DI).
 */
export async function identityOf(algo: ExchangeAlgo, pair: SubtleKeyPair): Promise<Identity> {
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))

  // Сырой вывод ECDH ключом не берётся (низкая энтропия по структуре группы):
  // HKDF с фиксированным info выравнивает его и зашивает назначение в вывод —
  // тот же довод, что у KEK из PRF в brain docs/01 §4.
  async function derive(
    otherAlgo: ExchangeAlgo,
    otherPub: Uint8Array,
    info: string,
    cipher: { name: string, length: number },
  ): Promise<SubtleKey> {
    if (otherAlgo !== algo) {
      throw new CryptoError(`кривые не совпали: у нас ${algo}, у собеседника ${otherAlgo}`, 'обмен ключами')
    }

    const other = await crypto.subtle.importKey(
      'raw',
      otherPub as Uint8Array<ArrayBuffer>,
      algoParams(algo),
      false,
      [],
    )
    const shared = await crypto.subtle.deriveBits(
      algo === 'x25519' ? { name: 'X25519', public: other } : { name: 'ECDH', public: other },
      pair.privateKey,
      256,
    )
    const seed = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey'])
    return crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode(info) },
      seed,
      cipher,
      false,
      ['encrypt', 'decrypt'],
    )
  }

  return {
    algo,
    pub,
    mutual: (otherAlgo, otherPub) =>
      derive(otherAlgo, otherPub, 'sync/mutual/v1', { name: 'AES-CTR', length: 128 }),
    mutualSealed: (otherAlgo, otherPub) =>
      derive(otherAlgo, otherPub, 'sync/mutual/gcm/v1', { name: 'AES-GCM', length: 256 }),
  }
}

const COUNTER_BYTES = 16

/** Счётчик CTR из связки гифта: 12 Б SHA-256 плюс нулевой хвост под сам счётчик. */
function counterOf(bind: Uint8Array): Uint8Array {
  const counter = new Uint8Array(COUNTER_BYTES)
  shotInto(counter, 0, bind, 0, bind.length)
  return counter
}

/**
 * Обернуть секрет ленда во взаимный ключ — содержимое `gift.code`.
 *
 * `bind` — связка гифта: байты, уникальные для этой выдачи (ленд, датель,
 * получатель, метка времени). Одна и та же связка на двух РАЗНЫХ секретах под
 * одним взаимным ключом — выход за контракт (гамма CTR повторится).
 */
export async function wrapSecret(mutual: SubtleKey, secret: Uint8Array, bind: Uint8Array): Promise<Uint8Array> {
  if (secret.length !== SECRET_BYTES) {
    throw new CryptoError(`секрет ленда — ${SECRET_BYTES} Б, пришло ${secret.length}`, 'gift.code')
  }
  const code = await crypto.subtle.encrypt(
    { name: 'AES-CTR', counter: counterOf(bind), length: 32 },
    mutual,
    secret as Uint8Array<ArrayBuffer>,
  )
  return new Uint8Array(code)
}

/** Снять обёртку {@link wrapSecret}: CTR симметричен, связка обязана совпасть. */
export async function unwrapSecret(mutual: SubtleKey, code: Uint8Array, bind: Uint8Array): Promise<Uint8Array> {
  if (code.length !== SECRET_BYTES) {
    throw new CryptoError(`gift.code — ${SECRET_BYTES} Б, пришло ${code.length}`, 'gift.code')
  }
  const secret = await crypto.subtle.decrypt(
    { name: 'AES-CTR', counter: counterOf(bind), length: 32 },
    mutual,
    code as Uint8Array<ArrayBuffer>,
  )
  return new Uint8Array(secret)
}
