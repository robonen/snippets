import { computed, onScopeDispose, shallowRef, watch, type ComputedRef, type MaybeRefOrGetter, toValue } from 'vue'
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
  // Track the active subId reactively (not the state ref itself — passing a ref into shallowRef
  // unwraps it). Resolving through ensureQuery() inside each computed means the computed tracks
  // both `subId` and the resolved ref, so it re-runs on both an args switch and a data update.
  const subId = shallowRef(currentHandle.subId)
  const state = () => engine.mirror.ensureQuery<TResult>(subId.value).value

  if (!def.staticHash) {
    watch(
      () => hashKey(def.key(toValue(args))),
      () => {
        const next = toValue(args)
        const prev = currentHandle
        currentHandle = engine.subscribeQuery(def.name, def.key(next), next)
        subId.value = currentHandle.subId
        prev.release()
      },
    )
  }

  onScopeDispose(() => currentHandle.release())

  return {
    data: computed(() => state().data),
    status: computed(() => state().status),
    error: computed(() => state().error),
    isLoading: computed(() => state().status === Status.Pending),
    isSuccess: computed(() => state().status === Status.Success),
    isError: computed(() => state().status === Status.Error),
  }
}
