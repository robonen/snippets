import { test, expect } from 'vitest';
import {
  clearRegistry,
  enumOf,
  f64,
  flags,
  list,
  oneOf,
  str,
  type,
  u32,
  u53,
  u8,
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
  return Math.floor(r() * 2 ** maxBits) >>> 0;
}

function randString(): string {
  const len = Math.floor(r() * 30);
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(32 + Math.floor(r() * 95));
  return s;
}

test('fuzz: 2000 random ticker round-trips', () => {
  clearRegistry();
  const Ticker = type('FuzzTicker', {
    symbol: str,
    last: f64,
    volume: f64,
    count: u32,
    asks: list(f64),
  });

  for (let i = 0; i < 2000; i++) {
    const v = {
      symbol: randString(),
      last: randFloat(),
      volume: randFloat(),
      count: randInt(32),
      asks: Array.from({ length: Math.floor(r() * 10) }, randFloat),
    };
    expect(Ticker.decode(Ticker.encode(v)), `iteration ${i}`).toEqual(v);
  }
});

test('fuzz: 1000 random nested orders', () => {
  clearRegistry();
  const Price = type('FuzzPrice', { value: f64, scale: u8 });
  const Order = type('FuzzOrder', {
    id: u53,
    symbol: str,
    price: Price,
    qty: f64,
    side: enumOf(['buy', 'sell'] as const),
    tags: list(str),
    flags: flags(['ioc', 'post_only', 'reduce_only'] as const),
  });

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
    expect(Order.decode(Order.encode(v)), `iteration ${i}`).toEqual(v);
  }
});

test('fuzz: 500 random unions', () => {
  clearRegistry();
  const Event = oneOf('FuzzEvent', 'kind', {
    fill: { price: f64, qty: f64 },
    cancel: { reason: str },
    expire: { at: u53 },
  });

  for (let i = 0; i < 500; i++) {
    const which = Math.floor(r() * 3);
    let v: unknown;
    if (which === 0) v = { kind: 'fill', price: randFloat(), qty: randFloat() };
    else if (which === 1) v = { kind: 'cancel', reason: randString() };
    else v = { kind: 'expire', at: Math.floor(r() * 2 ** 40) };

    expect(Event.decode(Event.encode(v as never)), `iteration ${i}`).toEqual(v);
  }
});
