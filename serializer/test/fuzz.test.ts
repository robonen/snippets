import { test, expect } from 'vitest';
import {
  clearRegistry,
  defineSchema,
  deserialize,
  register,
  s,
  serialize,
} from '../plugin/index.ts';

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r = rng(0xc0ffee);

function randFloat(): number {
  const bucket = Math.floor(r() * 6);
  switch (bucket) {
    case 0: return 0;
    case 1: return r() * 100;
    case 2: return r() * 1e10;
    case 3: return -r() * 100;
    case 4: return (r() - 0.5) * 1e-6;
    default: return r() * 1000;
  }
}

function randInt(maxBits = 32): number {
  const v = Math.floor(r() * 2 ** maxBits);
  return v >>> 0;
}

function randString(): string {
  const len = Math.floor(r() * 30);
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(32 + Math.floor(r() * 95));
  return s;
}

test('fuzz: 2000 random ticker round-trips', () => {
  clearRegistry();
  const Ticker = defineSchema('FuzzTicker', (s) => ({
    symbol: s.str,
    last: s.f64,
    volume: s.f64,
    count: s.u32,
    asks: s.array(s.f64),
  }));
  const codec = register(Ticker);

  for (let i = 0; i < 2000; i++) {
    const v = {
      symbol: randString(),
      last: randFloat(),
      volume: randFloat(),
      count: randInt(32),
      asks: Array.from({ length: Math.floor(r() * 10) }, randFloat),
    };
    expect(deserialize(serialize(v, codec)), `iteration ${i}`).toEqual(v);
  }
});

test('fuzz: 1000 random nested orders', () => {
  clearRegistry();
  const Price = defineSchema('FuzzPrice', (s) => ({ value: s.f64, scale: s.u8 }));
  register(Price);
  const Order = defineSchema('FuzzOrder', (s) => ({
    id: s.u53,
    symbol: s.str,
    price: Price,
    qty: s.f64,
    side: s.enum(['buy', 'sell'] as const),
    tags: s.array(s.str),
    flags: s.bitset(['ioc', 'post_only', 'reduce_only'] as const),
  }));
  const codec = register(Order);

  for (let i = 0; i < 1000; i++) {
    const v = {
      id: Math.floor(r() * 2 ** 40),
      symbol: randString(),
      price: { value: randFloat(), scale: randInt(8) & 0xff },
      qty: randFloat(),
      side: (r() < 0.5 ? 'buy' : 'sell') as 'buy' | 'sell',
      tags: Array.from({ length: Math.floor(r() * 5) }, randString),
      flags: {
        ioc: r() < 0.5,
        post_only: r() < 0.5,
        reduce_only: r() < 0.5,
      },
    };
    expect(deserialize(serialize(v, codec)), `iteration ${i}`).toEqual(v);
  }
});

test('fuzz: 500 random unions', () => {
  clearRegistry();
  const Event = s.union('FuzzEvent', 'kind', {
    fill: { price: s.f64, qty: s.f64 },
    cancel: { reason: s.str },
    expire: { at: s.u53 },
  });
  const codec = register(Event);

  for (let i = 0; i < 500; i++) {
    const which = Math.floor(r() * 3);
    let v: unknown;
    if (which === 0) v = { kind: 'fill', price: randFloat(), qty: randFloat() };
    else if (which === 1) v = { kind: 'cancel', reason: randString() };
    else v = { kind: 'expire', at: Math.floor(r() * 2 ** 40) };

    expect(deserialize(serialize(v, codec)), `iteration ${i}`).toEqual(v);
  }
});
