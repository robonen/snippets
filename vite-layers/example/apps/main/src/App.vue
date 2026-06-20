<script setup lang="ts">
import { useRoute } from '@/router'
import AppHeader from '@/components/AppHeader.vue'
import AppFooter from '@/components/AppFooter.vue'

// The whole shell — header, footer, routed page — is shared by every brand. Brands change only
// their logo, their theme.css tokens, and their Landing page.
const { current } = useRoute()
</script>

<template>
  <div class="flex min-h-dvh flex-col bg-canvas font-sans text-ink antialiased">
    <AppHeader />
    <main class="flex-1">
      <component :is="current" v-if="current" />
    </main>
    <AppFooter />
  </div>
</template>
