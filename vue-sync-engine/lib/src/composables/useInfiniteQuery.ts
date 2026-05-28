import { computed, onScopeDispose, watch, type ComputedRef, type MaybeRefOrGetter, toValue } from 'vue'
import type { InfiniteQueryDef, QueryStatus } from '../core/types'
import { Status } from '../core/flags'
import { hashKey } from '../core/queryKey'
import { useEngine } from './useEngine'

export interface UseInfiniteQueryReturn<TResult> {
  pages: ComputedRef<TResult[]>
  pageParams: ComputedRef<unknown[]>
  status: ComputedRef<QueryStatus>
  error: ComputedRef<{ message: string } | undefined>
  isLoading: ComputedRef<boolean>
  fetchNextPage: () => void
}

interface InfinitePayload<T> {
  pages: T[]
  pageParams: unknown[]
}

export function useInfiniteQuery<TArgs, TResp, TPageParam, TResult>(
  def: InfiniteQueryDef<TArgs, TResp, TPageParam, TResult> & { name: string },
  args: MaybeRefOrGetter<TArgs>,
): UseInfiniteQueryReturn<TResult> {
  const engine = useEngine()

  const initial = toValue(args)
  let handle = engine.subscribeQuery(def.name, def.key(initial), initial)
  let stateRef = engine.mirror.ensureQuery<InfinitePayload<TResult>>(handle.subId)

  if (!def.staticHash) {
    watch(
      () => hashKey(def.key(toValue(args))),
      () => {
        const next = toValue(args)
        const prev = handle
        handle = engine.subscribeQuery(def.name, def.key(next), next)
        stateRef = engine.mirror.ensureQuery<InfinitePayload<TResult>>(handle.subId)
        prev.release()
      },
    )
  }

  onScopeDispose(() => handle.release())

  return {
    pages: computed(() => stateRef.value.data?.pages ?? []),
    pageParams: computed(() => stateRef.value.data?.pageParams ?? []),
    status: computed(() => stateRef.value.status),
    error: computed(() => stateRef.value.error),
    isLoading: computed(() => stateRef.value.status === Status.Pending),
    fetchNextPage: () => handle.fetchNextPage(),
  }
}
