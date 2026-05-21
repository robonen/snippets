import { test, expect } from 'vitest';
import {
  clearRegistry,
  defineSchema,
  deserialize,
  register,
  s,
  serialize,
} from '../plugin/index.ts';

function fresh() {
  clearRegistry();
}

test('flat object with mixed primitives', () => {
  fresh();
  const Ticker = defineSchema('Ticker', (s) => ({
    symbol: s.str,
    last: s.f64,
    volume: s.f64,
    count: s.u32,
  }));
  const codec = register(Ticker);

  const value = { symbol: 'BTC-USD', last: 45123.45, volume: 1234.5678, count: 99999 };
  const bytes = serialize(value, codec);
  const decoded = deserialize<typeof value>(bytes);

  expect(decoded).toEqual(value);
});

test('array of primitives', () => {
  fresh();
  const Tags = defineSchema('Tags', (s) => ({
    items: s.array(s.str),
    counts: s.array(s.u32),
  }));
  const codec = register(Tags);

  const v = { items: ['a', 'b', 'hello'], counts: [1, 2, 3, 4, 5] };
  expect(deserialize(serialize(v, codec))).toEqual(v);
});

test('nested object via inline ObjectSchema', () => {
  fresh();
  const Price = defineSchema('Price', (s) => ({ value: s.f64, scale: s.u8 }));
  const Order = defineSchema('Order', (s) => ({
    id: s.u53,
    price: Price,
    qty: s.f64,
  }));
  register(Price);
  const codec = register(Order);

  const v = { id: 12345, price: { value: 100.5, scale: 2 }, qty: 1.5 };
  expect(deserialize(serialize(v, codec))).toEqual(v);
});

test('optional fields', () => {
  fresh();
  const Maybe = defineSchema('Maybe', (s) => ({
    a: s.optional(s.str),
    b: s.optional(s.f64),
  }));
  const codec = register(Maybe);

  expect(deserialize(serialize({ a: 'hi', b: 3.14 }, codec))).toEqual({
    a: 'hi',
    b: 3.14,
  });
  expect(deserialize(serialize({ a: undefined, b: 1 }, codec))).toEqual({
    a: undefined,
    b: 1,
  });
  expect(deserialize(serialize({ a: undefined, b: undefined }, codec))).toEqual({
    a: undefined,
    b: undefined,
  });
});

test('enum field', () => {
  fresh();
  const Side = defineSchema('SidedOrder', (s) => ({
    side: s.enum(['buy', 'sell'] as const),
    qty: s.f64,
  }));
  const codec = register(Side);

  for (const side of ['buy', 'sell'] as const) {
    const v = { side, qty: 1 };
    expect(deserialize(serialize(v, codec))).toEqual(v);
  }
});

test('bitset field (≤8 flags)', () => {
  fresh();
  const Flags = defineSchema('Flags', (s) => ({
    flags: s.bitset(['ioc', 'post_only', 'reduce_only'] as const),
  }));
  const codec = register(Flags);

  const v = { flags: { ioc: true, post_only: false, reduce_only: true } };
  expect(deserialize(serialize(v, codec))).toEqual(v);
});

test('bitset field (>32 flags uses bigint)', () => {
  fresh();
  const flagNames = Array.from({ length: 40 }, (_, i) => `f${i}`) as readonly string[];
  const Flags = defineSchema('FlagsBig', (s) => ({
    flags: s.bitset(flagNames as readonly [string, ...string[]]),
  }));
  const codec = register(Flags);

  const flags: Record<string, boolean> = {};
  for (let i = 0; i < 40; i++) flags[`f${i}`] = i % 3 === 0;
  const v = { flags };
  expect(deserialize(serialize(v, codec))).toEqual(v);
});

test('tuple field', () => {
  fresh();
  const Point = defineSchema('Point3D', (s) => ({
    name: s.str,
    coord: s.tuple(s.f64, s.f64, s.f64),
  }));
  const codec = register(Point);

  const v = { name: 'p', coord: [1.5, 2.5, 3.5] };
  expect(deserialize(serialize(v, codec))).toEqual(v);
});

test('array of nested objects', () => {
  fresh();
  const Level = defineSchema('Level', (s) => ({ price: s.f64, qty: s.f64 }));
  register(Level);
  const Book = defineSchema('Book', (s) => ({
    bids: s.array(Level),
    asks: s.array(Level),
  }));
  const codec = register(Book);

  const v = {
    bids: [{ price: 100, qty: 1 }, { price: 99, qty: 2 }],
    asks: [{ price: 101, qty: 0.5 }, { price: 102, qty: 1.5 }, { price: 103, qty: 0.1 }],
  };
  expect(deserialize(serialize(v, codec))).toEqual(v);
});

test('union with discriminator', () => {
  fresh();
  const Event = s.union('Event', 'kind', {
    fill: { price: s.f64, qty: s.f64 },
    cancel: { reason: s.str },
    expire: { at: s.u53 },
  });
  const codec = register(Event);

  const samples = [
    { kind: 'fill' as const, price: 100, qty: 0.5 },
    { kind: 'cancel' as const, reason: 'user' },
    { kind: 'expire' as const, at: 1700000000 },
  ];
  for (const v of samples) {
    expect(deserialize(serialize(v, codec))).toEqual(v);
  }
});

test('typed array (f64Array) round-trip', () => {
  fresh();
  const Signal = defineSchema('Signal', (s) => ({
    name: s.str,
    samples: s.f64Array,
  }));
  const codec = register(Signal);

  const samples = new Float64Array([1.1, 2.2, 3.3, 4.4, 5.5]);
  const v = { name: 'sig', samples };
  const decoded = deserialize<typeof v>(serialize(v, codec));
  expect(decoded.name).toBe('sig');
  expect(decoded.samples).toBeInstanceOf(Float64Array);
  expect(decoded.samples.length).toBe(5);
  for (let i = 0; i < 5; i++) expect(decoded.samples[i]).toBe(samples[i]);
});

test('bigint u64/i64 round-trip', () => {
  fresh();
  const Big = defineSchema('Big', (s) => ({
    u: s.u64,
    i: s.i64,
  }));
  const codec = register(Big);
  const v = { u: 1n << 50n, i: -(1n << 50n) };
  expect(deserialize(serialize(v, codec))).toEqual(v);
});

test('bytes field', () => {
  fresh();
  const Blob = defineSchema('Blob', (s) => ({
    data: s.bytes,
  }));
  const codec = register(Blob);
  const data = new Uint8Array([0, 1, 2, 3, 254, 255]);
  const decoded = deserialize<{ data: Uint8Array }>(serialize({ data }, codec));
  expect(Array.from(decoded.data)).toEqual(Array.from(data));
});

test('serialize includes 2-byte schema ID frame', () => {
  fresh();
  const Sch = defineSchema('Sch', (s) => ({ x: s.u8 }));
  const codec = register(Sch);
  const bytes = serialize({ x: 7 }, codec);
  expect(bytes.length).toBeGreaterThanOrEqual(3);
  const id = bytes[0]! | (bytes[1]! << 8);
  expect(id).toBe(codec.id);
});

test('large nested order-book payload', () => {
  fresh();
  const Level = defineSchema('LvlBig', (s) => ({ p: s.f64, q: s.f64 }));
  register(Level);
  const Snap = defineSchema('Snap', (s) => ({
    symbol: s.str,
    ts: s.u53,
    bids: s.array(Level),
    asks: s.array(Level),
  }));
  const codec = register(Snap);

  const bids = Array.from({ length: 1000 }, (_, i) => ({ p: 100 - i * 0.01, q: 1 + i * 0.001 }));
  const asks = Array.from({ length: 1000 }, (_, i) => ({ p: 100 + i * 0.01, q: 1 + i * 0.001 }));
  const v = { symbol: 'BTC-USD', ts: 1700000000123, bids, asks };

  const bytes = serialize(v, codec);
  const decoded = deserialize<typeof v>(bytes);
  expect(decoded.symbol).toBe(v.symbol);
  expect(decoded.ts).toBe(v.ts);
  expect(decoded.bids.length).toBe(1000);
  expect(decoded.asks.length).toBe(1000);
  expect(decoded.bids[0]).toEqual(v.bids[0]);
  expect(decoded.asks[999]).toEqual(v.asks[999]);
});

test('deserialize unknown schema ID throws', () => {
  fresh();
  const bytes = new Uint8Array([0xff, 0xff, 0]);
  expect(() => deserialize(bytes)).toThrow(/Unknown schema ID/);
});
