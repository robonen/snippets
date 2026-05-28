export type EntityId = string | number

import type { StatusFlag, Kind } from './flags'
import type { KeyedStore } from './keyedStore'

export interface EntityDef<T = any> {
  readonly kind: typeof Kind.Entity
  readonly name: string
  readonly id: (entity: T) => EntityId
  readonly storage?: KeyedStore<T>
}

export interface NormalizedResult {
  entities: Record<string, ReadonlyArray<unknown>>
  result: unknown
}

export interface ExecCtx {
  readonly signal: AbortSignal
  readonly pageParam: unknown
}
export interface ExecResult {
  readonly pageResult: unknown
  readonly entities: Record<string, ReadonlyArray<unknown>> | null
}

export interface QueryDef<TArgs = any, TResp = any, TResult = any> {
  readonly kind: typeof Kind.Query
  readonly key: (args: TArgs) => readonly unknown[]
  readonly fetch: (args: TArgs, ctx: FetchCtx) => Promise<TResp>
  readonly normalize?: (resp: TResp, args: TArgs) => { entities?: Record<string, ReadonlyArray<unknown>>; result: TResult }
  readonly tags?: (args: TArgs) => readonly string[]
  readonly staleTime?: number
  readonly gcTime?: number
  readonly staticHash?: string | null
  readonly exec?: (args: TArgs, ctx: ExecCtx) => Promise<ExecResult>
}

export interface InfiniteQueryDef<TArgs = any, TResp = any, TPageParam = any, TResult = any>
  extends Omit<QueryDef<TArgs, TResp, TResult>, 'kind' | 'fetch' | 'normalize' | 'exec'> {
  readonly kind: typeof Kind.Infinite
  readonly initialPageParam: TPageParam
  readonly getNextPageParam: (lastPage: TResult, allPages: TResult[]) => TPageParam | null | undefined
  readonly fetch: (args: TArgs, ctx: FetchCtx & { pageParam: TPageParam }) => Promise<TResp>
  readonly normalize?: (resp: TResp, args: TArgs, pageParam: TPageParam) => { entities?: Record<string, ReadonlyArray<unknown>>; result: TResult }
  readonly exec?: (args: TArgs, ctx: ExecCtx) => Promise<ExecResult>
}

export interface MutationDef<TInput = any, TResp = any> {
  readonly kind: typeof Kind.Mutation
  readonly name: string
  readonly fetch: (input: TInput, ctx: FetchCtx) => Promise<TResp>
  readonly optimistic?: (input: TInput, ctx: OptimisticCtx) => void
  readonly onSuccess?: (resp: TResp, input: TInput, ctx: OptimisticCtx) => void
  readonly invalidate?: (input: TInput, resp?: TResp) => ReadonlyArray<QueryDef | InfiniteQueryDef | string>
  readonly maxRetries?: number
}

export interface FetchCtx {
  readonly signal: AbortSignal
}

export interface OptimisticCtx {
  patchEntity<T>(def: EntityDef<T>, id: EntityId, patch: Partial<T>): void
  removeEntity<T>(def: EntityDef<T>, id: EntityId): void
  upsertEntity<T>(def: EntityDef<T>, entity: T): void
}

export type Patch =
  | { op: 1; path: readonly (string | number)[]; value: unknown }
  | { op: 2; path: readonly (string | number)[]; value: Record<string, unknown> }
  | { op: 4; path: readonly (string | number)[] }

export interface EntityPatch {
  type: string
  id: EntityId
  patch: Patch
}

export type QueryStatus = StatusFlag

export interface QuerySnapshot<TResult = unknown> {
  status: QueryStatus
  result?: TResult
  error?: { message: string }
  updatedAt?: number
  entityRefs?: ReadonlyArray<{ type: string; id: EntityId }>
}

export interface QueuedMutation {
  id: string
  seq: number
  name: string
  input: unknown
  inversePatches?: EntityPatch[]
  createdAt: number
  attempts: number
  state: 'pending' | 'inflight' | 'failed'
}

export type QueryKey = readonly unknown[]
