<script setup lang="ts">
import type { Post } from './demo.defs'

defineProps<{ post: Post; editing: boolean; draft: string }>()
defineEmits<{
  edit: []
  input: [value: string]
  save: []
  cancel: []
}>()
</script>

<template>
  <article class="post">
    <div v-if="editing" class="edit">
      <input :value="draft" @input="$emit('input', ($event.target as HTMLInputElement).value)" />
      <button @click="$emit('save')">Save</button>
      <button @click="$emit('cancel')">Cancel</button>
    </div>
    <h3 v-else>
      {{ post.title }}
      <button class="edit-btn" @click="$emit('edit')">✎</button>
    </h3>
    <p>{{ post.body }}</p>
    <small>user {{ post.userId }} · #{{ post.id }}</small>
  </article>
</template>

<style scoped>
.post {
  border: 1px solid #eee;
  border-radius: 8px;
  padding: 12px 16px;
  margin-bottom: 12px;
}
h3 {
  margin: 0 0 4px;
  font-size: 15px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
p {
  margin: 0 0 6px;
  font-size: 13px;
  color: #444;
}
small {
  color: #999;
  font-size: 11px;
}
.edit {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
}
.edit input {
  flex: 1;
  padding: 6px 8px;
  font-size: 14px;
}
.edit-btn {
  background: transparent;
  border: none;
  cursor: pointer;
  opacity: 0.4;
  font-size: 14px;
}
.edit-btn:hover {
  opacity: 1;
}
</style>
