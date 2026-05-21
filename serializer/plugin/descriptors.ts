import type { Writer, Reader } from './io.ts';

export type PrimitiveKind =
  | 'u8' | 'u16' | 'u32'
  | 'i8' | 'i16' | 'i32'
  | 'u53' | 'i53'
  | 'u64' | 'i64'
  | 'f32' | 'f64'
  | 'bool'
  | 'str'
  | 'bytes';

export type TypedArrayKind = 'f32Array' | 'f64Array' | 'u8Array' | 'u16Array' | 'u32Array' | 'i32Array';

export interface PrimitiveSchema<K extends PrimitiveKind, T> {
  readonly kind: K;
  readonly __t?: T;
}

export interface TypedArraySchema<K extends TypedArrayKind, T> {
  readonly kind: K;
  readonly __t?: T;
}

export interface ArraySchema<E extends AnySchema = AnySchema> {
  readonly kind: 'array';
  readonly elem: E;
}

export interface OptionalSchema<E extends AnySchema = AnySchema> {
  readonly kind: 'optional';
  readonly elem: E;
}

export interface EnumSchema<L extends readonly string[] = readonly string[]> {
  readonly kind: 'enum';
  readonly values: L;
}

export interface BitsetSchema<L extends readonly string[] = readonly string[]> {
  readonly kind: 'bitset';
  readonly flags: L;
}

export interface TupleSchema<E extends readonly AnySchema[] = readonly AnySchema[]> {
  readonly kind: 'tuple';
  readonly elems: E;
}

export interface ObjectSchema<F extends Record<string, AnySchema> = Record<string, AnySchema>> {
  readonly kind: 'object';
  readonly name: string;
  readonly fields: F;
}

export interface UnionSchema<
  D extends string = string,
  V extends Record<string, ObjectSchema> = Record<string, ObjectSchema>,
> {
  readonly kind: 'union';
  readonly name: string;
  readonly discriminator: D;
  readonly variants: V;
}

export interface RefSchema<S extends ObjectSchema = ObjectSchema> {
  readonly kind: 'ref';
  readonly thunk: () => S;
}

export interface CodecSchema<T = unknown> {
  readonly kind: 'codec';
  readonly encode: (w: Writer, v: T) => void;
  readonly decode: (r: Reader) => T;
  readonly __t?: T;
}

export type AnySchema =
  | PrimitiveSchema<PrimitiveKind, unknown>
  | TypedArraySchema<TypedArrayKind, unknown>
  | ArraySchema
  | OptionalSchema
  | EnumSchema
  | BitsetSchema
  | TupleSchema
  | ObjectSchema
  | UnionSchema
  | RefSchema
  | CodecSchema;
