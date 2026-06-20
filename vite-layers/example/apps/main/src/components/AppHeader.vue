<script setup lang="ts">
import { feature } from '#feature'
import { routes, useRoute } from '@/router'

// One header for every brand. The only thing that differs per brand is `/logo.svg` (a layered
// public/ asset) and the theme tokens behind the utility classes.
const { currentPath } = useRoute()

// Read the build-time flag in <script> (a compiled `_ctx.feature` in a template is not a macro
// call); use the local in the template. Folds to a literal, so the pill is DCE'd out in production.
const beta = feature('betaBanner')

// `/logo.svg` is a layered public/ asset served at runtime — bind it (not a static `src`) so the
// Vue compiler keeps it a URL instead of trying to resolve it as a module at build time.
const logo = '/logo.svg'
</script>

<template>
  <header class="sticky top-0 z-20 border-b border-line bg-surface/80 backdrop-blur">
    <div class="mx-auto flex h-16 max-w-6xl items-center gap-5 px-6">
      <a href="#/" class="flex shrink-0 items-center gap-2">
        <img :src="logo" alt="Logo" class="h-7 w-auto" />
      </a>

      <span
        v-if="beta"
        class="hidden rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-xs font-semibold tracking-wide text-brand sm:inline"
      >
        BETA
      </span>

      <nav class="ml-2 hidden items-center gap-1 md:flex">
        <a
          v-for="r in routes"
          :key="r.path"
          :href="`#${r.path}`"
          class="rounded-full px-3 py-1.5 text-sm font-medium transition-colors"
          :class="currentPath === r.path ? 'bg-ink/6 text-ink' : 'text-muted hover:text-ink'"
        >
          {{ r.label }}
        </a>
      </nav>

      <div class="ml-auto flex items-center gap-3">
        <a href="#/profile" class="hidden text-sm font-medium text-muted transition-colors hover:text-ink sm:block">
          Sign in
        </a>
        <a
          href="#/"
          class="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-on-brand shadow-sm transition hover:opacity-90"
        >
          Get started
        </a>
      </div>
    </div>
  </header>
</template>
