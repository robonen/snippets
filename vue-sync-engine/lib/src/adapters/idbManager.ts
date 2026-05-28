export interface StoreSpec {
  name: string
  keyPath?: string
}

class IdbManager {
  readonly dbName: string
  private pending = new Map<string, StoreSpec>()
  private dbPromise: Promise<IDBDatabase> | null = null

  constructor(dbName: string) {
    this.dbName = dbName
  }

  registerStore(spec: StoreSpec | string): void {
    const s: StoreSpec = typeof spec === 'string' ? { name: spec } : spec
    const cur = this.pending.get(s.name)
    if (cur === undefined || (cur.keyPath === undefined && s.keyPath !== undefined)) {
      this.pending.set(s.name, s)
    }
  }

  async getDb(): Promise<IDBDatabase> {
    if (this.dbPromise) {
      const db = await this.dbPromise
      const missing = this.missing(db)
      if (missing.length === 0) return db
      db.close()
      this.dbPromise = this.open(db.version + 1, missing)
      return this.dbPromise
    }
    this.dbPromise = (async () => {
      const initial = [...this.pending.values()]
      const db = await this.open(undefined, initial)
      const missing = this.missing(db)
      if (missing.length === 0) return db
      db.close()
      return this.open(db.version + 1, missing)
    })()
    return this.dbPromise
  }

  async run<T>(
    storeName: string,
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.getDb()
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(storeName, mode)
      const req = fn(tx.objectStore(storeName))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }

  async runTx(
    storeName: string,
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => void,
  ): Promise<void> {
    const db = await this.getDb()
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, mode)
      fn(tx.objectStore(storeName))
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  private missing(db: IDBDatabase): StoreSpec[] {
    const out: StoreSpec[] = []
    for (const s of this.pending.values()) if (!db.objectStoreNames.contains(s.name)) out.push(s)
    return out
  }

  private open(version: number | undefined, create: readonly StoreSpec[]): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = version === undefined ? indexedDB.open(this.dbName) : indexedDB.open(this.dbName, version)
      req.onupgradeneeded = () => {
        const db = req.result
        for (const s of create) {
          if (db.objectStoreNames.contains(s.name)) continue
          db.createObjectStore(s.name, s.keyPath ? { keyPath: s.keyPath } : undefined)
        }
      }
      req.onsuccess = () => {
        const db = req.result
        db.onversionchange = () => db.close()
        resolve(db)
      }
      req.onerror = () => reject(req.error)
      req.onblocked = () => reject(new Error(`IDB open blocked: ${this.dbName}`))
    })
  }
}

const managers = new Map<string, IdbManager>()

export function getIdbManager(dbName: string): IdbManager {
  let m = managers.get(dbName)
  if (!m) {
    m = new IdbManager(dbName)
    managers.set(dbName, m)
  }
  return m
}

export type { IdbManager }
