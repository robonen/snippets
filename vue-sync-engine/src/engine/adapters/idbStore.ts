import type { EntityId } from '../core/types'
import type { KeyedStore, KeyedStoreFactory } from '../core/keyedStore'
import { getIdbManager } from './idbManager'

export interface IdbStoreOptions {
  dbName: string
  storeName?: string
}

export function idbStore<T>(opts: IdbStoreOptions): KeyedStoreFactory<T> {
  const mgr = getIdbManager(opts.dbName)
  return (name) => {
    const store = opts.storeName ?? name
    mgr.registerStore(store)
    return {
      read(key: EntityId) {
        return mgr.run(store, 'readonly', (s) => s.get(asKey(key)) as IDBRequest<T | undefined>)
      },
      async readMany(keys: readonly EntityId[]) {
        if (keys.length === 0) return []
        const db = await mgr.getDb()
        return new Promise<Array<T | undefined>>((resolve, reject) => {
          const tx = db.transaction(store, 'readonly')
          const os = tx.objectStore(store)
          const out: Array<T | undefined> = new Array(keys.length)
          let pending = keys.length
          for (let i = 0; i < keys.length; i++) {
            const req = os.get(asKey(keys[i]))
            const idx = i
            req.onsuccess = () => {
              out[idx] = req.result as T | undefined
              if (--pending === 0) resolve(out)
            }
            req.onerror = () => reject(req.error)
          }
        })
      },
      readAll() {
        return mgr.run(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>)
      },
      write(items) {
        if (items.length === 0) return Promise.resolve()
        return mgr.runTx(store, 'readwrite', (os) => {
          for (let i = 0; i < items.length; i++) os.put(items[i].value, asKey(items[i].key))
        })
      },
      delete(key: EntityId) {
        return mgr.runTx(store, 'readwrite', (os) => {
          os.delete(asKey(key))
        })
      },
    } satisfies KeyedStore<T>
  }
}

function asKey(k: EntityId): IDBValidKey {
  return typeof k === 'number' ? k : String(k)
}
