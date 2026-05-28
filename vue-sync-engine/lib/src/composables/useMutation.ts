import { shallowRef, type ShallowRef } from 'vue'
import type { MutationDef, QueryStatus } from '../core/types'
import { Status } from '../core/flags'
import { useEngine } from './useEngine'

export interface UseMutationReturn<TInput, TResp> {
  mutate: (input: TInput) => void
  mutateAsync: (input: TInput) => Promise<TResp>
  status: ShallowRef<QueryStatus>
  error: ShallowRef<Error | undefined>
  data: ShallowRef<TResp | undefined>
}

export function useMutation<TInput, TResp>(
  def: MutationDef<TInput, TResp>,
): UseMutationReturn<TInput, TResp> {
  const engine = useEngine()
  const status = shallowRef<QueryStatus>(Status.Idle)
  const error = shallowRef<Error | undefined>(undefined)
  const data = shallowRef<TResp | undefined>(undefined)

  async function mutateAsync(input: TInput): Promise<TResp> {
    status.value = Status.Pending
    error.value = undefined
    try {
      const resp = (await engine.mutate(def.name, input)) as TResp
      data.value = resp
      status.value = Status.Success
      return resp
    } catch (e) {
      error.value = e as Error
      status.value = Status.Error
      throw e
    }
  }

  function mutate(input: TInput): void {
    void mutateAsync(input).catch(() => {})
  }

  return { mutate, mutateAsync, status, error, data }
}
