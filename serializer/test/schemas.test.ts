import { test, expect } from 'vitest';
import {
  bool,
  bytes,
  clearRegistry,
  enumOf,
  f64,
  f64Array,
  flags,
  i64,
  list,
  oneOf,
  opt,
  router,
  str,
  tuple,
  type,
  u32,
  u53,
  u64,
  u8,
} from '../plugin/index.ts';

function fresh() {
  clearRegistry();
}

test('flat object with mixed primitives', () => {
  fresh();
  const Ticker = type('Ticker', {
    symbol: str,
    last: f64,
    volume: f64,
    count: u32,
  });

  const value = { symbol: 'BTC-USD', last: 45123.45, volume: 1234.5678, count: 99999 };
  expect(Ticker.decode(Ticker.encode(value))).toEqual(value);
});

test('array of primitives', () => {
  fresh();
  const Tags = type('Tags', {
    items: list(str),
    counts: list(u32),
  });
  const v = { items: ['a', 'b', 'hello'], counts: [1, 2, 3, 4, 5] };
  expect(Tags.decode(Tags.encode(v))).toEqual(v);
});

test('nested object via inline reference', () => {
  fresh();
  const Price = type('Price', { value: f64, scale: u8 });
  const Order = type('Order', { id: u53, price: Price, qty: f64 });
  const v = { id: 12345, price: { value: 100.5, scale: 2 }, qty: 1.5 };
  expect(Order.decode(Order.encode(v))).toEqual(v);
});

test('optional fields', () => {
  fresh();
  const Maybe = type('Maybe', {
    a: opt(str),
    b: opt(f64),
  });

  expect(Maybe.decode(Maybe.encode({ a: 'hi', b: 3.14 }))).toEqual({ a: 'hi', b: 3.14 });
  expect(Maybe.decode(Maybe.encode({ a: undefined, b: 1 }))).toEqual({ a: undefined, b: 1 });
  expect(Maybe.decode(Maybe.encode({ a: undefined, b: undefined }))).toEqual({
    a: undefined,
    b: undefined,
  });
});

test('enum field', () => {
  fresh();
  const Sided = type('SidedOrder', {
    side: enumOf(['buy', 'sell'] as const),
    qty: f64,
  });
  for (const side of ['buy', 'sell'] as const) {
    const v = { side, qty: 1 };
    expect(Sided.decode(Sided.encode(v))).toEqual(v);
  }
});

test('bitset field (≤8 flags)', () => {
  fresh();
  const Flags = type('Flags', {
    flags: flags(['ioc', 'post_only', 'reduce_only'] as const),
  });
  const v = { flags: { ioc: true, post_only: false, reduce_only: true } };
  expect(Flags.decode(Flags.encode(v))).toEqual(v);
});

test('bitset field (>32 flags uses bigint)', () => {
  fresh();
  const flagNames = Array.from({ length: 40 }, (_, i) => `f${i}`) as readonly string[];
  const FlagsBig = type('FlagsBig', {
    flags: flags(flagNames as readonly [string, ...string[]]),
  });

  const flagsValue: Record<string, boolean> = {};
  for (let i = 0; i < 40; i++) flagsValue[`f${i}`] = i % 3 === 0;
  const v = { flags: flagsValue };
  expect(FlagsBig.decode(FlagsBig.encode(v))).toEqual(v);
});

test('tuple field', () => {
  fresh();
  const Point = type('Point3D', {
    name: str,
    coord: tuple(f64, f64, f64),
  });
  const v = { name: 'p', coord: [1.5, 2.5, 3.5] as [number, number, number] };
  expect(Point.decode(Point.encode(v))).toEqual(v);
});

test('array of nested objects', () => {
  fresh();
  const Level = type('Level', { price: f64, qty: f64 });
  const Book = type('Book', {
    bids: list(Level),
    asks: list(Level),
  });
  const v = {
    bids: [{ price: 100, qty: 1 }, { price: 99, qty: 2 }],
    asks: [{ price: 101, qty: 0.5 }, { price: 102, qty: 1.5 }, { price: 103, qty: 0.1 }],
  };
  expect(Book.decode(Book.encode(v))).toEqual(v);
});

test('union with discriminator', () => {
  fresh();
  const Event = oneOf('Event', 'kind', {
    fill: { price: f64, qty: f64 },
    cancel: { reason: str },
    expire: { at: u53 },
  });

  const samples = [
    { kind: 'fill', price: 100, qty: 0.5 },
    { kind: 'cancel', reason: 'user' },
    { kind: 'expire', at: 1700000000 },
  ];
  for (const v of samples) {
    expect(Event.decode(Event.encode(v as never))).toEqual(v);
  }
});

test('typed array (f64Array) round-trip', () => {
  fresh();
  const Signal = type('Signal', {
    name: str,
    samples: f64Array,
  });

  const samples = new Float64Array([1.1, 2.2, 3.3, 4.4, 5.5]);
  const v = { name: 'sig', samples };
  const decoded = Signal.decode(Signal.encode(v));
  expect(decoded.name).toBe('sig');
  expect(decoded.samples).toBeInstanceOf(Float64Array);
  expect(decoded.samples.length).toBe(5);
  for (let i = 0; i < 5; i++) expect(decoded.samples[i]).toBe(samples[i]);
});

test('bigint u64/i64 round-trip', () => {
  fresh();
  const Big = type('Big', { u: u64, i: i64 });
  const v = { u: 1n << 50n, i: -(1n << 50n) };
  expect(Big.decode(Big.encode(v))).toEqual(v);
});

test('bytes field', () => {
  fresh();
  const Blob = type('Blob', { data: bytes });
  const data = new Uint8Array([0, 1, 2, 3, 254, 255]);
  const decoded = Blob.decode(Blob.encode({ data }));
  expect(Array.from(decoded.data)).toEqual(Array.from(data));
});

test('bool field round-trip', () => {
  fresh();
  const T = type('Bools', { a: bool, b: bool });
  expect(T.decode(T.encode({ a: true, b: false }))).toEqual({ a: true, b: false });
});

test('router prepends 2-byte schema ID frame', () => {
  fresh();
  const Sch = type('Sch', { x: u8 });
  const proto = router(Sch);
  const bytes = proto.encode({ x: 7 }, Sch);
  expect(bytes.length).toBeGreaterThanOrEqual(3);
  const id = bytes[0]! | (bytes[1]! << 8);
  expect(id).toBe(Sch.id);
});

test('large nested order-book payload', () => {
  fresh();
  const Level = type('LvlBig', { p: f64, q: f64 });
  const Snap = type('Snap', {
    symbol: str,
    ts: u53,
    bids: list(Level),
    asks: list(Level),
  });

  const bids = Array.from({ length: 1000 }, (_, i) => ({ p: 100 - i * 0.01, q: 1 + i * 0.001 }));
  const asks = Array.from({ length: 1000 }, (_, i) => ({ p: 100 + i * 0.01, q: 1 + i * 0.001 }));
  const v = { symbol: 'BTC-USD', ts: 1700000000123, bids, asks };

  const decoded = Snap.decode(Snap.encode(v));
  expect(decoded.symbol).toBe(v.symbol);
  expect(decoded.ts).toBe(v.ts);
  expect(decoded.bids.length).toBe(1000);
  expect(decoded.asks.length).toBe(1000);
  expect(decoded.bids[0]).toEqual(v.bids[0]);
  expect(decoded.asks[999]).toEqual(v.asks[999]);
});

test('router throws for unknown schema ID', () => {
  fresh();
  const Sch = type('Sch2', { x: u8 });
  const proto = router(Sch);
  const bogus = new Uint8Array([0xff, 0xff, 0]);
  expect(() => proto.decode(bogus)).toThrow(/unknown schema ID/i);
});
