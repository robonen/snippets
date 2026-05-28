import { computed, type ComputedRef, type MaybeRefOrGetter, toValue } from 'vue'
import type { EntityDef, EntityId } from '../core/types'
import { useEngine } from './useEngine'

export function useEntity<T>(
  def: EntityDef<T>,
  id: MaybeRefOrGetter<EntityId | undefined>,
): ComputedRef<T | undefined> {
  const engine = useEngine()
  return computed(() => {
    const v = toValue(id)
    if (v === undefined || v === null) return undefined
    return engine.mirror.getEntity<T>(def.name, v)
  })
}
