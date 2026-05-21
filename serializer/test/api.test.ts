import { test, expect } from 'vitest';
import {
  type,
  oneOf,
  router,
  u53,
  f64,
  str,
  bool,
  list,
  opt,
  enumOf,
  flags,
  tuple,
  f64Array,
  clearRegistry,
  Writer,
  Reader,
} from '../plugin/index.ts';

test('type() — flat schema round-trip', () => {
  clearRegistry();
  const Ticker = type('Ticker', {
    symbol: str,
    last: f64,
    volume: f64,
  });

  type Ticker = typeof Ticker.$infer;

  const v: Ticker = { symbol: 'BTC-USD', last: 100.5, volume: 1234 };
  const bytes = Ticker.encode(v);
  expect(Ticker.decode(bytes)).toEqual(v);
});

test('type() — nested object via inline reference', () => {
  clearRegistry();
  const Price = type('Price', { value: f64, scale: u53 });
  const Order = type('Order', {
    id: u53,
    price: Price,
    qty: f64,
  });

  const v = { id: 42, price: { value: 100.5, scale: 2 }, qty: 0.5 };
  expect(Order.decode(Order.encode(v))).toEqual(v);
});

test('type() — anonymous (no name) still works', () => {
  clearRegistry();
  const Anon = type({ x: u53, y: f64 });
  const v = { x: 1, y: 2.5 };
  expect(Anon.decode(Anon.encode(v))).toEqual(v);
});

test('list, opt, enumOf, flags, tuple — combinators', () => {
  clearRegistry();
  const T = type('Combo', {
    tags: list(str),
    maybe: opt(f64),
    side: enumOf(['buy', 'sell'] as const),
    f: flags(['ioc', 'post_only'] as const),
    point: tuple(f64, f64),
  });

  const v = {
    tags: ['a', 'b'],
    maybe: 3.14,
    side: 'buy' as const,
    f: { ioc: true, post_only: false },
    point: [1, 2] as [number, number],
  };

  expect(T.decode(T.encode(v))).toEqual(v);

  const v2 = { ...v, maybe: undefined };
  expect(T.decode(T.encode(v2))).toEqual(v2);
});

test('type() — typed array field', () => {
  clearRegistry();
  const Signal = type('Signal', { name: str, samples: f64Array });
  const v = { name: 'x', samples: new Float64Array([1, 2, 3, 4]) };
  const back = Signal.decode(Signal.encode(v));
  expect(back.name).toBe('x');
  expect(back.samples).toBeInstanceOf(Float64Array);
  expect(Array.from(back.samples)).toEqual([1, 2, 3, 4]);
});

test('oneOf() — discriminated union', () => {
  clearRegistry();
  const Event = oneOf('Event', 'kind', {
    fill: { price: f64, qty: f64 },
    cancel: { reason: str },
  });

  const a = { kind: 'fill', price: 100, qty: 0.5 };
  const b = { kind: 'cancel', reason: 'user' };
  expect(Event.decode(Event.encode(a as never))).toEqual(a);
  expect(Event.decode(Event.encode(b as never))).toEqual(b);
});

test('encodeInto / decodeFrom — pooled writer hot path', () => {
  clearRegistry();
  const T = type('Pooled', { x: u53, y: f64 });
  const w = new Writer(256);

  const v = { x: 42, y: 3.14 };

  w.reset();
  T.encodeInto(v, w);
  const bytes = w.bytes();
  expect(bytes.length).toBeGreaterThan(0);

  const r = new Reader(bytes);
  expect(T.decodeFrom(r)).toEqual(v);
});

test('router() — framed multi-type dispatch', () => {
  clearRegistry();
  const A = type('A', { x: u53 });
  const B = type('B', { y: str });

  const proto = router(A, B);

  const bytesA = proto.encode({ x: 7 }, A);
  const bytesB = proto.encode({ y: 'hi' }, B);

  expect(proto.decode(bytesA)).toEqual({ x: 7 });
  expect(proto.decode(bytesB)).toEqual({ y: 'hi' });
});

test('typeof T.$infer — TS inference works at compile time', () => {
  clearRegistry();
  const Order = type('OrderInf', {
    id: u53,
    price: f64,
    side: enumOf(['buy', 'sell'] as const),
    active: bool,
    tags: list(str),
  });

  type Order = typeof Order.$infer;

  const v: Order = {
    id: 1,
    price: 100,
    side: 'buy',
    active: true,
    tags: ['a'],
  };
  expect(Order.decode(Order.encode(v))).toEqual(v);
});

test('codec id is deterministic by name', () => {
  clearRegistry();
  const A = type('Same', { x: u53 });
  clearRegistry();
  const B = type('Same', { y: f64 });
  expect(A.id).toBe(B.id);
});
