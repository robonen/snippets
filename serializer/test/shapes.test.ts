import { test, expect } from 'vitest';
import {
  clearRegistry,
  defineSchema,
  deserialize,
  register,
  s,
  serialize,
} from '../plugin/index.ts';

/**
 * Decoded objects must share key order with the schema field order. Same
 * key order across instances is V8's strongest signal of a shared hidden
 * class, which is what the codec's single-object-literal pattern ensures.
 */
test('decoded objects share key order matching schema field order', () => {
  clearRegistry();
  const Order = defineSchema('ShapeOrder', (s) => ({
    id: s.u53,
    price: s.f64,
    qty: s.f64,
    side: s.enum(['buy', 'sell'] as const),
    tags: s.array(s.str),
  }));
  const codec = register(Order);

  const expectedOrder = ['id', 'price', 'qty', 'side', 'tags'];

  const decoded1 = deserialize<Record<string, unknown>>(
    serialize({ id: 1, price: 100, qty: 0.5, side: 'buy', tags: ['a'] }, codec),
  );
  const decoded2 = deserialize<Record<string, unknown>>(
    serialize({ id: 999, price: 1e10, qty: 0, side: 'sell', tags: [] }, codec),
  );
  const decoded3 = deserialize<Record<string, unknown>>(
    serialize({ id: 2 ** 40, price: -1, qty: 1234, side: 'buy', tags: ['x', 'y', 'z'] }, codec),
  );

  expect(Object.keys(decoded1)).toEqual(expectedOrder);
  expect(Object.keys(decoded2)).toEqual(expectedOrder);
  expect(Object.keys(decoded3)).toEqual(expectedOrder);
});

test('decoded value types are consistent across instances', () => {
  clearRegistry();
  const T = defineSchema('Types', (s) => ({
    a: s.u32,
    b: s.f64,
    c: s.str,
    d: s.bool,
  }));
  const codec = register(T);

  const types = (o: Record<string, unknown>) =>
    Object.entries(o).map(([k, v]) => [k, typeof v]);

  const a = deserialize<Record<string, unknown>>(
    serialize({ a: 1, b: 1.5, c: 'a', d: true }, codec),
  );
  const b = deserialize<Record<string, unknown>>(
    serialize({ a: 0, b: 0, c: '', d: false }, codec),
  );
  expect(types(a)).toEqual(types(b));
  expect(types(a)).toEqual([
    ['a', 'number'],
    ['b', 'number'],
    ['c', 'string'],
    ['d', 'boolean'],
  ]);
});

test('nested object key order is stable', () => {
  clearRegistry();
  const Price = defineSchema('SPrice', (s) => ({ value: s.f64, scale: s.u8 }));
  register(Price);
  const Order = defineSchema('SOrder', (s) => ({
    id: s.u53,
    price: Price,
    qty: s.f64,
  }));
  const codec = register(Order);

  const v = { id: 1, price: { value: 100, scale: 2 }, qty: 1 };
  const d1 = deserialize<Record<string, unknown>>(serialize(v, codec));
  const d2 = deserialize<Record<string, unknown>>(serialize({ ...v, id: 99 }, codec));

  expect(Object.keys(d1)).toEqual(['id', 'price', 'qty']);
  expect(Object.keys(d2)).toEqual(['id', 'price', 'qty']);
  expect(Object.keys(d1.price as Record<string, unknown>)).toEqual(['value', 'scale']);
  expect(Object.keys(d2.price as Record<string, unknown>)).toEqual(['value', 'scale']);
});

test('union decoded objects place discriminator first', () => {
  clearRegistry();
  const Event = s.union('SEvent', 'kind', {
    a: { x: s.u32 },
    b: { y: s.f64 },
  });
  const codec = register(Event);

  const ea = deserialize<Record<string, unknown>>(serialize({ kind: 'a', x: 1 }, codec));
  const eb = deserialize<Record<string, unknown>>(serialize({ kind: 'b', y: 2.5 }, codec));
  expect(Object.keys(ea)[0]).toBe('kind');
  expect(Object.keys(eb)[0]).toBe('kind');
});
