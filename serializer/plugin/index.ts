// ── Simplified façade (recommended) ────────────────────────────────────────
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

// ── Low-level API (advanced) ───────────────────────────────────────────────
export { Writer, Reader } from './io.ts';
export { s, defineSchema } from './schema.ts';
export type { SchemaBuilder } from './schema.ts';
export { Serializable } from './symbol.ts';
export {
  register,
  registerClass,
  serialize,
  deserialize,
  clearRegistry,
} from './register.ts';
export type { Codec } from './register.ts';
export type {
  AnySchema,
  ObjectSchema,
  UnionSchema,
  ArraySchema,
  OptionalSchema,
  EnumSchema,
  BitsetSchema,
  TupleSchema,
  RefSchema,
  CodecSchema,
  PrimitiveSchema,
  TypedArraySchema,
  PrimitiveKind,
  TypedArrayKind,
} from './descriptors.ts';
