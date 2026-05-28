<script setup lang="ts">
import { computed, ref } from 'vue'
import { Status, useEngine, useInfiniteQuery, useMutation, useQuery } from './engine'
import { PostEntity, UserEntity, postsInfinite, updatePostTitle, usersQuery, type Post, type User } from './demo.defs'
import PostCard from './PostCard.vue'

const engine = useEngine()
const selectedUserId = ref<number | undefined>(undefined)

const users = useQuery(usersQuery, () => undefined as void)
const userList = computed(() =>
  (users.data.value?.ids ?? [])
    .map((id) => engine.mirror.getEntity<User>(UserEntity.name, id))
    .filter((u): u is User => !!u),
)

const posts = useInfiniteQuery(postsInfinite, () => ({ userId: selectedUserId.value }))
const postIds = computed(() => posts.pages.value.flatMap((p) => p.ids))
const postsByIds = computed(() =>
  postIds.value
    .map((id) => engine.mirror.getEntity<Post>(PostEntity.name, id))
    .filter((p): p is Post => !!p),
)

const editingId = ref<number | null>(null)
const draft = ref('')
const m = useMutation(updatePostTitle)

function startEdit(id: number, title: string) {
  editingId.value = id
  draft.value = title
}

async function save() {
  if (editingId.value == null) return
  const id = editingId.value
  editingId.value = null
  try {
    await m.mutateAsync({ id, title: draft.value })
  } catch {}
}
</script>

<template>
  <main class="app">
    <header>
      <h1>vue-sync-engine demo</h1>
      <p>JSONPlaceholder · IndexedDB cache · optimistic mutations · infinite scroll</p>
    </header>

    <aside class="users">
      <h2>Users <span v-if="users.isLoading.value">…</span></h2>
      <ul>
        <li>
          <button :class="{ active: selectedUserId === undefined }" @click="selectedUserId = undefined">
            All posts
          </button>
        </li>
        <li v-for="u in userList" :key="u.id">
          <button :class="{ active: selectedUserId === u.id }" @click="selectedUserId = u.id">
            {{ u.name }} <small>@{{ u.username }}</small>
          </button>
        </li>
      </ul>
    </aside>

    <section class="posts">
      <h2>Posts <span v-if="posts.isLoading.value">…</span></h2>
      <PostCard
        v-for="p in postsByIds"
        :key="p.id"
        :post="p"
        :editing="editingId === p.id"
        :draft="draft"
        @edit="startEdit(p.id, p.title)"
        @input="draft = $event"
        @save="save"
        @cancel="editingId = null"
      />
      <button class="more" :disabled="posts.isLoading.value" @click="posts.fetchNextPage">
        {{ posts.isLoading.value ? 'Loading…' : 'Load more' }}
      </button>
      <p v-if="m.status.value === Status.Error" class="err">Mutation failed: {{ m.error.value?.message }}</p>
    </section>
  </main>
</template>

<style scoped>
.app {
  max-width: 920px;
  margin: 0 auto;
  padding: 24px;
  font-family: system-ui, sans-serif;
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 24px;
}
header {
  grid-column: 1 / -1;
}
h1 { margin: 0; }
h2 {
  margin-top: 0;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #666;
}
.users ul {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.users button {
  width: 100%;
  text-align: left;
  padding: 8px 10px;
  border: 1px solid #ddd;
  background: white;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}
.users button.active {
  background: #111;
  color: white;
  border-color: #111;
}
.more {
  width: 100%;
  padding: 10px;
  border-radius: 6px;
  border: 1px dashed #ccc;
  background: #fafafa;
  cursor: pointer;
}
.err {
  color: #c00;
  font-size: 12px;
}
</style>
