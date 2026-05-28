declare const __SYNC_ENGINE_DEV__: boolean

declare module 'virtual:sync-engine-registry' {
  import type { EntityDef, InfiniteQueryDef, MutationDef, QueryDef } from './engine/core/types'
  type AnyQueryDef = (QueryDef | InfiniteQueryDef) & { name: string }
  const registry: {
    entities: ReadonlyArray<EntityDef>
    queries: ReadonlyArray<AnyQueryDef>
    mutations: ReadonlyArray<MutationDef>
  }
  export default registry
}
