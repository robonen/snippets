import { test, expect } from 'vitest';
import {
  bool,
  clearRegistry,
  enumOf,
  f64,
  list,
  oneOf,
  str,
  type,
  u32,
  u53,
  u8,
} from '../plugin/index.ts';

/**
 * Decoded objects must share key order with the schema field order. Same
 * key order across instances is V8's strongest signal of a shared hidden
 * class, which is what the codec's single-object-literal pattern ensures.
 */
test('decoded objects share key order matching schema field order', () => {
  clearRegistry();
  const Order = type('ShapeOrder', {
    id: u53,
    price: f64,
    qty: f64,
    side: enumOf(['buy', 'sell'] as const),
    tags: list(str),
  });

  const expectedOrder = ['id', 'price', 'qty', 'side', 'tags'];

  const d1 = Order.decode(Order.encode({ id: 1, price: 100, qty: 0.5, side: 'buy', tags: ['a'] }));
  const d2 = Order.decode(Order.encode({ id: 999, price: 1e10, qty: 0, side: 'sell', tags: [] }));
  const d3 = Order.decode(
    Order.encode({ id: 2 ** 40, price: -1, qty: 1234, side: 'buy', tags: ['x', 'y', 'z'] }),
  );

  expect(Object.keys(d1)).toEqual(expectedOrder);
  expect(Object.keys(d2)).toEqual(expectedOrder);
  expect(Object.keys(d3)).toEqual(expectedOrder);
});

test('decoded value types are consistent across instances', () => {
  clearRegistry();
  const T = type('Types', { a: u32, b: f64, c: str, d: bool });

  const types = (o: Record<string, unknown>) =>
    Object.entries(o).map(([k, v]) => [k, typeof v]);

  const a = T.decode(T.encode({ a: 1, b: 1.5, c: 'a', d: true }));
  const b = T.decode(T.encode({ a: 0, b: 0, c: '', d: false }));
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
  const Price = type('SPrice', { value: f64, scale: u8 });
  const Order = type('SOrder', { id: u53, price: Price, qty: f64 });

  const v = { id: 1, price: { value: 100, scale: 2 }, qty: 1 };
  const d1 = Order.decode(Order.encode(v));
  const d2 = Order.decode(Order.encode({ ...v, id: 99 }));

  expect(Object.keys(d1)).toEqual(['id', 'price', 'qty']);
  expect(Object.keys(d2)).toEqual(['id', 'price', 'qty']);
  expect(Object.keys(d1.price)).toEqual(['value', 'scale']);
  expect(Object.keys(d2.price)).toEqual(['value', 'scale']);
});

test('union decoded objects place discriminator first', () => {
  clearRegistry();
  const Event = oneOf('SEvent', 'kind', {
    a: { x: u32 },
    b: { y: f64 },
  });

  const ea = Event.decode(Event.encode({ kind: 'a', x: 1 } as never)) as Record<string, unknown>;
  const eb = Event.decode(Event.encode({ kind: 'b', y: 2.5 } as never)) as Record<string, unknown>;
  expect(Object.keys(ea)[0]).toBe('kind');
  expect(Object.keys(eb)[0]).toBe('kind');
});
