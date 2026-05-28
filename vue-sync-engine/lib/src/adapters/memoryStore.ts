import type { EntityId } from '../core/types'
import type { KeyedStore, KeyedStoreFactory } from '../core/keyedStore'

export function memoryStore<T>(): KeyedStoreFactory<T> {
  return () => {
    const m = new Map<EntityId, T>()
    return {
      async read(key) {
        return m.get(key)
      },
      async readMany(keys) {
        const out: Array<T | undefined> = new Array(keys.length)
        for (let i = 0; i < keys.length; i++) out[i] = m.get(keys[i])
        return out
      },
      async readAll() {
        return [...m.values()]
      },
      async write(items) {
        for (let i = 0; i < items.length; i++) m.set(items[i].key, items[i].value)
      },
      async delete(key) {
        m.delete(key)
      },
    } satisfies KeyedStore<T>
  }
}

export function noopStore<T>(): KeyedStoreFactory<T> {
  return () => noop as KeyedStore<T>
}

const noop: KeyedStore<unknown> = {
  async read() {
    return undefined
  },
  async readMany(keys) {
    return new Array(keys.length).fill(undefined)
  },
  async readAll() {
    return []
  },
  async write() {},
  async delete() {},
}
