/**
 * Хранилище (стадия S5): контракт, образ-арена, зеркала и связка с лендом.
 *
 * Открыт весь механизм, а не только память, и это осознанно: `PackImage`,
 * `Mirrors` и `Volume` — то, из чего собираются файловое и OPFS-хранилища, и
 * собираются они ДОБАВЛЕНИЕМ ТОМА, а не второй реализацией контракта.
 */
export { StoreError, type Awaitable, type UnitStore, type Volume } from './store'
export { PackImage } from './image'
export { Mirrors } from './mirrors'
export { RamVolume, emptyPack, memoryStore, type MemoryStore, type MemoryStoreOptions } from './memory'
export { openVault, type Vault, type VaultOptions } from './vault'
export { idbStore, idbWipe, type IdbStore, type IdbStoreOptions } from './idb'
export { ambientIdb, type IdbFactory, type IdbRanges } from './idb-api'
