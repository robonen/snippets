/**
 * Simplified façade over the schema + codec system.
 *
 * 90% of usage:
 *   const Order = type('Order', { id: u53, price: f64, side: enumOf(['buy','sell'] as const) });
 *   type Order = typeof Order.$infer;
 *   const bytes = Order.encode(order);
 *   const back = Order.decode(bytes);
 *
 * Hot path:
 *   const w = new Writer(1024);
 *   Order.encodeInto(order, w);
 *   socket.send(w.bytes());
 *
 * AOT (compile-only) build: the transformer detects `type(...)` calls and
 * replaces them with precomputed codec literals; the function below never runs
 * in production. See codegen-plugin/.
 */

import type {
  AnySchema,
  ArraySchema,
  BitsetSchema,
  EnumSchema,
  ObjectSchema,
  OptionalSchema,
  TupleSchema,
  UnionSchema,
} from './descriptors.ts';
import type { Reader, Writer } from './io.ts';
import { Writer as WriterImpl } from './io.ts';
import { Reader as ReaderImpl } from './io.ts';
import { defineSchema, s } from './schema.ts';
import { register as registerSchema } from './register.ts';

// ── Primitive markers (re-export of the descriptor singletons) ─────────────

export const u8 = s.u8;
export const u16 = s.u16;
export const u32 = s.u32;
export const i8 = s.i8;
export const i16 = s.i16;
export const i32 = s.i32;
export const u53 = s.u53;
export const i53 = s.i53;
export const u64 = s.u64;
export const i64 = s.i64;
export const f32 = s.f32;
export const f64 = s.f64;
export const bool = s.bool;
export const str = s.str;
export const bytes = s.bytes;

export const f32Array = s.f32Array;
export const f64Array = s.f64Array;
export const u8Array = s.u8Array;
export const u16Array = s.u16Array;
export const u32Array = s.u32Array;
export const i32Array = s.i32Array;

// ── Combinators ────────────────────────────────────────────────────────────

export function list<E extends AnySchema>(elem: E): ArraySchema<E> {
  return s.array(elem);
}

export function opt<E extends AnySchema>(elem: E): OptionalSchema<E> {
  return s.optional(elem);
}

export function enumOf<L extends readonly string[]>(values: L): EnumSchema<L> {
  return s.enum(values);
}

export function flags<L extends readonly string[]>(names: L): BitsetSchema<L> {
  return s.bitset(names);
}

export function tuple<E extends readonly AnySchema[]>(...elems: E): TupleSchema<E> {
  return s.tuple(...elems);
}

// ── TypeCodec: schema + runtime API in one value ───────────────────────────

/**
 * A `TypeCodec<T>` is BOTH:
 *   - an `ObjectSchema` (so it can be used as a field in another `type(...)`)
 *   - a runtime codec with `encode`/`decode` methods
 *
 * Plus a phantom `$infer` field for `typeof T.$infer` extraction.
 */
export interface TypeCodec<T> extends ObjectSchema {
  readonly id: number;

  /** One-shot encode. Allocates a Writer; for hot paths prefer `encodeInto`. */
  encode(value: T): Uint8Array;
  encode(value: T, into: Writer): Uint8Array;

  /** One-shot decode from a complete byte buffer. */
  decode(bytes: Uint8Array): T;

  /** Hot path: writes directly into a pre-allocated, pooled Writer. */
  encodeInto(value: T, w: Writer): void;

  /** Hot path: reads from a positioned Reader (does not advance past end). */
  decodeFrom(r: Reader): T;

  /** Phantom: `typeof Codec.$infer` gives the inferred TS type. Never read at runtime. */
  readonly $infer: T;
}

// ── Type-level inference ───────────────────────────────────────────────────

type InferPrim<K> =
  K extends 'u8' | 'u16' | 'u32' | 'i8' | 'i16' | 'i32' | 'u53' | 'i53' | 'f32' | 'f64' ? number
  : K extends 'u64' | 'i64' ? bigint
  : K extends 'bool' ? boolean
  : K extends 'str' ? string
  : K extends 'bytes' ? Uint8Array
  : K extends 'f32Array' ? Float32Array
  : K extends 'f64Array' ? Float64Array
  : K extends 'u8Array' ? Uint8Array
  : K extends 'u16Array' ? Uint16Array
  : K extends 'u32Array' ? Uint32Array
  : K extends 'i32Array' ? Int32Array
  : never;

export type InferType<S> =
  S extends { $infer: infer T } ? T
  : S extends ArraySchema<infer E> ? InferType<E>[]
  : S extends OptionalSchema<infer E> ? InferType<E> | undefined
  : S extends EnumSchema<infer L> ? L[number]
  : S extends BitsetSchema<infer L> ? { [K in L[number]]: boolean }
  : S extends TupleSchema<infer E> ? { -readonly [K in keyof E]: InferType<E[K]> }
  : S extends UnionSchema<infer D, infer V>
    ? V extends Record<string, ObjectSchema>
      ? {
          [K in keyof V & string]: V[K] extends ObjectSchema<infer F>
            ? { [P in D]: K } & { [Pk in keyof F]: InferType<F[Pk]> }
            : never
        }[keyof V & string]
      : never
  : S extends ObjectSchema<infer F> ? { [K in keyof F]: InferType<F[K]> }
  : S extends { kind: infer K } ? InferPrim<K>
  : unknown;

type Fields = Record<string, AnySchema>;

// ── Anonymous naming ───────────────────────────────────────────────────────

let __anonCounter = 0;
function anonName(prefix = 'Anon'): string {
  return `__${prefix}_${++__anonCounter}`;
}

// ── type() ────────────────────────────────────────────────────────────────

/**
 * Define a serializable type.
 *
 * The `name` is REQUIRED for wire-stable types (anything sent over a network
 * or stored to disk) because the schema ID is a hash of the name and the ID
 * appears in the wire frame. Without a name we generate one, which is fine
 * for transient/in-process use only.
 */
export function type<F extends Fields>(fields: F): TypeCodec<{ [K in keyof F]: InferType<F[K]> }>;
export function type<F extends Fields>(name: string, fields: F): TypeCodec<{ [K in keyof F]: InferType<F[K]> }>;
export function type(nameOrFields: string | Fields, maybeFields?: Fields): TypeCodec<unknown> {
  const isNamed = typeof nameOrFields === 'string';
  const name = isNamed ? nameOrFields : anonName('Type');
  const fields = isNamed ? maybeFields! : nameOrFields;

  const schema = defineSchema(name, () => fields);
  const codec = registerSchema(schema);

  const enc = codec.encode;
  const dec = codec.decode;

  function encode(value: unknown, into?: Writer): Uint8Array {
    if (into) {
      enc(into, value);
      return into.bytes();
    }
    const tmp = new WriterImpl();
    enc(tmp, value);
    return tmp.bytesCopy();
  }

  function decode(b: Uint8Array): unknown {
    const r = new ReaderImpl(b);
    return dec(r);
  }

  function encodeInto(value: unknown, w: Writer): void {
    enc(w, value);
  }

  function decodeFrom(r: Reader): unknown {
    return dec(r);
  }

  return {
    kind: 'object',
    name,
    fields: schema.fields,
    id: codec.id,
    encode,
    decode,
    encodeInto,
    decodeFrom,
    $infer: undefined as unknown,
  } as TypeCodec<unknown>;
}

// ── oneOf() — discriminated union ──────────────────────────────────────────

/**
 * Discriminated union. Each variant is a field map; at runtime the variant is
 * identified by a `discriminator` key on the value.
 *
 *   const Event = oneOf('kind', {
 *     fill:   { price: f64, qty: f64 },
 *     cancel: { reason: str },
 *   });
 *   //  fill   → { kind: 'fill', price, qty }
 *   //  cancel → { kind: 'cancel', reason }
 */
// Less-precise but stable inference for unions; user can narrow via `as`.
export function oneOf<D extends string, V extends Record<string, Fields>>(
  discriminator: D,
  variants: V,
): TypeCodec<{ [P in D]: keyof V & string } & Record<string, unknown>>;
export function oneOf<D extends string, V extends Record<string, Fields>>(
  name: string,
  discriminator: D,
  variants: V,
): TypeCodec<{ [P in D]: keyof V & string } & Record<string, unknown>>;
export function oneOf(
  arg1: string,
  arg2: string | Record<string, Fields>,
  arg3?: Record<string, Fields>,
): TypeCodec<unknown> {
  const isNamed = arg3 !== undefined;
  const name = isNamed ? arg1 : anonName('Union');
  const discriminator = (isNamed ? arg2 : arg1) as string;
  const variants = (isNamed ? arg3! : arg2) as Record<string, Fields>;

  const schema = s.union(name, discriminator, variants);
  const codec = registerSchema(schema);

  const enc = codec.encode;
  const dec = codec.decode;

  function encode(value: unknown, into?: Writer): Uint8Array {
    if (into) {
      enc(into, value);
      return into.bytes();
    }
    const tmp = new WriterImpl();
    enc(tmp, value);
    return tmp.bytesCopy();
  }

  function decode(b: Uint8Array): unknown {
    const r = new ReaderImpl(b);
    return dec(r);
  }

  // Union doesn't satisfy ObjectSchema directly — it's UnionSchema. We expose
  // the runtime API on the same value but the descriptor shape is union.
  // For use as a field, accept it via AnySchema (TypeScript inference handles it).
  return {
    kind: 'union',
    name,
    discriminator,
    variants: (schema as unknown as { variants: unknown }).variants,
    fields: {}, // unused for unions
    id: codec.id,
    encode,
    decode,
    encodeInto(value: unknown, w: Writer) { enc(w, value); },
    decodeFrom(r: Reader) { return dec(r); },
    $infer: undefined as unknown,
  } as unknown as TypeCodec<unknown>;
}

// ── Router: framed multi-type dispatch ─────────────────────────────────────

export interface Router {
  /** Encode with the 2-byte schema-ID frame. */
  encode<T>(value: T, codec: TypeCodec<T>): Uint8Array;
  encode<T>(value: T, codec: TypeCodec<T>, into: Writer): Uint8Array;
  /** Decode a framed message, dispatching by schema ID. */
  decode(bytes: Uint8Array): unknown;
}

/**
 * Build a router for framed multi-message protocols. The router prepends a
 * 2-byte schema ID on encode and dispatches on it during decode.
 */
export function router(...codecs: TypeCodec<unknown>[]): Router {
  const byId = new Map<number, TypeCodec<unknown>>();
  for (const c of codecs) byId.set(c.id, c);

  return {
    encode<T>(value: T, codec: TypeCodec<T>, into?: Writer): Uint8Array {
      if (into) {
        into.u16(codec.id);
        codec.encodeInto(value, into);
        return into.bytes();
      }
      const w = new WriterImpl();
      w.u16(codec.id);
      codec.encodeInto(value, w);
      return w.bytesCopy();
    },
    decode(bytes: Uint8Array): unknown {
      const r = new ReaderImpl(bytes);
      const id = r.u16();
      const codec = byId.get(id);
      if (!codec) throw new Error(`Router: unknown schema ID 0x${id.toString(16)}`);
      return codec.decodeFrom(r);
    },
  };
}

// ── Writer/Reader re-exports for hot path users ────────────────────────────

export { Writer, Reader } from './io.ts';
