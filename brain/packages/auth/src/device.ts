import { createDeviceKek } from './crypto';

/**
 * Ключ устройства на диске — тонкий край над платформой.
 *
 * Логики здесь нет намеренно, как и в `passkey.ts`: файл умеет ровно достать из
 * IndexedDB объект `CryptoKey` и положить его туда. Проверяемая часть — то, что
 * ключ неизвлекаемый и что обёртка снимается только им, — живёт в `crypto.ts` и
 * гоняется в Node, где IndexedDB нет вовсе.
 *
 * ПОЧЕМУ IndexedDB, а не localStorage: `CryptoKey` кладётся туда объектом,
 * структурным клоном, и байты ключа при этом не проходят через JS ни разу.
 * localStorage хранит строки — то есть потребовал бы экспорта, то есть
 * извлекаемого ключа, то есть ровно того, чего этот ключ избегает.
 */

const DB_NAME = 'brain-device';
const STORE = 'keys';
const KEY = 'kek/v1';

/**
 * Ключ устройства: тот же на все запуски, заводится при первом обращении.
 *
 * `null` — платформа не дала его сохранить (приватный режим, отключённое
 * хранилище). Это не ошибка вызывающего: он обязан решить сам, что делать, —
 * и решает громко, а не молча складывая данные текстом.
 */
export async function deviceKek(): Promise<CryptoKey | null> {
  const factory = globalThis.indexedDB as IDBFactory | undefined;
  if (factory === undefined) return null;

  try {
    const db = await open(factory);
    try {
      const found = await read(db);
      if (found !== undefined) return found;

      const fresh = await createDeviceKek();
      await write(db, fresh);
      return fresh;
    }
    finally {
      db.close();
    }
  }
  catch {
    return null;
  }
}

/** Забыть ключ устройства. Данные, зашифрованные под ним, станут нечитаемы. */
export async function dropDeviceKek(): Promise<void> {
  const factory = globalThis.indexedDB as IDBFactory | undefined;
  if (factory === undefined) return;
  const db = await open(factory);
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(KEY);
    await ended(tx);
  }
  finally {
    db.close();
  }
}

function open(factory: IDBFactory): Promise<IDBDatabase> {
  const request = factory.open(DB_NAME, 1);
  request.onupgradeneeded = (): void => {
    const db = request.result;
    if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
  };
  return ask(request);
}

async function read(db: IDBDatabase): Promise<CryptoKey | undefined> {
  const tx = db.transaction(STORE, 'readonly');
  const found = await ask(tx.objectStore(STORE).get(KEY) as IDBRequest<CryptoKey | undefined>);
  return found;
}

async function write(db: IDBDatabase, key: CryptoKey): Promise<void> {
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).put(key, KEY);
  await ended(tx);
}

function ask<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((done, fail) => {
    request.onsuccess = (): void => done(request.result);
    request.onerror = (): void => fail(request.error ?? new Error('запрос IndexedDB отклонён'));
  });
}

function ended(tx: IDBTransaction): Promise<void> {
  return new Promise((done, fail) => {
    tx.oncomplete = (): void => done();
    tx.onerror = (): void => fail(tx.error ?? new Error('транзакция IndexedDB отклонена'));
    tx.onabort = (): void => fail(tx.error ?? new Error('транзакция IndexedDB отменена'));
  });
}
