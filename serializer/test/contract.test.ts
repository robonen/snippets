import { test, expect } from 'vitest';
import {
  clearRegistry,
  enumOf,
  f64,
  Serializable,
  type,
  u53,
} from '../plugin/index.ts';

test('class with [Serializable] static codec round-trips', () => {
  clearRegistry();

  class Order {
    static [Serializable] = type('OrderClass', {
      id: u53,
      price: f64,
      qty: f64,
      side: enumOf(['buy', 'sell'] as const),
    });
  }

  const codec = Order[Serializable]!;
  const v = { id: 42, price: 100.5, qty: 1.5, side: 'buy' as const };
  expect(codec.decode(codec.encode(v))).toEqual(v);
});

test('Symbol.serializable is shared across module boundaries via Symbol.for', () => {
  expect(Symbol.for('@perf/serializable')).toBe(Serializable);
});

test('codec.id is deterministic for the schema name', () => {
  clearRegistry();

  class A {
    static [Serializable] = type('SameName', { x: u53 });
  }
  const idA = A[Serializable]!.id;

  clearRegistry();
  class B {
    static [Serializable] = type('SameName', { y: f64 });
  }
  const idB = B[Serializable]!.id;

  expect(idA).toBe(idB);
});

test('class without [Serializable] has no codec', () => {
  class Empty {}
  expect((Empty as unknown as Record<symbol, unknown>)[Serializable]).toBeUndefined();
});
