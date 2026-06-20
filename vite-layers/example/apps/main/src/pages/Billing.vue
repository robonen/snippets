<script setup lang="ts">
// BILLING_PAGE_HEAVY_MARKER — grep the build output for this string: it appears in Acme's and
// Aurora's bundles (billing: true) but NOT in Northwind's, whose `billing: false` makes the gated
// import() in router.ts statically dead, so this whole chunk is dead-code-eliminated.
const invoices = [
  { id: 'INV-2048', date: 'Jun 01, 2026', amount: '$240.00', status: 'Paid' },
  { id: 'INV-2031', date: 'May 01, 2026', amount: '$240.00', status: 'Paid' },
  { id: 'INV-2014', date: 'Apr 01, 2026', amount: '$180.00', status: 'Paid' },
]

const usage = [
  { label: 'Seats', used: 18, total: 25 },
  { label: 'Projects', used: 42, total: 50 },
  { label: 'Storage', used: 312, total: 500, unit: 'GB' },
]
</script>

<template>
  <div class="mx-auto max-w-3xl px-6 py-12">
    <h1 class="text-2xl font-semibold tracking-tight text-ink">Billing</h1>
    <p class="mt-1 text-sm text-muted">Manage your plan, usage, and invoices.</p>

    <section class="mt-8 overflow-hidden rounded-card border border-line bg-surface">
      <div class="flex items-center justify-between gap-4 bg-linear-to-br from-brand to-accent p-6 text-on-brand">
        <div>
          <p class="text-sm/none opacity-80">Current plan</p>
          <p class="mt-1 text-2xl font-semibold">Team — $240/mo</p>
        </div>
        <button class="rounded-full bg-on-brand/15 px-4 py-2 text-sm font-semibold backdrop-blur transition hover:bg-on-brand/25">
          Upgrade
        </button>
      </div>

      <div class="grid gap-6 p-6 sm:grid-cols-3">
        <div v-for="u in usage" :key="u.label">
          <div class="flex items-baseline justify-between">
            <span class="text-sm font-medium text-ink">{{ u.label }}</span>
            <span class="text-xs text-muted">{{ u.used }}{{ u.unit ? '' : '' }} / {{ u.total }} {{ u.unit }}</span>
          </div>
          <div class="mt-2 h-2 overflow-hidden rounded-full bg-ink/10">
            <div class="h-full rounded-full bg-brand" :style="{ width: `${(u.used / u.total) * 100}%` }" />
          </div>
        </div>
      </div>
    </section>

    <section class="mt-6 rounded-card border border-line bg-surface">
      <h2 class="border-b border-line px-6 py-4 text-base font-semibold text-ink">Invoices</h2>
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left text-muted">
            <th class="px-6 py-3 font-medium">Invoice</th>
            <th class="px-6 py-3 font-medium">Date</th>
            <th class="px-6 py-3 font-medium">Amount</th>
            <th class="px-6 py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-line">
          <tr v-for="inv in invoices" :key="inv.id">
            <td class="px-6 py-3 font-medium text-ink">{{ inv.id }}</td>
            <td class="px-6 py-3 text-muted">{{ inv.date }}</td>
            <td class="px-6 py-3 text-ink">{{ inv.amount }}</td>
            <td class="px-6 py-3">
              <span class="rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-semibold text-brand">{{ inv.status }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>
