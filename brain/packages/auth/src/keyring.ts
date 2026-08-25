import { open, randomBytes, seal, unwrapDek, wrapDek } from './crypto';
import type { Sealed, WrappedDek } from './crypto';

/**
 * Связка ключей: по 16-байтовому секрету на ленд (`@sync/core` шифрует payload
 * юнитов, docs/01-security.md ревизия 3).
 *
 * ─── Конверт из двух этажей ──────────────────────────────────────────────────
 *
 * Способы доступа (passkey, фраза, ключ устройства) заворачивают НЕ связку, а
 * **мастер-ключ** — случайные 32 байта, которые не меняются никогда. Связка
 * лежит рядом, запечатанная мастером, и потому может меняться СВОБОДНО: новый
 * модуль получает секрет без перевыпуска passkey-обёртки. Заворачивай способы
 * доступа саму связку — добавление ленда требовало бы KEK каждого способа, а
 * KEK passkey без живого прикосновения пальцем не выводится вовсе.
 *
 * ─── Что где лежит ───────────────────────────────────────────────────────────
 *
 *   память (разблокировано)   мастер + секреты лендов + их CryptoKey-кэш
 *   store (переживает замок)  связка шифртекстом под мастером
 *   обёртки способов доступа  мастер под KEK — хранит вызывающий (security/keys.ts)
 *
 * Секрета в обёртках и в запечатанной связке нет: без KEK или мастера это шум.
 */

const MASTER_BYTES = 32;
/** Длина секрета ленда — ровно `gift.code` формата (@sync/core SECRET_BYTES). */
const SECRET_BYTES = 16;

const RING_AAD = 'brain/keyring/v1';

/** Хранилище запечатанной связки: localStorage либо его тестовый двойник. */
export type RingStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const RING_KEY = 'brain.keys.ring';

export interface Keyring {
  /**
   * Ключ ленда для запечатывания пачек. СИНХРОННЫЙ — им пользуется
   * `SecretRing` ядра на каждом save/load. `null` — секрета нет: либо ленд
   * открытый по замыслу, либо `ensure` ещё не звали.
   */
  secretOf(land: string): CryptoKey | null;
  /** Секрет ленда, заводя его при первой встрече. Связка тут же пересохраняется. */
  ensure(land: string): Promise<CryptoKey>;
  /** Сырой секрет ленда — для ECDH-обёртки при подключении устройства. */
  rawOf(land: string): Uint8Array | null;
  /** Все известные ленды. */
  lands(): readonly string[];
  /** Принять чужие секреты (присоединение): совпадающие обязаны совпасть. */
  adopt(secrets: ReadonlyMap<string, Uint8Array>): Promise<void>;
  /**
   * ЗАМЕНИТЬ секреты целиком — приём присоединения к чужому пространству:
   * локальные ленды к этому моменту стёрты, их свежечеканенные секреты ничего
   * не открывают, и спорить с пространством не о чем.
   */
  replaceAll(secrets: ReadonlyMap<string, Uint8Array>): Promise<void>;
  /** Сериализация секретов для ECDH-обёртки другому устройству. */
  exportSecrets(): Uint8Array;
  /** Перевыпустить секреты названных лендов (отзыв устройства). */
  rotate(lands: readonly string[]): Promise<void>;
  /** Завернуть МАСТЕР для нового способа доступа. */
  wrapFor(
    kek: Uint8Array | CryptoKey,
    meta: { kind: WrappedDek['kind']; label: string; salt: Uint8Array },
  ): Promise<WrappedDek>;
  /** Забыть всё: мастер и секреты затираются, объект бесполезен. */
  lock(): void;
}

interface Entry {
  raw: Uint8Array;
  key: CryptoKey;
}

function importSecret(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    raw.slice().buffer as ArrayBuffer,
    { name: 'AES-GCM', length: SECRET_BYTES * 8 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Секреты в байты: JSON `{v, lands}` — связка маленькая, формат читаемый. */
function encodeSecrets(entries: ReadonlyMap<string, Entry | Uint8Array>): Uint8Array {
  const lands: Record<string, string> = {};
  for (const [land, entry] of entries) {
    const raw = entry instanceof Uint8Array ? entry : entry.raw;
    lands[land] = btoa(String.fromCharCode(...raw)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  }
  return new TextEncoder().encode(JSON.stringify({ v: 1, lands }));
}

export function decodeSecrets(blob: Uint8Array): Map<string, Uint8Array> {
  const parsed = JSON.parse(new TextDecoder().decode(blob)) as { v: number; lands: Record<string, string> };
  if (parsed.v !== 1) throw new Error(`связка версии ${parsed.v}: эта сборка понимает только v1`);
  const out = new Map<string, Uint8Array>();
  for (const [land, encoded] of Object.entries(parsed.lands)) {
    const padded = encoded.replaceAll('-', '+').replaceAll('_', '/');
    const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
    const raw = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) raw[i] = binary.charCodeAt(i);
    out.set(land, raw);
  }
  return out;
}

const encoder = new TextEncoder();

async function ringOf(master: Uint8Array, store: RingStore, entries: Map<string, Entry>): Promise<Keyring> {
  let key: Uint8Array | null = master;

  const need = (): Uint8Array => {
    if (key === null) throw new Error('связка заперта: мастер забыт, откройте заново');
    return key;
  };

  /** Пересохранить связку под мастером. Зовётся на каждом изменении секретов. */
  const persist = async (): Promise<void> => {
    const sealed = await seal(need(), encodeSecrets(entries), encoder.encode(RING_AAD));
    store.setItem(RING_KEY, JSON.stringify({
      nonce: Array.from(sealed.nonce),
      cipher: Array.from(sealed.cipher),
    }));
  };

  return {
    secretOf: land => entries.get(land)?.key ?? null,

    rawOf: land => entries.get(land)?.raw.slice() ?? null,

    lands: () => [...entries.keys()],

    async ensure(land: string): Promise<CryptoKey> {
      const known = entries.get(land);
      if (known !== undefined) return known.key;

      const raw = randomBytes(SECRET_BYTES);
      const entry: Entry = { raw, key: await importSecret(raw) };
      entries.set(land, entry);
      await persist();
      return entry.key;
    },

    async adopt(secrets: ReadonlyMap<string, Uint8Array>): Promise<void> {
      for (const [land, raw] of secrets) {
        const known = entries.get(land);
        if (known !== undefined) {
          // Один ленд — один секрет: расхождение означает две независимые
          // истории шифрования, и молча выбрать одну значило бы потерять другую.
          if (known.raw.length === raw.length && known.raw.every((byte, i) => byte === raw[i])) continue;
          throw new Error(`секрет ленда «${land}» расходится с местным: присоединение прервано`);
        }
        entries.set(land, { raw: raw.slice(), key: await importSecret(raw) });
      }
      await persist();
    },

    async replaceAll(secrets: ReadonlyMap<string, Uint8Array>): Promise<void> {
      for (const entry of entries.values()) entry.raw.fill(0);
      entries.clear();
      for (const [land, raw] of secrets) {
        entries.set(land, { raw: raw.slice(), key: await importSecret(raw) });
      }
      await persist();
    },

    exportSecrets: () => encodeSecrets(entries),

    async rotate(lands: readonly string[]): Promise<void> {
      for (const land of lands) {
        const raw = randomBytes(SECRET_BYTES);
        entries.set(land, { raw, key: await importSecret(raw) });
      }
      await persist();
    },

    wrapFor: async (kek, meta) => wrapDek(need(), kek, meta),

    lock() {
      if (key !== null) {
        key.fill(0);
        key = null;
      }
      for (const entry of entries.values()) entry.raw.fill(0);
      entries.clear();
    },
  };
}

/** Свежая связка: новый мастер, ни одного секрета. Первая настройка. */
export function createKeyring(store: RingStore): Promise<Keyring> {
  return ringOf(randomBytes(MASTER_BYTES), store, new Map());
}

/**
 * Открыть связку, сняв обёртку мастера своим KEK.
 *
 * Бросает, если KEK не тот (GCM) и если связка в store не открывается мастером
 * — это рассинхрон обёртки и связки, о котором молчать нельзя.
 */
export async function unlockKeyring(
  wrapped: WrappedDek,
  kek: Uint8Array | CryptoKey,
  store: RingStore,
): Promise<Keyring> {
  const master = await unwrapDek(wrapped, kek);

  const entries = new Map<string, Entry>();
  const storedRaw = store.getItem(RING_KEY);
  if (storedRaw !== null) {
    const stored = JSON.parse(storedRaw) as { nonce: number[]; cipher: number[] };
    const sealed: Sealed = { nonce: new Uint8Array(stored.nonce), cipher: new Uint8Array(stored.cipher) };
    const blob = await open(master, sealed, encoder.encode(RING_AAD));
    for (const [land, raw] of decodeSecrets(blob)) {
      entries.set(land, { raw, key: await importSecret(raw) });
    }
  }

  return ringOf(master, store, entries);
}

/** Забыть запечатанную связку в store — вместе со сбросом всех способов доступа. */
export function dropKeyring(store: RingStore): void {
  store.removeItem(RING_KEY);
}
