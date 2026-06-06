import { computed, onScopeDispose, shallowRef, watch, type ComputedRef, type MaybeRefOrGetter, toValue } from 'vue'
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
  // Track the active subId reactively and resolve via ensureQuery (see useQuery for rationale).
  const subId = shallowRef(handle.subId)
  const state = () => engine.mirror.ensureQuery<InfinitePayload<TResult>>(subId.value).value

  if (!def.staticHash) {
    watch(
      () => hashKey(def.key(toValue(args))),
      () => {
        const next = toValue(args)
        const prev = handle
        handle = engine.subscribeQuery(def.name, def.key(next), next)
        subId.value = handle.subId
        prev.release()
      },
    )
  }

  onScopeDispose(() => handle.release())

  return {
    pages: computed(() => state().data?.pages ?? []),
    pageParams: computed(() => state().data?.pageParams ?? []),
    status: computed(() => state().status),
    error: computed(() => state().error),
    isLoading: computed(() => state().status === Status.Pending),
    fetchNextPage: () => handle.fetchNextPage(),
  }
}
