<script setup lang="ts">
// Shared by every brand — identical structure, only recolored by the active theme.css.
const columns = [
  { title: 'Product', links: ['Overview', 'Features', 'Pricing', 'Changelog'] },
  { title: 'Company', links: ['About', 'Careers', 'Blog', 'Contact'] },
  { title: 'Resources', links: ['Docs', 'Guides', 'API', 'Status'] },
  { title: 'Legal', links: ['Privacy', 'Terms', 'Security', 'Cookies'] },
]
const year = new Date().getFullYear()

// Layered public/ asset — bind so it stays a runtime URL (see AppHeader for the why).
const logo = '/logo.svg'
</script>

<template>
  <footer class="border-t border-line bg-surface">
    <div class="mx-auto max-w-6xl px-6 py-14">
      <div class="grid gap-10 md:grid-cols-[1.4fr_repeat(4,1fr)]">
        <div class="max-w-xs">
          <img :src="logo" alt="Logo" class="h-7 w-auto" />
          <p class="mt-4 text-sm leading-relaxed text-muted">
            The platform layer your whole organization builds on. Ship faster, on infrastructure you trust.
          </p>
        </div>

        <div v-for="col in columns" :key="col.title">
          <h3 class="text-sm font-semibold text-ink">{{ col.title }}</h3>
          <ul class="mt-3 space-y-2.5">
            <li v-for="link in col.links" :key="link">
              <a href="#/" class="text-sm text-muted transition-colors hover:text-ink">{{ link }}</a>
            </li>
          </ul>
        </div>
      </div>

      <div class="mt-12 flex flex-col items-center justify-between gap-4 border-t border-line pt-6 sm:flex-row">
        <p class="text-sm text-muted">&copy; {{ year }} — built on vite-layers.</p>
        <div class="flex items-center gap-2">
          <span
            v-for="dot in 3"
            :key="dot"
            class="h-8 w-8 rounded-full border border-line bg-canvas"
            aria-hidden="true"
          />
        </div>
      </div>
    </div>
  </footer>
</template>
