<script setup lang="ts">
import code from './assets/snippet?raw';
import ShikiCode from './ShikiCode/ShikiCode.vue';
</script>

<template>
  <main class="h-full w-full flex">
    <div class="m-auto max-w-136 rounded-3xl overflow-clip">
      <ShikiCode :code line-numbers />
    </div>
  </main>
</template>

<style>
@import 'tailwindcss';

#app {
  @apply h-svh w-screen antialiased;
}
</style>