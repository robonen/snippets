import type { EntityId } from './types'

export interface KeyedStore<T = unknown> {
  read(key: EntityId): Promise<T | undefined>
  readMany(keys: readonly EntityId[]): Promise<Array<T | undefined>>
  readAll(): Promise<T[]>
  write(items: ReadonlyArray<{ key: EntityId; value: T }>): Promise<void>
  delete(key: EntityId): Promise<void>
}

export type KeyedStoreFactory<T = unknown> = (name: string) => KeyedStore<T>
