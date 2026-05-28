// Build-time flag for stripping dev-only code (assertions, DevTools wiring).
// Resolved by the consumer's bundler via `define: { __SYNC_ENGINE_DEV__: ... }`.
// `typeof` keeps the reference safe when the constant is not defined — it
// folds to `false` (production-like default) without throwing ReferenceError.
declare const __SYNC_ENGINE_DEV__: boolean

export const DEV: boolean =
  typeof __SYNC_ENGINE_DEV__ !== 'undefined' ? __SYNC_ENGINE_DEV__ : false
