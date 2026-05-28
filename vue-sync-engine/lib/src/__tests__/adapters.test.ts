import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { memoryStore, noopStore } from '../adapters/memoryStore'
import { idbStore } from '../adapters/idbStore'
import { getIdbManager } from '../adapters/idbManager'
import { indexedDBAdapter, memoryAdapter } from '../adapters/storageAdapter'

describe('memoryStore', () => {
  it('round-trips writes and reads', async () => {
    const store = memoryStore<{ v: number }>()('s')
    await store.write([
      { key: 'a', value: { v: 1 } },
      { key: 'b', value: { v: 2 } },
    ])
    expect(await store.read('a')).toEqual({ v: 1 })
    expect(await store.read('missing')).toBeUndefined()
    expect(await store.readMany(['a', 'missing', 'b'])).toEqual([
      { v: 1 },
      undefined,
      { v: 2 },
    ])
    expect(await store.readAll()).toEqual([{ v: 1 }, { v: 2 }])
    await store.delete('a')
    expect(await store.read('a')).toBeUndefined()
    expect(await store.readAll()).toEqual([{ v: 2 }])
  })

  it('isolates stores by factory call', async () => {
    const factory = memoryStore<number>()
    const a = factory('a')
    const b = factory('b')
    await a.write([{ key: 1, value: 10 }])
    expect(await b.read(1)).toBeUndefined()
    expect(await a.read(1)).toBe(10)
  })

  it('supports numeric keys', async () => {
    const store = memoryStore<string>()('s')
    await store.write([{ key: 1, value: 'one' }])
    expect(await store.read(1)).toBe('one')
  })
})

describe('noopStore', () => {
  it('reads always undefined and writes do nothing', async () => {
    const store = noopStore<number>()('any')
    await store.write([{ key: 'x', value: 1 }])
    expect(await store.read('x')).toBeUndefined()
    expect(await store.readAll()).toEqual([])
    expect(await store.readMany(['a', 'b', 'c'])).toEqual([undefined, undefined, undefined])
    await store.delete('x')
  })
})

describe('memoryAdapter', () => {
  it('provides queries and mutations stores', async () => {
    const a = memoryAdapter()
    expect(typeof a.queries.read).toBe('function')
    expect(typeof a.mutations.read).toBe('function')
    await a.queries.write([{ key: 'k', value: { status: 2 } as never }])
    expect((await a.queries.read('k'))?.status).toBe(2)
  })
})

const DB_PREFIX = 'sync-engine-test-'
function newDbName(): string {
  return DB_PREFIX + Math.random().toString(36).slice(2)
}

async function dropDb(name: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(name)
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
    req.onblocked = () => resolve()
  })
}

describe('idbStore + idbManager', () => {
  const created: string[] = []

  afterEach(async () => {
    for (const n of created) await dropDb(n)
    created.length = 0
  })

  it('writes, reads, readMany, readAll, delete on a real IndexedDB', async () => {
    const dbName = newDbName()
    created.push(dbName)
    const store = idbStore<{ v: number }>({ dbName })('items')
    await store.write([
      { key: 'a', value: { v: 1 } },
      { key: 'b', value: { v: 2 } },
      { key: 3, value: { v: 3 } },
    ])
    expect(await store.read('a')).toEqual({ v: 1 })
    expect(await store.read('missing')).toBeUndefined()
    expect(await store.readMany(['a', 'missing', 'b'])).toEqual([
      { v: 1 },
      undefined,
      { v: 2 },
    ])
    expect(await store.readMany([])).toEqual([])
    const all = await store.readAll()
    expect(all.length).toBe(3)
    await store.delete('a')
    expect(await store.read('a')).toBeUndefined()
  })

  it('write([]) is a no-op', async () => {
    const dbName = newDbName()
    created.push(dbName)
    const store = idbStore<number>({ dbName })('items')
    await store.write([])
    expect(await store.readAll()).toEqual([])
  })

  it('upgrades the DB to add new stores after open', async () => {
    const dbName = newDbName()
    created.push(dbName)
    const a = idbStore<number>({ dbName })('a')
    await a.write([{ key: 1, value: 10 }])
    // Trigger a second registerStore on the same manager — should re-open with bumped version.
    const b = idbStore<number>({ dbName })('b')
    await b.write([{ key: 1, value: 20 }])
    expect(await a.read(1)).toBe(10)
    expect(await b.read(1)).toBe(20)
  })

  it('honors storeName override', async () => {
    const dbName = newDbName()
    created.push(dbName)
    const store = idbStore<number>({ dbName, storeName: 'overridden' })('logical')
    await store.write([{ key: 1, value: 7 }])
    expect(await store.read(1)).toBe(7)
  })

  it('getIdbManager returns the same instance for the same name', () => {
    const a = getIdbManager('shared-mgr')
    const b = getIdbManager('shared-mgr')
    expect(a).toBe(b)
    expect(getIdbManager('other')).not.toBe(a)
  })

  it('indexedDBAdapter exposes queries+mutations on the same DB', async () => {
    const dbName = newDbName()
    created.push(dbName)
    const adapter = indexedDBAdapter({ dbName })
    await adapter.queries.write([{ key: 'q1', value: { status: 2 } as never }])
    await adapter.mutations.write([
      { key: 'm1', value: { id: 'm1', seq: 1, name: 'x', input: {}, createdAt: 0, attempts: 0, state: 'pending' } as never },
    ])
    expect((await adapter.queries.read('q1'))?.status).toBe(2)
    expect((await adapter.mutations.read('m1'))?.id).toBe('m1')
  })

  it('uses default dbName when not provided', async () => {
    // Use the no-arg overload, then clean up afterwards.
    const adapter = indexedDBAdapter()
    await adapter.queries.write([{ key: 'k', value: { status: 2 } as never }])
    expect((await adapter.queries.read('k'))?.status).toBe(2)
    await adapter.queries.delete('k')
    created.push('sync-engine')
  })
})

describe('idbManager.run propagates errors', () => {
  let dbName: string
  beforeEach(() => {
    dbName = newDbName()
  })
  afterEach(() => dropDb(dbName))

  it('rejects when an IDB request fails', async () => {
    const mgr = getIdbManager(dbName)
    mgr.registerStore('s')
    await mgr.runTx('s', 'readwrite', (os) => {
      os.put({ v: 1 }, 'a')
    })
    // Force an error: passing an invalid key (a plain object) to get() will throw
    await expect(
      mgr.run('s', 'readonly', (os) => os.get({ bad: true } as unknown as IDBValidKey) as IDBRequest<unknown>),
    ).rejects.toBeDefined()
  })
})
