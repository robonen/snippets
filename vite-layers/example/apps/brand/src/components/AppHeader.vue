<script setup lang="ts">
const title = 'BRAND_HEADER_OVERRIDE'
const p2p = __FEATURES__.p2p
</script>

<template>
  <header>{{ title }}</header>
  <p v-if="p2p">p2p</p>
</template>
