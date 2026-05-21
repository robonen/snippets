import type {
  AnySchema,
  ArraySchema,
  BitsetSchema,
  CodecSchema,
  EnumSchema,
  ObjectSchema,
  OptionalSchema,
  PrimitiveSchema,
  RefSchema,
  TupleSchema,
  TypedArraySchema,
  UnionSchema,
} from './descriptors.ts';
import type { Reader, Writer } from './io.ts';

type Prim<K extends string, T> = { readonly kind: K; readonly __t?: T };

function p<K extends string, T>(kind: K): Prim<K, T> {
  return Object.freeze({ kind }) as Prim<K, T>;
}

export const s = Object.freeze({
  u8: p<'u8', number>('u8') as PrimitiveSchema<'u8', number>,
  u16: p<'u16', number>('u16') as PrimitiveSchema<'u16', number>,
  u32: p<'u32', number>('u32') as PrimitiveSchema<'u32', number>,
  i8: p<'i8', number>('i8') as PrimitiveSchema<'i8', number>,
  i16: p<'i16', number>('i16') as PrimitiveSchema<'i16', number>,
  i32: p<'i32', number>('i32') as PrimitiveSchema<'i32', number>,
  u53: p<'u53', number>('u53') as PrimitiveSchema<'u53', number>,
  i53: p<'i53', number>('i53') as PrimitiveSchema<'i53', number>,
  u64: p<'u64', bigint>('u64') as PrimitiveSchema<'u64', bigint>,
  i64: p<'i64', bigint>('i64') as PrimitiveSchema<'i64', bigint>,
  f32: p<'f32', number>('f32') as PrimitiveSchema<'f32', number>,
  f64: p<'f64', number>('f64') as PrimitiveSchema<'f64', number>,
  bool: p<'bool', boolean>('bool') as PrimitiveSchema<'bool', boolean>,
  str: p<'str', string>('str') as PrimitiveSchema<'str', string>,
  bytes: p<'bytes', Uint8Array>('bytes') as PrimitiveSchema<'bytes', Uint8Array>,

  f32Array: p<'f32Array', Float32Array>('f32Array') as TypedArraySchema<'f32Array', Float32Array>,
  f64Array: p<'f64Array', Float64Array>('f64Array') as TypedArraySchema<'f64Array', Float64Array>,
  u8Array: p<'u8Array', Uint8Array>('u8Array') as TypedArraySchema<'u8Array', Uint8Array>,
  u16Array: p<'u16Array', Uint16Array>('u16Array') as TypedArraySchema<'u16Array', Uint16Array>,
  u32Array: p<'u32Array', Uint32Array>('u32Array') as TypedArraySchema<'u32Array', Uint32Array>,
  i32Array: p<'i32Array', Int32Array>('i32Array') as TypedArraySchema<'i32Array', Int32Array>,

  array<E extends AnySchema>(elem: E): ArraySchema<E> {
    return { kind: 'array', elem };
  },

  optional<E extends AnySchema>(elem: E): OptionalSchema<E> {
    return { kind: 'optional', elem };
  },

  enum<L extends readonly string[]>(values: L): EnumSchema<L> {
    if (values.length === 0) throw new Error('enum requires at least one value');
    if (values.length > 256) throw new Error('enum supports up to 256 values');
    return { kind: 'enum', values };
  },

  bitset<L extends readonly string[]>(flags: L): BitsetSchema<L> {
    if (flags.length === 0) throw new Error('bitset requires at least one flag');
    if (flags.length > 64) throw new Error('bitset supports up to 64 flags');
    return { kind: 'bitset', flags };
  },

  tuple<E extends readonly AnySchema[]>(...elems: E): TupleSchema<E> {
    return { kind: 'tuple', elems };
  },

  union<D extends string, V extends Record<string, Record<string, AnySchema>>>(
    name: string,
    discriminator: D,
    variants: V,
  ): UnionSchema<D, { [K in keyof V]: ObjectSchema<V[K]> }> {
    const variantSchemas = {} as Record<string, ObjectSchema>;
    let i = 0;
    for (const k of Object.keys(variants)) {
      variantSchemas[k] = {
        kind: 'object',
        name: `${name}::${k}`,
        fields: variants[k]!,
      };
      i++;
      if (i > 256) throw new Error('union supports up to 256 variants');
    }
    return {
      kind: 'union',
      name,
      discriminator,
      variants: variantSchemas as { [K in keyof V]: ObjectSchema<V[K]> },
    };
  },

  ref<S extends ObjectSchema>(thunk: () => S): RefSchema<S> {
    return { kind: 'ref', thunk };
  },

  codec<T>(impl: { encode: (w: Writer, v: T) => void; decode: (r: Reader) => T }): CodecSchema<T> {
    return { kind: 'codec', encode: impl.encode, decode: impl.decode };
  },
});

export type SchemaBuilder = typeof s;

export function defineSchema<F extends Record<string, AnySchema>>(
  name: string,
  build: (s: SchemaBuilder) => F,
): ObjectSchema<F> {
  return { kind: 'object', name, fields: build(s) };
}
