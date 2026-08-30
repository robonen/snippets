import type { SubtleKeyPair } from '@sync/core';

/**
 * Пары ключей устройства (ECDH для приглашений, подпись для юнитов) и то,
 * ГДЕ они живут между запусками. Личность устройства — это его пара: потеряла
 * браузер пару — в пространстве появилось «новое устройство». Поэтому
 * хранение здесь с тройной страховкой и проверкой чтения:
 *
 *   1. IndexedDB, CryptoKey структурным клоном (неизвлекаемый ключ) —
 *      основной путь; пара считается сохранённой, только если читается
 *      обратно: WebKit умеет молча потерять X25519/Ed25519 (запись
 *      приходит null), тогда пробуем P-256;
 *   2. localStorage, JWK извлекаемой P-256-пары — когда CryptoKey в базу не
 *      ложится вовсе; ключ читается кодом origin, но им же читается и всё
 *      остальное на устройстве (docs/01 §1, «скомпрометированное устройство»);
 *   3. память — с предупреждением: такой браузер (встроенный в мессенджер с
 *      одноразовым хранилищем, приватная вкладка) устройство не запомнит.
 */

/** Где живёт пара. Экран «Доступ» показывает это человеку. */
export type KeyKeeping = 'idb' | 'local' | 'memory';

export interface KeptPair<A extends string> {
  readonly algo: A;
  readonly pair: SubtleKeyPair;
  readonly keeping: KeyKeeping;
}

export interface KeepOptions<A extends string> {
  /** Имя записи — одно на IndexedDB и localStorage. */
  readonly key: string;
  /** Чеканка пары ядром; `prefer: 'p256'` — просьба взять клонируемую кривую. */
  readonly mint: (prefer?: A) => Promise<{ algo: A; pair: SubtleKeyPair }>;
  /** Запасной путь: извлекаемая P-256-пара под этот алгоритм. */
  readonly local: {
    readonly algo: A;
    readonly params: EcKeyGenParams;
    readonly privateUsages: KeyUsage[];
    readonly publicUsages: KeyUsage[];
  };
}

const DB_NAME = 'brain-device';
const STORE = 'keys';
const LOCAL_PREFIX = 'brain.device.';

interface StoredPair<A extends string> {
  readonly algo: A;
  readonly pair: SubtleKeyPair;
}

interface LocalPair<A extends string> {
  readonly algo: A;
  readonly privateKey: JsonWebKey;
  readonly publicKey: JsonWebKey;
}

function isPair<A extends string>(found: unknown): found is StoredPair<A> {
  if (found === null || typeof found !== 'object') return false;
  const pair = (found as { pair?: unknown }).pair;
  if (pair === null || typeof pair !== 'object') return false;
  const { publicKey, privateKey } = pair as { publicKey?: unknown; privateKey?: unknown };
  return publicKey instanceof CryptoKey && privateKey instanceof CryptoKey;
}

/** Поднять пару с носителя или отчеканить и сохранить — см. шапку. */
export async function keepPair<A extends string>(options: KeepOptions<A>): Promise<KeptPair<A>> {
  const db = await openDb();
  try {
    const found = await read(db, options.key);
    if (isPair<A>(found)) return { algo: found.algo, pair: found.pair, keeping: 'idb' };

    const local = await readLocal(options);
    if (local !== null) return { ...local, keeping: 'local' };

    const kept = await persist(db, options);
    if (kept !== null) return { ...kept, keeping: 'idb' };

    const exported = await mintLocal(options);
    return exported === null
      ? { ...(await options.mint('p256' as A)), keeping: 'memory' }
      : { ...exported, keeping: 'local' };
  }
  finally {
    db.close();
  }
}

/** IndexedDB с проверкой чтения; `null` — не легла ни одна кривая. */
async function persist<A extends string>(db: IDBDatabase, options: KeepOptions<A>): Promise<StoredPair<A> | null> {
  let fresh = await options.mint();
  for (;;) {
    let stored = false;
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ algo: fresh.algo, pair: fresh.pair }, options.key);
      await ended(tx);
      stored = isPair<A>(await read(db, options.key));
    }
    catch {
      // Клонирование отвергнуто — та же болезнь, что и запись-null.
    }
    if (stored) return fresh;
    if (fresh.algo === 'p256') return null;
    fresh = await options.mint('p256' as A);
  }
}

async function readLocal<A extends string>(options: KeepOptions<A>): Promise<StoredPair<A> | null> {
  let raw: string | null;
  try {
    raw = localStorage.getItem(LOCAL_PREFIX + options.key);
  }
  catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as LocalPair<A>;
    const { params, privateUsages, publicUsages } = options.local;
    const privateKey = await crypto.subtle.importKey('jwk', parsed.privateKey, params, false, privateUsages);
    const publicKey = await crypto.subtle.importKey('jwk', parsed.publicKey, params, true, publicUsages);
    return { algo: parsed.algo, pair: { privateKey, publicKey } as SubtleKeyPair };
  }
  catch {
    // Битая запись — не повод падать: ниже отчеканится новая.
    return null;
  }
}

/** Извлекаемая P-256-пара, JWK в localStorage. `null` — localStorage недоступен. */
async function mintLocal<A extends string>(options: KeepOptions<A>): Promise<StoredPair<A> | null> {
  const { algo, params, privateUsages, publicUsages } = options.local;
  const pair = await crypto.subtle.generateKey(params, true, [...privateUsages, ...publicUsages]) as CryptoKeyPair;
  const entry: LocalPair<A> = {
    algo,
    privateKey: await crypto.subtle.exportKey('jwk', pair.privateKey),
    publicKey: await crypto.subtle.exportKey('jwk', pair.publicKey),
  };
  try {
    localStorage.setItem(LOCAL_PREFIX + options.key, JSON.stringify(entry));
    if (localStorage.getItem(LOCAL_PREFIX + options.key) === null) return null;
  }
  catch {
    return null;
  }
  return { algo, pair: pair as unknown as SubtleKeyPair };
}

// ── Мелкий IndexedDB-край (тот же, что у @brain/auth device.ts) ──────────────

function read(db: IDBDatabase, key: string): Promise<unknown> {
  return ask(db.transaction(STORE, 'readonly').objectStore(STORE).get(key));
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((done, fail) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (): void => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = (): void => done(request.result);
    request.onerror = (): void => fail(request.error ?? new Error('IndexedDB rejected opening'));
  });
}

function ask<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((done, fail) => {
    request.onsuccess = (): void => done(request.result);
    request.onerror = (): void => fail(request.error ?? new Error('IndexedDB request rejected'));
  });
}

function ended(tx: IDBTransaction): Promise<void> {
  return new Promise((done, fail) => {
    tx.oncomplete = (): void => done();
    tx.onerror = (): void => fail(tx.error ?? new Error('IndexedDB transaction rejected'));
    tx.onabort = (): void => fail(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}
