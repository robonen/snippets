import { defineEntity, defineInfiniteQuery, defineMutation, defineQuery, idbStore } from './engine'

export interface Post {
  id: number
  userId: number
  title: string
  body: string
}

export interface User {
  id: number
  name: string
  email: string
  username: string
}

export const PostEntity = defineEntity<Post>({
  name: 'post',
  id: (p) => p.id,
  storage: idbStore({ dbName: 'demo-sync-engine' }),
})
export const UserEntity = defineEntity<User>({
  name: 'user',
  id: (u) => u.id,
  storage: idbStore({ dbName: 'demo-sync-engine' }),
})

const BASE = 'https://jsonplaceholder.typicode.com'

async function http<T>(url: string, init?: RequestInit, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { ...init, signal })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return (await res.json()) as T
}

export const usersQuery = defineQuery<void, User[], { ids: number[] }>({
  name: 'users.list',
  key: () => ['users'],
  fetch: (_, ctx) => http<User[]>(`${BASE}/users`, undefined, ctx.signal),
  normalize: (items) => ({
    entities: { user: items },
    result: { ids: items.map((u) => u.id) },
  }),
  tags: () => ['users'],
  staleTime: 60_000,
})

export const postsInfinite = defineInfiniteQuery<
  { userId?: number },
  Post[],
  number,
  { ids: number[]; nextPage: number | null }
>({
  name: 'posts.infinite',
  key: (args) => ['posts', args.userId ?? 'all'],
  initialPageParam: 1,
  getNextPageParam: (last) => last.nextPage,
  fetch: (args, ctx) => {
    const params = new URLSearchParams({ _page: String(ctx.pageParam), _limit: '10' })
    if (args.userId != null) params.set('userId', String(args.userId))
    return http<Post[]>(`${BASE}/posts?${params}`, undefined, ctx.signal)
  },
  normalize: (items, _args, pageParam) => ({
    entities: { post: items },
    result: {
      ids: items.map((p) => p.id),
      nextPage: items.length === 10 ? (pageParam as number) + 1 : null,
    },
  }),
  tags: () => ['posts'],
  staleTime: 60_000,
})

export const updatePostTitle = defineMutation<{ id: number; title: string }, Post>({
  name: 'post.updateTitle',
  fetch: (input, ctx) =>
    http<Post>(
      `${BASE}/posts/${input.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: input.title }),
      },
      ctx.signal,
    ),
  optimistic: (input, ctx) => ctx.patchEntity(PostEntity, input.id, { title: input.title }),
})
