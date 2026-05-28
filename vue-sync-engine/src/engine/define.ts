import type { EntityDef, ExecCtx, ExecResult, FetchCtx, InfiniteQueryDef, MutationDef, QueryDef } from './core/types'
import type { KeyedStoreFactory } from './core/keyedStore'
import { Kind } from './core/flags'
import { hashKey } from './core/queryKey'

export function defineEntity<T>(def: {
  name: string
  id: (e: T) => string | number
  storage?: KeyedStoreFactory<T>
}): EntityDef<T> {
  const storage = def.storage ? def.storage(def.name) : undefined
  return Object.freeze({ kind: Kind.Entity, name: def.name, id: def.id, storage })
}

export function defineQuery<TArgs, TResp, TResult = TResp>(
  def: Omit<QueryDef<TArgs, TResp, TResult>, 'kind' | 'staticHash' | 'exec'> & { name: string },
): QueryDef<TArgs, TResp, TResult> & { name: string } {
  return Object.freeze({
    kind: Kind.Query,
    ...def,
    staticHash: precomputeStaticHash(def.key),
    exec: makeQueryExec<TArgs, TResp, TResult>(def.fetch, def.normalize),
  })
}

export function defineInfiniteQuery<TArgs, TResp, TPageParam, TResult = TResp>(
  def: Omit<InfiniteQueryDef<TArgs, TResp, TPageParam, TResult>, 'kind' | 'staticHash' | 'exec'> & { name: string },
): InfiniteQueryDef<TArgs, TResp, TPageParam, TResult> & { name: string } {
  return Object.freeze({
    kind: Kind.Infinite,
    ...def,
    staticHash: precomputeStaticHash(def.key),
    exec: makeInfiniteExec<TArgs, TResp, TPageParam, TResult>(def.fetch, def.normalize),
  })
}

export function defineMutation<TInput, TResp>(
  def: Omit<MutationDef<TInput, TResp>, 'kind'>,
): MutationDef<TInput, TResp> {
  return Object.freeze({ kind: Kind.Mutation, ...def })
}

function precomputeStaticHash(key: (args: any) => readonly unknown[]): string | null {
  if (key.length !== 0) return null
  try {
    return hashKey(key(undefined))
  } catch {
    return null
  }
}

function makeQueryExec<TArgs, TResp, TResult>(
  fetch: (args: TArgs, ctx: FetchCtx) => Promise<TResp>,
  normalize?: (resp: TResp, args: TArgs) => { entities?: Record<string, ReadonlyArray<unknown>>; result: TResult },
): (args: TArgs, ctx: ExecCtx) => Promise<ExecResult> {
  if (normalize) {
    return async (args, ctx) => {
      const resp = await fetch(args, { signal: ctx.signal })
      const norm = normalize(resp, args)
      return { pageResult: norm.result, entities: norm.entities ?? null }
    }
  }
  return async (args, ctx) => {
    const resp = await fetch(args, { signal: ctx.signal })
    return { pageResult: resp, entities: null }
  }
}

function makeInfiniteExec<TArgs, TResp, TPageParam, TResult>(
  fetch: (args: TArgs, ctx: FetchCtx & { pageParam: TPageParam }) => Promise<TResp>,
  normalize?: (resp: TResp, args: TArgs, pageParam: TPageParam) => { entities?: Record<string, ReadonlyArray<unknown>>; result: TResult },
): (args: TArgs, ctx: ExecCtx) => Promise<ExecResult> {
  if (normalize) {
    return async (args, ctx) => {
      const pp = ctx.pageParam as TPageParam
      const resp = await fetch(args, { signal: ctx.signal, pageParam: pp })
      const norm = normalize(resp, args, pp)
      return { pageResult: norm.result, entities: norm.entities ?? null }
    }
  }
  return async (args, ctx) => {
    const resp = await fetch(args, { signal: ctx.signal, pageParam: ctx.pageParam as TPageParam })
    return { pageResult: resp, entities: null }
  }
}
