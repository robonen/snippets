export const Op = {
  Set: 1,
  Merge: 2,
  Delete: 4,
} as const
export type OpFlag = 1 | 2 | 4

export const Status = {
  Idle: 0,
  Pending: 1,
  Success: 2,
  Error: 3,
} as const
export type StatusFlag = 0 | 1 | 2 | 3

export const Msg = {
  Subscribe: 1,
  Unsubscribe: 2,
  Mutate: 3,
  FetchNextPage: 4,
  QueryPatch: 5,
  EntityPatch: 6,
  MutateResult: 7,
} as const
export type MsgKind = 1 | 2 | 3 | 4 | 5 | 6 | 7

export const Kind = {
  Entity: 1,
  Query: 2,
  Infinite: 3,
  Mutation: 4,
} as const
export type KindFlag = 1 | 2 | 3 | 4
