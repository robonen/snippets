import { createApp, defineAsyncComponent, h, shallowRef, type Component } from 'vue'
const AppHeader = defineAsyncComponent(() => import('@/components/AppHeader.vue'))

// `__FEATURES__` is typed by the generated `.vite-layers/features.d.ts` — no manual `declare` needed.

// Pages are gated on build-time feature flags: a disabled page's dynamic import() is
// statically dead, so its chunk is never emitted (per-brand dead-code elimination).
const routes = [
  { path: '/', component: () => import('@/pages/Home.vue') },
  ...(__FEATURES__.billing
    ? [{ path: '/billing', component: () => import('@/pages/Billing.vue') }]
    : []),
]

// A tiny hash router so `routes` (and thus the gated import) is actually reachable.
const current = shallowRef<Component | null>(null)
async function navigate() {
  const path = location.hash.slice(1) || '/'
  const route = routes.find(r => r.path === path) ?? routes[0]
  current.value = route ? ((await route.component()).default as Component) : null
}
window.addEventListener('hashchange', navigate)
void navigate()

createApp({
  render: () => h('div', [h(AppHeader), current.value ? h(current.value) : null]),
}).mount('#app')
