/**
 * Public entry for the build-time feature macro. Import it as `#feature` (vite-layers
 * auto-registers the alias and the tsconfig `paths` entry) or as `vite-layers/feature`:
 *
 * ```ts
 * import { feature } from '#feature'
 *
 * const routes = [
 *   { path: '/', component: () => import('@/pages/Home') },
 *   feature('billing') && { path: '/billing', component: () => import('@/pages/Billing') },
 * ].filter(Boolean)
 * ```
 *
 * `feature('billing')` is replaced by the flag's literal value at compile time — **identically in
 * dev and build** — so a disabled branch (and any `import()` inside it) is statically dead and is
 * dropped from the bundle. The rules below are enforced: a violation fails the build (in dev and
 * build alike), it never silently ships.
 *
 *  - the argument must be a string literal: `feature('billing')`, never `feature(name)`;
 *  - call it directly — no aliasing (`const f = feature`), destructuring, or passing it as a value;
 *  - the key must exist in the merged `features` (a typo is also a TypeScript error).
 *
 * Nested flags are addressed with a dotted key: `feature('payments.stripe')`.
 *
 * This module has no runtime: every call is compiled away. The stub below only throws if a call
 * survives — i.e. the vite-layers plugin did not run on this module.
 */

/** Augmented by the generated `.vite-layers/features.d.ts` with the project's flags + literal types. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface LayerFeatures {}

type FeatureKey = [keyof LayerFeatures] extends [never] ? string : keyof LayerFeatures

export function feature<K extends FeatureKey>(
  key: K,
): K extends keyof LayerFeatures ? LayerFeatures[K] : unknown
export function feature(key: string): unknown {
  throw new Error(
    `vite-layers: feature(${JSON.stringify(key)}) was not compiled away. ` +
      'Make sure the vite-layers plugin is active and call feature() directly with a string-literal key.',
  )
}
