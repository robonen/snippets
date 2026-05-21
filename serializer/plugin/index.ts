// ── Public API ─────────────────────────────────────────────────────────────
export {
  type,
  oneOf,
  router,
  u8, u16, u32, i8, i16, i32, u53, i53, u64, i64, f32, f64,
  bool, str, bytes,
  f32Array, f64Array, u8Array, u16Array, u32Array, i32Array,
  list, opt, enumOf, flags, tuple,
} from './api.ts';
export type { TypeCodec, InferType, Router } from './api.ts';

// ── Low-level (writer/reader for hot paths, framing primitives) ────────────
export { Writer, Reader } from './io.ts';

// ── Class contract ─────────────────────────────────────────────────────────
export { Serializable } from './symbol.ts';

// ── Test / AOT helpers ─────────────────────────────────────────────────────
export { clearRegistry, __registerPrecompiled } from './register.ts';
