<script setup lang="ts">
// Northwind's landing — overrides main/src/pages/Landing.vue via the layer resolver. Its own copy,
// layout and imagery; the surrounding header/footer/profile stay shared with every other brand.
const points = [
  'Bring your own cloud — deploy into your existing accounts.',
  'Granular roles and SSO included on every tier.',
  'Usage-based pricing that scales down as well as up.',
  'Migrate from anywhere with first-party importers.',
]
const regions = ['us-east', 'eu-west', 'ap-south', 'sa-east']
</script>

<template>
  <div>
    <!-- Split hero -->
    <section class="mx-auto grid max-w-6xl items-center gap-12 px-6 pt-16 pb-20 lg:grid-cols-2">
      <div>
        <span class="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-muted">
          <span class="h-1.5 w-1.5 rounded-full bg-brand" /> Trusted by 2,400+ teams
        </span>
        <h1 class="mt-6 text-balance text-5xl font-semibold tracking-tight text-ink">
          Infrastructure that feels like home
        </h1>
        <p class="mt-5 max-w-lg text-balance text-lg text-muted">
          Northwind runs your apps where your data already lives. No lock-in, no surprises — just a calmer way to operate.
        </p>
        <div class="mt-8 flex items-center gap-3">
          <a href="#/profile" class="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-on-brand shadow-sm transition hover:opacity-90">
            Open dashboard
          </a>
          <a href="#/" class="rounded-full border border-line bg-surface px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-ink/4">
            Book a demo
          </a>
        </div>
      </div>

      <!-- Product preview card -->
      <div class="rounded-card border border-line bg-surface p-2 shadow-xl shadow-brand/5">
        <div class="rounded-[calc(var(--c-radius)-0.5rem)] bg-linear-to-br from-brand to-accent p-6 text-on-brand">
          <p class="text-sm opacity-80">Cluster health</p>
          <p class="mt-1 text-3xl font-semibold">All systems nominal</p>
          <div class="mt-6 grid grid-cols-4 gap-2">
            <div v-for="r in regions" :key="r" class="rounded-xl bg-on-brand/15 px-2 py-3 text-center backdrop-blur">
              <p class="text-[11px] uppercase tracking-wide opacity-80">{{ r }}</p>
              <p class="mt-1 text-sm font-semibold">99.9%</p>
            </div>
          </div>
        </div>
        <div class="flex items-center justify-between px-4 py-3">
          <p class="text-sm text-muted">Last deploy</p>
          <p class="text-sm font-medium text-ink">2 minutes ago</p>
        </div>
      </div>
    </section>

    <!-- Value checklist -->
    <section class="border-y border-line bg-surface">
      <div class="mx-auto max-w-6xl px-6 py-16">
        <h2 class="max-w-xl text-balance text-3xl font-semibold tracking-tight text-ink">Built for teams that own their stack</h2>
        <ul class="mt-8 grid gap-4 sm:grid-cols-2">
          <li v-for="p in points" :key="p" class="flex items-start gap-3 rounded-card border border-line bg-canvas p-4">
            <span class="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand/10 text-brand">
              <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7" /></svg>
            </span>
            <span class="text-sm text-ink">{{ p }}</span>
          </li>
        </ul>
      </div>
    </section>

    <!-- CTA -->
    <section class="mx-auto max-w-6xl px-6 py-20 text-center">
      <h2 class="text-balance text-3xl font-semibold tracking-tight text-ink">Move in this week</h2>
      <p class="mx-auto mt-3 max-w-md text-balance text-muted">Import your first workload and we'll match your current bill for 90 days.</p>
      <a href="#/profile" class="mt-7 inline-block rounded-full bg-brand px-6 py-2.5 text-sm font-semibold text-on-brand shadow-sm transition hover:opacity-90">
        Get started free
      </a>
    </section>
  </div>
</template>
