<script setup lang="ts">
import { reactive } from 'vue'

// This page is identical for every brand — it lives only in the base layer and is inherited as-is.
// It still adopts each brand's colors and corner radius because it's styled entirely with theme
// tokens, so the same component renders light on Acme/Northwind and dark on Aurora.
const form = reactive({
  name: 'Robin Avery',
  email: 'robin@example.com',
  timezone: 'Europe/Berlin',
  role: 'Owner',
})

const timezones = ['Europe/Berlin', 'Europe/London', 'America/New_York', 'Asia/Tokyo']

const notifications = reactive([
  { id: 'product', label: 'Product updates', desc: 'New features and improvements.', on: true },
  { id: 'security', label: 'Security alerts', desc: 'Sign-ins and credential changes.', on: true },
  { id: 'billing', label: 'Billing receipts', desc: 'Invoices and payment notices.', on: false },
])

const initials = 'RA'
</script>

<template>
  <div class="mx-auto max-w-3xl px-6 py-12">
    <header class="flex items-center gap-4">
      <div
        class="grid h-16 w-16 place-items-center rounded-card bg-linear-to-br from-brand to-accent text-xl font-semibold text-on-brand"
      >
        {{ initials }}
      </div>
      <div>
        <h1 class="text-2xl font-semibold tracking-tight text-ink">{{ form.name }}</h1>
        <p class="text-sm text-muted">{{ form.email }}</p>
      </div>
      <span
        class="ml-auto rounded-full border border-brand/30 bg-brand/10 px-3 py-1 text-xs font-semibold text-brand"
      >
        {{ form.role }}
      </span>
    </header>

    <section class="mt-8 rounded-card border border-line bg-surface p-6">
      <h2 class="text-base font-semibold text-ink">Account details</h2>
      <p class="mt-1 text-sm text-muted">Update your personal information and workspace defaults.</p>

      <div class="mt-6 grid gap-5 sm:grid-cols-2">
        <label class="block">
          <span class="text-sm font-medium text-ink">Display name</span>
          <input
            v-model="form.name"
            type="text"
            class="mt-1.5 w-full rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
        </label>
        <label class="block">
          <span class="text-sm font-medium text-ink">Email</span>
          <input
            v-model="form.email"
            type="email"
            class="mt-1.5 w-full rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
        </label>
        <label class="block sm:col-span-2">
          <span class="text-sm font-medium text-ink">Timezone</span>
          <select
            v-model="form.timezone"
            class="mt-1.5 w-full rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30"
          >
            <option v-for="tz in timezones" :key="tz" :value="tz">{{ tz }}</option>
          </select>
        </label>
      </div>
    </section>

    <section class="mt-6 rounded-card border border-line bg-surface p-6">
      <h2 class="text-base font-semibold text-ink">Notifications</h2>
      <ul class="mt-4 divide-y divide-line">
        <li v-for="n in notifications" :key="n.id" class="flex items-center justify-between gap-4 py-4">
          <div>
            <p class="text-sm font-medium text-ink">{{ n.label }}</p>
            <p class="text-sm text-muted">{{ n.desc }}</p>
          </div>
          <button
            type="button"
            role="switch"
            :aria-checked="n.on"
            class="relative h-6 w-11 shrink-0 rounded-full transition-colors"
            :class="n.on ? 'bg-brand' : 'bg-ink/15'"
            @click="n.on = !n.on"
          >
            <span
              class="absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow transition-all"
              :class="n.on ? 'left-5.5' : 'left-0.5'"
            />
          </button>
        </li>
      </ul>
    </section>

    <div class="mt-6 flex items-center justify-end gap-3">
      <button type="button" class="rounded-full px-4 py-2 text-sm font-medium text-muted transition hover:text-ink">
        Cancel
      </button>
      <button
        type="button"
        class="rounded-full bg-brand px-5 py-2 text-sm font-semibold text-on-brand shadow-sm transition hover:opacity-90"
      >
        Save changes
      </button>
    </div>
  </div>
</template>
