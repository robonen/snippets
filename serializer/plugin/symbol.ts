/**
 * The well-known symbol carrying a schema descriptor on a constructor.
 *
 * Registered via `Symbol.for` so multiple module copies (workers, dual builds)
 * share identity.
 */
declare const SerializableBrand: unique symbol;

export const Serializable = Symbol.for('@perf/serializable') as typeof SerializableBrand;
export type SerializableKey = typeof SerializableBrand;
