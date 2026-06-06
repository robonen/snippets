<script setup lang="ts">
// Подсветка выполняется на этапе сборки — в браузер уходит готовый HTML,
// без Shiki/грамматик в бандле.
import codeHtml from './assets/snippet.ts?shiki';
import ShikiStatic from './ShikiCode/ShikiStatic.vue';
</script>

<template>
  <main class="h-full w-full flex">
    <div class="m-auto max-w-136 rounded-3xl overflow-clip">
      <ShikiStatic :html="codeHtml" line-numbers />
    </div>
  </main>
</template>

<style>
@import 'tailwindcss';

#app {
  @apply h-svh w-screen antialiased;
}
</style>