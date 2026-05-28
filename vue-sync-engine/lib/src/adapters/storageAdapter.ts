import type { QueuedMutation, QuerySnapshot } from '../core/types'
import type { KeyedStore } from '../core/keyedStore'
import { memoryStore } from './memoryStore'
import { idbStore } from './idbStore'

export interface StorageAdapter {
  queries: KeyedStore<QuerySnapshot>
  mutations: KeyedStore<QueuedMutation>
}

export function memoryAdapter(): StorageAdapter {
  return {
    queries: memoryStore<QuerySnapshot>()('queries'),
    mutations: memoryStore<QueuedMutation>()('mutations'),
  }
}

export interface IndexedDBAdapterOptions {
  dbName?: string
}

export function indexedDBAdapter(opts: IndexedDBAdapterOptions = {}): StorageAdapter {
  const dbName = opts.dbName ?? 'sync-engine'
  return {
    queries: idbStore<QuerySnapshot>({ dbName })('queries'),
    mutations: idbStore<QueuedMutation>({ dbName })('mutations'),
  }
}
