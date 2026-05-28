import { computed, onScopeDispose, watch, type ComputedRef, type MaybeRefOrGetter, toValue } from 'vue'
import type { InfiniteQueryDef, QueryDef, QueryStatus } from '../core/types'
import { Status } from '../core/flags'
import { hashKey } from '../core/queryKey'
import { useEngine } from './useEngine'

export interface UseQueryReturn<T> {
  data: ComputedRef<T | undefined>
  status: ComputedRef<QueryStatus>
  error: ComputedRef<{ message: string } | undefined>
  isLoading: ComputedRef<boolean>
  isSuccess: ComputedRef<boolean>
  isError: ComputedRef<boolean>
}

export function useQuery<TArgs, TResp, TResult>(
  def: (QueryDef<TArgs, TResp, TResult> | InfiniteQueryDef<TArgs, TResp, any, TResult>) & { name: string },
  args: MaybeRefOrGetter<TArgs>,
): UseQueryReturn<TResult> {
  const engine = useEngine()

  const initial = toValue(args)
  let currentHandle = engine.subscribeQuery(def.name, def.key(initial), initial)
  let currentRef = engine.mirror.ensureQuery<TResult>(currentHandle.subId)

  if (!def.staticHash) {
    watch(
      () => hashKey(def.key(toValue(args))),
      () => {
        const next = toValue(args)
        const prev = currentHandle
        currentHandle = engine.subscribeQuery(def.name, def.key(next), next)
        currentRef = engine.mirror.ensureQuery<TResult>(currentHandle.subId)
        prev.release()
      },
    )
  }

  onScopeDispose(() => currentHandle.release())

  return {
    data: computed(() => currentRef.value.data),
    status: computed(() => currentRef.value.status),
    error: computed(() => currentRef.value.error),
    isLoading: computed(() => currentRef.value.status === Status.Pending),
    isSuccess: computed(() => currentRef.value.status === Status.Success),
    isError: computed(() => currentRef.value.status === Status.Error),
  }
}
