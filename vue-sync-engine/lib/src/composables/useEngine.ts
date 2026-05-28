import { inject, type InjectionKey } from 'vue'
import type { TabRuntime } from '../tab/runtime'

export const EngineKey: InjectionKey<TabRuntime> = Symbol('SyncEngine')

export function useEngine(): TabRuntime {
  const rt = inject(EngineKey)
  if (!rt) throw new Error('SyncEngine is not provided. Call app.provide(EngineKey, runtime).')
  return rt
}
