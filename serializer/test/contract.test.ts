import { test, expect } from 'vitest';
import {
  clearRegistry,
  defineSchema,
  deserialize,
  registerClass,
  Serializable,
  serialize,
} from '../plugin/index.ts';

test('class with [Serializable] static schema registers and round-trips', () => {
  clearRegistry();

  class Order {
    id!: number;
    price!: number;
    qty!: number;
    side!: 'buy' | 'sell';

    static [Serializable] = defineSchema('OrderClass', (s) => ({
      id: s.u53,
      price: s.f64,
      qty: s.f64,
      side: s.enum(['buy', 'sell'] as const),
    }));
  }

  const codec = registerClass(Order);

  const v = { id: 42, price: 100.5, qty: 1.5, side: 'buy' as const };
  const bytes = serialize(v, codec);
  const decoded = deserialize<typeof v>(bytes);
  expect(decoded).toEqual(v);
});

test('registerClass caches by constructor', () => {
  clearRegistry();

  class A {
    static [Serializable] = defineSchema('AClass', (s) => ({ x: s.u8 }));
  }
  const c1 = registerClass(A);
  const c2 = registerClass(A);
  expect(c1).toBe(c2);
});

test('registerClass throws for class missing [Serializable]', () => {
  clearRegistry();

  class B {}

  expect(() => registerClass(B)).toThrow(/\[Serializable\] schema/);
});

test('Symbol.serializable is shared across module boundaries via Symbol.for', () => {
  const looked = Symbol.for('@perf/serializable');
  expect(looked).toBe(Serializable);
});

test('codec.id is deterministic for the schema name', () => {
  clearRegistry();
  const A = defineSchema('SameName', (s) => ({ x: s.u8 }));

  clearRegistry();
  const codecA = registerClass(
    class extends Object {
      static [Serializable] = A;
    },
  );

  clearRegistry();
  const codecB = registerClass(
    class extends Object {
      static [Serializable] = A;
    },
  );

  expect(codecA.id).toBe(codecB.id);
});
