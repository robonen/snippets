import { defineEntity, defineInfiniteQuery, defineMutation, defineQuery } from '../define'

export interface User {
  id: string
  name: string
  age: number
}

export const UserEntity = defineEntity<User>({
  name: 'user',
  id: (u) => u.id,
})

export interface ListUsersResp {
  items: User[]
  nextCursor: string | null
}

export const flush = () =>
  new Promise<void>((r) =>
    queueMicrotask(() =>
      queueMicrotask(() =>
        queueMicrotask(() => queueMicrotask(() => queueMicrotask(r))),
      ),
    ),
  )

export function makeUserDefs(api: {
  list: (args: { search?: string; cursor?: string | null }) => Promise<ListUsersResp>
  update: (input: { id: string; patch: Partial<User> }) => Promise<User>
}) {
  const usersList = defineQuery<{ search?: string }, ListUsersResp, { ids: string[] }>({
    name: 'users.list',
    key: (args) => ['users', 'list', args.search ?? ''],
    fetch: (args) => api.list({ search: args.search, cursor: null }),
    normalize: (resp) => ({
      entities: { user: resp.items },
      result: { ids: resp.items.map((u) => u.id) },
    }),
    tags: () => ['users'],
    staleTime: 1000,
  })

  const usersInfinite = defineInfiniteQuery<
    { search?: string },
    ListUsersResp,
    string | null,
    { ids: string[]; nextCursor: string | null }
  >({
    name: 'users.infinite',
    key: (args) => ['users', 'infinite', args.search ?? ''],
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor,
    fetch: (args, ctx) => api.list({ search: args.search, cursor: ctx.pageParam }),
    normalize: (resp) => ({
      entities: { user: resp.items },
      result: { ids: resp.items.map((u) => u.id), nextCursor: resp.nextCursor },
    }),
  })

  const updateUser = defineMutation<{ id: string; patch: Partial<User> }, User>({
    name: 'users.update',
    fetch: (input) => api.update(input),
    optimistic: (input, ctx) => ctx.patchEntity(UserEntity, input.id, input.patch),
    invalidate: () => ['users'],
  })

  return { usersList, usersInfinite, updateUser }
}
