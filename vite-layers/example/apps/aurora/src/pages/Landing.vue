<script setup lang="ts">
// Aurora's landing — its own dark, neon take. Same shared shell around it; only this page, the
// logo and the theme tokens are Aurora's.
const pillars = [
  { kbd: '01', title: 'Realtime by default', body: 'Streams, presence and sync primitives baked into the runtime.' },
  { kbd: '02', title: 'Edge native', body: 'Deploy to 30+ regions and serve from the closest one automatically.' },
  { kbd: '03', title: 'Zero-config scale', body: 'From first request to a million — no capacity planning, ever.' },
]
const metrics = ['30+ regions', '4ms cold start', '∞ concurrency', '24/7 support']
</script>

<template>
  <div>
    <!-- Hero -->
    <section class="relative overflow-hidden">
      <div
        class="pointer-events-none absolute -top-40 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-linear-to-br from-brand to-accent opacity-25 blur-3xl"
        aria-hidden="true"
      />
      <div class="mx-auto max-w-3xl px-6 pt-24 pb-12 text-center">
        <span class="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-muted">
          <span class="h-1.5 w-1.5 rounded-full bg-brand" /> Aurora 2.0 is live
        </span>
        <h1 class="mt-6 text-balance text-5xl font-semibold tracking-tight text-ink sm:text-6xl">
          Ship at the speed of
          <span class="bg-linear-to-br from-brand to-accent bg-clip-text text-transparent">light</span>
        </h1>
        <p class="mx-auto mt-5 max-w-xl text-balance text-lg text-muted">
          Aurora is the realtime cloud for builders who refuse to wait. Push code, watch it go global in seconds.
        </p>
        <div class="mt-8 flex items-center justify-center gap-3">
          <a href="#/billing" class="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-on-brand shadow-sm transition hover:opacity-90">
            Launch a project
          </a>
          <a href="#/profile" class="rounded-full border border-line bg-surface px-5 py-2.5 text-sm font-semibold text-ink transition hover:opacity-90">
            View console
          </a>
        </div>
      </div>

      <!-- Metric marquee -->
      <div class="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-x-8 gap-y-2 px-6 pb-16 text-sm text-muted">
        <span v-for="m in metrics" :key="m" class="flex items-center gap-2">
          <span class="h-1 w-1 rounded-full bg-accent" /> {{ m }}
        </span>
      </div>
    </section>

    <!-- Pillars -->
    <section class="mx-auto max-w-5xl px-6 pb-24">
      <div class="grid gap-5 sm:grid-cols-3">
        <article v-for="p in pillars" :key="p.kbd" class="rounded-card border border-line bg-surface p-6">
          <span class="font-mono text-sm text-brand">{{ p.kbd }}</span>
          <h3 class="mt-3 text-lg font-semibold text-ink">{{ p.title }}</h3>
          <p class="mt-2 text-sm leading-relaxed text-muted">{{ p.body }}</p>
        </article>
      </div>

      <div class="mt-10 overflow-hidden rounded-card border border-line bg-linear-to-br from-brand/15 to-accent/10 px-8 py-14 text-center">
        <h2 class="text-balance text-3xl font-semibold tracking-tight text-ink">Your next deploy is one command away</h2>
        <a href="#/billing" class="mt-7 inline-block rounded-full bg-brand px-6 py-2.5 text-sm font-semibold text-on-brand shadow-sm transition hover:opacity-90">
          Start building
        </a>
      </div>
    </section>
  </div>
</template>
