import { computed, toValue } from 'vue';
import type { ComputedRef, MaybeRefOrGetter } from 'vue';
import { useEngine } from 'vue-sync-engine';
import type { EntityDef } from 'vue-sync-engine';

/**
 * Реактивный список сущностей по массиву id из нормализованного результата
 * запроса. Mirror отдаёт per-entity версии, поэтому optimistic-патч одной
 * записи не пересобирает соседей.
 */
export function useEntities<T>(
  def: EntityDef<T>,
  ids: MaybeRefOrGetter<readonly string[] | undefined>,
): ComputedRef<T[]> {
  const engine = useEngine();
  return computed(() => {
    const list = toValue(ids) ?? [];
    const items: T[] = [];
    for (const id of list) {
      const item = engine.mirror.getEntity<T>(def.name, id);
      if (item !== undefined) items.push(item);
    }
    return items;
  });
}
