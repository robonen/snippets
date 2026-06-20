<script setup lang="ts">
// Acme's landing — the base version. Each brand ships its own Landing.vue at this path; the layer
// resolver picks the highest-priority one, so the marketing page is fully brand-owned while the
// header, footer and profile around it stay shared.
const features = [
  { title: 'Layered by design', body: 'Compose every surface from shared layers. Override only what a brand needs.' },
  { title: 'Ship in minutes', body: 'Push to production on infrastructure that scales from prototype to fleet.' },
  { title: 'Observability built in', body: 'Traces, logs and metrics on by default — no agents to wire up.' },
  { title: 'Secure by default', body: 'SSO, audit logs and fine-grained roles included in every plan.' },
]
const stats = [
  { value: '99.99%', label: 'Uptime SLA' },
  { value: '120ms', label: 'p95 latency' },
  { value: '8,000+', label: 'Teams' },
]
</script>

<template>
  <div>
    <!-- Hero -->
    <section class="relative overflow-hidden">
      <div
        class="pointer-events-none absolute inset-x-0 -top-32 mx-auto h-72 max-w-4xl rounded-full bg-linear-to-br from-brand to-accent opacity-20 blur-3xl"
        aria-hidden="true"
      />
      <div class="mx-auto max-w-3xl px-6 pt-20 pb-16 text-center">
        <span class="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-muted">
          <span class="h-1.5 w-1.5 rounded-full bg-brand" /> Now with edge deployments
        </span>
        <h1 class="mt-6 text-balance text-5xl font-semibold tracking-tight text-ink sm:text-6xl">
          The cloud platform your team grows into
        </h1>
        <p class="mx-auto mt-5 max-w-xl text-balance text-lg text-muted">
          Acme gives you the building blocks to launch, scale and operate modern apps — without stitching together a dozen tools.
        </p>
        <div class="mt-8 flex items-center justify-center gap-3">
          <a href="#/" class="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-on-brand shadow-sm transition hover:opacity-90">
            Start for free
          </a>
          <a href="#/billing" class="rounded-full border border-line bg-surface px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-ink/4">
            See pricing
          </a>
        </div>
      </div>
    </section>

    <!-- Stats -->
    <section class="mx-auto max-w-5xl px-6">
      <div class="grid grid-cols-3 gap-4 rounded-card border border-line bg-surface p-8">
        <div v-for="s in stats" :key="s.label" class="text-center">
          <p class="text-3xl font-semibold tracking-tight text-ink">{{ s.value }}</p>
          <p class="mt-1 text-sm text-muted">{{ s.label }}</p>
        </div>
      </div>
    </section>

    <!-- Features -->
    <section class="mx-auto max-w-5xl px-6 py-20">
      <h2 class="max-w-2xl text-balance text-3xl font-semibold tracking-tight text-ink">
        Everything you need, nothing you don't
      </h2>
      <div class="mt-10 grid gap-5 sm:grid-cols-2">
        <article v-for="f in features" :key="f.title" class="rounded-card border border-line bg-surface p-6">
          <div class="grid h-10 w-10 place-items-center rounded-xl bg-brand/10 text-brand">
            <span class="h-2.5 w-2.5 rounded-full bg-brand" />
          </div>
          <h3 class="mt-4 text-lg font-semibold text-ink">{{ f.title }}</h3>
          <p class="mt-2 text-sm leading-relaxed text-muted">{{ f.body }}</p>
        </article>
      </div>
    </section>

    <!-- CTA band -->
    <section class="mx-auto max-w-5xl px-6 pb-24">
      <div class="overflow-hidden rounded-card bg-linear-to-br from-brand to-accent px-8 py-14 text-center text-on-brand">
        <h2 class="text-balance text-3xl font-semibold tracking-tight">Ready to build on Acme?</h2>
        <p class="mx-auto mt-3 max-w-md text-balance opacity-90">Spin up your first project in under five minutes. No card required.</p>
        <a href="#/profile" class="mt-7 inline-block rounded-full bg-on-brand px-6 py-2.5 text-sm font-semibold text-brand transition hover:opacity-90">
          Create your workspace
        </a>
      </div>
    </section>
  </div>
</template>
