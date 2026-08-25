import {
  Land,
  createSpace,
  idbStore,
  landIdOf,
  openVault,
  randomSession,
  sealedStore,
} from '@sync/core';
import type { SecretRing } from '@sync/core';
import { createKeyring, decodeBytes, openLegacyChunk, unwrapLegacyDek } from '@brain/auth';
import type { Keyring, WrappedDek } from '@brain/auth';
import { devicePeer, landId } from '@brain/module-kit';
import { MetaModel } from '../db/meta';

/**
 * Одноразовый переезд со схемы «конверт DEK/KEK на границе диска» (ревизии 1–2)
 * на «payload юнитов запечатывает ядро» (ревизия 3).
 *
 * Старый мир: обёртки DEK в ОТКРЫТОМ мета-ленде (IndexedDB `brain`), данные —
 * куски `nonce ‖ cipher` в сундуке `brain-sealed`. Новый: секреты лендов в
 * связке (`@brain/auth` keyring), юниты в `brain-lands` с запечатанным payload.
 *
 * Порядок: старые куски распечатываются СТАРЫМ DEK (KEK у нас в руках — тем же
 * жестом человек открыл приложение), склейка кусков — валидная пачка ядра, и
 * она уезжает в новое хранилище через `sealedStore`, который запечатает каждый
 * юнит свежим секретом ленда. Старые базы удаляются ПОСЛЕ успешной записи всех
 * лендов: обрыв посреди переезда оставляет старый мир нетронутым, и следующий
 * запуск начнёт заново — запись в новое хранилище идемпотентна.
 */

const LEGACY_META_DB = 'brain';
const LEGACY_CHEST_DB = 'brain-sealed';
const CHUNKS_STORE = 'chunks';

/** Есть ли что переезжать. Без `indexedDB.databases()` считаем, что нет. */
export async function legacyPresent(): Promise<boolean> {
  const idb = globalThis.indexedDB as (IDBFactory & { databases?: () => Promise<Array<{ name?: string }>> }) | undefined;
  if (idb?.databases === undefined) return false;
  try {
    const names = new Set((await idb.databases()).map(db => db.name));
    return names.has(LEGACY_CHEST_DB) || names.has(LEGACY_META_DB);
  }
  catch {
    return false;
  }
}

/** Обёртки старого DEK из открытого мета-ленда — чтобы экран замка знал, чем открывать. */
export async function readLegacyWraps(): Promise<WrappedDek[]> {
  const store = idbStore({ name: LEGACY_META_DB });
  const id = landId('meta');
  const land = new Land(devicePeer(localStorage), wallNow, { session: randomSession() });
  const vault = openVault({ store, id, land });
  const space = createSpace({ land, id, ready: vault.ready });
  await vault.opened();

  const root = space.root(MetaModel);
  const wraps = root.keys.keys().map((key) => {
    const doc = root.keys(key);
    return {
      kind: doc.kind(),
      label: doc.label() === '' ? key : doc.label(),
      salt: decodeBytes(doc.salt()),
      nonce: decodeBytes(doc.nonce()),
      cipher: decodeBytes(doc.cipher()),
    } satisfies WrappedDek;
  });
  vault.close();
  return wraps;
}

export interface MigrateOptions {
  /** Старая обёртка, которую открывает предъявленный KEK. */
  readonly wrap: WrappedDek;
  readonly kek: Uint8Array | CryptoKey;
}

/**
 * Переезд целиком: старый DEK → куски → новое хранилище → свежая связка.
 *
 * Возвращает связку с секретами всех перенесённых лендов. Обёртки мастера
 * пишет вызывающий (`security/lock.ts`): только он знает, какие KEK в руках.
 */
export async function migrateLegacy(options: MigrateOptions): Promise<Keyring> {
  const dek = await unwrapLegacyDek(options.wrap, options.kek);

  const ring = await createKeyring(localStorage);
  const chunksByLand = await readChunks();

  const secrets: SecretRing = {
    secretOf: (land) => {
      const key = ring.secretOf(land.str);
      if (key === null) throw new Error(`секрет ленда «${land.str}» не заведён — переезд собран неверно`);
      return key;
    },
  };
  const fresh = sealedStore(idbStore({ name: 'brain-lands' }), secrets);

  for (const [landStr, chunks] of chunksByLand) {
    const opened: Uint8Array[] = [];
    for (const chunk of chunks) opened.push(await openLegacyChunk(dek, landStr, chunk));

    await ring.ensure(landStr);
    // Склейка закодированных пачек побайтово — валидная пачка (формат ядра).
    await fresh.save(landIdOf(landStr), concat(opened));
  }

  dek.fill(0);
  await dropLegacy();
  return ring;
}

/** Куски сундука по лендам, в порядке номеров. */
async function readChunks(): Promise<Map<string, Uint8Array[]>> {
  const out = new Map<string, Uint8Array[]>();
  const db = await new Promise<IDBDatabase | null>((done) => {
    const request = indexedDB.open(LEGACY_CHEST_DB);
    request.onsuccess = (): void => done(request.result);
    request.onerror = (): void => done(null);
    // Базы не было — не заводить её побочным эффектом проверки.
    request.onupgradeneeded = (): void => {
      request.transaction?.abort();
      done(null);
    };
  });
  if (db === null) return out;

  try {
    if (!db.objectStoreNames.contains(CHUNKS_STORE)) return out;
    const rows = await new Promise<Array<{ key: IDBValidKey; value: Uint8Array }>>((done, fail) => {
      const found: Array<{ key: IDBValidKey; value: Uint8Array }> = [];
      const cursor = db.transaction(CHUNKS_STORE, 'readonly').objectStore(CHUNKS_STORE).openCursor();
      cursor.onsuccess = (): void => {
        const at = cursor.result;
        if (at === null) {
          done(found);
          return;
        }
        found.push({ key: at.key, value: new Uint8Array(at.value as ArrayBuffer | Uint8Array as Uint8Array) });
        at.continue();
      };
      cursor.onerror = (): void => fail(cursor.error ?? new Error('сундук не читается'));
    });

    // Ключ старого сундука — [ленд, номер]; курсор уже идёт по порядку ключей.
    for (const row of rows) {
      const key = row.key as [string, number];
      const land = key[0];
      const list = out.get(land) ?? [];
      list.push(row.value);
      out.set(land, list);
    }
    return out;
  }
  finally {
    db.close();
  }
}

async function dropLegacy(): Promise<void> {
  await Promise.all([LEGACY_META_DB, LEGACY_CHEST_DB].map(name => new Promise<void>((done) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = (): void => done();
    request.onerror = (): void => done();
    request.onblocked = (): void => done();
  })));
  // Счётчики прежнего протокола синка больше никто не читает.
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('brain.sync.seen:') || key.startsWith('brain.sync.sent:')) localStorage.removeItem(key);
  }
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  let size = 0;
  for (const part of parts) size += part.length;
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const wallNow = { now: (): number => Math.floor(Date.now() / 1000) };
