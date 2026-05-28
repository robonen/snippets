import type { EntityPatch, Patch, QueryStatus } from '../core/types'
import { Msg } from '../core/flags'

export interface SubscribeMsg {
  type: typeof Msg.Subscribe
  subId: string
  defName: string
  args: unknown
}
export interface UnsubscribeMsg {
  type: typeof Msg.Unsubscribe
  subId: string
}
export interface MutateMsg {
  type: typeof Msg.Mutate
  mutId: string
  defName: string
  input: unknown
}
export interface FetchNextPageMsg {
  type: typeof Msg.FetchNextPage
  subId: string
}

export type ClientMsg = SubscribeMsg | UnsubscribeMsg | MutateMsg | FetchNextPageMsg

export interface QueryPatchMsg {
  type: typeof Msg.QueryPatch
  subId: string
  status: QueryStatus
  patch?: Patch
  error?: { message: string }
}
export interface EntityPatchMsg {
  type: typeof Msg.EntityPatch
  patches: EntityPatch[]
}
export interface MutateResultMsg {
  type: typeof Msg.MutateResult
  mutId: string
  ok: boolean
  data?: unknown
  error?: { message: string }
}

export type ServerMsg = QueryPatchMsg | EntityPatchMsg | MutateResultMsg

export interface Transport {
  send(msg: ClientMsg): void
  onMessage(handler: (msg: ServerMsg) => void): () => void
}

export interface ServerEndpoint {
  receive(msg: ClientMsg): void
  broadcast(msg: ServerMsg): void
  onClient(handler: (msg: ClientMsg) => void): () => void
}
