import { markRaw, shallowRef, type Component } from 'vue'
import { feature } from '#feature'

export interface AppRoute {
  path: string
  label: string
  component: () => Promise<{ default: Component }>
}

// Pages gated on build-time feature flags via the `feature()` macro (typed by the generated
// `.vite-layers/features.d.ts`). A disabled page's dynamic import() is statically dead — its branch
// folds away and the chunk is never emitted (per-brand dead-code elimination), in dev and build alike.
export const routes: AppRoute[] = [
  { path: '/', label: 'Overview', component: () => import('@/pages/Landing.vue') },
  { path: '/profile', label: 'Profile', component: () => import('@/pages/Profile.vue') },
  ...(feature('billing')
    ? [{ path: '/billing', label: 'Billing', component: () => import('@/pages/Billing.vue') }]
    : []),
]

const current = shallowRef<Component | null>(null)
const currentPath = shallowRef('/')

async function navigate() {
  const path = location.hash.slice(1) || '/'
  const route = routes.find(r => r.path === path) ?? routes[0]!
  currentPath.value = route.path
  current.value = markRaw((await route.component()).default)
}

let started = false

/** Minimal hash router shared by every brand — keeps the demo dependency-free. */
export function useRoute() {
  if (!started) {
    started = true
    window.addEventListener('hashchange', navigate)
    void navigate()
  }
  return { current, currentPath }
}
