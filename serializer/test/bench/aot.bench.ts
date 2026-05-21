/**
 * Compile-time (AOT) vs runtime codegen benchmark.
 *
 * The AOT codecs are produced by running our transformer on a sample TS file
 * at bench startup, writing the result to a temp file, and importing it. The
 * runtime codecs come from the regular `type(...)` runtime path.
 */

import { bench, beforeAll, afterAll, describe } from 'vitest';
import { writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transform } from '../../plugin/compile/transformer.ts';
import {
  type as runtimeType,
  type TypeCodec,
  u53,
  f64,
  str,
  list,
  enumOf,
  flags,
  clearRegistry,
  Reader,
  Writer,
} from '../../plugin/index.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const GEN_FILE = join(HERE, '__aot_codecs.ts');

const AOT_SOURCE = `
import { type, u53, f64, str, list, enumOf, flags } from '../../plugin/index.ts';

export const Ticker = type('AotTicker', {
  symbol: str,
  last: f64,
  bid: f64,
  ask: f64,
  volume: f64,
});

export const Order = type('AotOrder', {
  id: u53,
  account: u53,
  symbol: str,
  side: enumOf(['buy', 'sell'] as const),
  price: f64,
  qty: f64,
  filledQty: f64,
  ts: u53,
  flags: flags(['ioc', 'post_only', 'reduce_only'] as const),
});

export const Level = type('AotLevel', { p: f64, q: f64 });

export const Book = type('AotBook', {
  symbol: str,
  ts: u53,
  bids: list(Level),
  asks: list(Level),
});
`;

interface AotCodec {
  encode: (v: unknown, w?: Writer) => Uint8Array;
  decode: (b: Uint8Array) => unknown;
  encodeInto: (v: unknown, w: Writer) => void;
  decodeFrom: (r: Reader) => unknown;
  id: number;
}

let aot: Record<string, AotCodec>;
let rtTicker: TypeCodec<unknown>;
let rtOrder: TypeCodec<unknown>;
let rtLevel: TypeCodec<unknown>;
let rtBook: TypeCodec<unknown>;

const ticker = {
  symbol: 'BTC-USD', last: 67891.23, bid: 67890.5, ask: 67892.0, volume: 1234567.89,
};
const order = {
  id: 9876543210, account: 12345678, symbol: 'BTC-USD',
  side: 'buy' as const, price: 67500.5, qty: 0.125, filledQty: 0,
  ts: 1716100000123,
  flags: { ioc: false, post_only: true, reduce_only: false },
};
const book = {
  symbol: 'BTC-USD',
  ts: 1716100000123,
  bids: Array.from({ length: 1000 }, (_, i) => ({ p: 67890 - i * 0.5, q: 0.1 + (i % 100) * 0.01 })),
  asks: Array.from({ length: 1000 }, (_, i) => ({ p: 67891 + i * 0.5, q: 0.1 + (i % 100) * 0.01 })),
};

const wT = new Writer(256);
const wO = new Writer(256);
const wB = new Writer(64 * 1024);

let tickerAot: Uint8Array;
let tickerRt: Uint8Array;
let orderAot: Uint8Array;
let orderRt: Uint8Array;
let bookAot: Uint8Array;
let bookRt: Uint8Array;

beforeAll(async () => {
  // Build the AOT module on the fly.
  const transformed = transform(AOT_SOURCE, GEN_FILE, {
    importPath: '../../plugin/index.ts',
    packageAliases: ['../../plugin/index.ts'],
  });
  writeFileSync(GEN_FILE, transformed.code, 'utf8');
  const url = `${pathToFileURL(GEN_FILE).href}?t=${Date.now()}`;
  aot = (await import(/* @vite-ignore */ url)) as Record<string, AotCodec>;

  // Runtime equivalents with non-colliding names.
  clearRegistry();
  rtTicker = runtimeType('RtTicker', {
    symbol: str, last: f64, bid: f64, ask: f64, volume: f64,
  });
  rtOrder = runtimeType('RtOrder', {
    id: u53, account: u53, symbol: str,
    side: enumOf(['buy', 'sell'] as const),
    price: f64, qty: f64, filledQty: f64, ts: u53,
    flags: flags(['ioc', 'post_only', 'reduce_only'] as const),
  });
  rtLevel = runtimeType('RtLevel', { p: f64, q: f64 });
  rtBook = runtimeType('RtBook', {
    symbol: str, ts: u53, bids: list(rtLevel), asks: list(rtLevel),
  });

  // Pre-encode for decode benches
  tickerAot = aot.Ticker!.encode(ticker);
  wT.reset(); rtTicker.encodeInto(ticker, wT); tickerRt = wT.bytes().slice();
  orderAot = aot.Order!.encode(order);
  wO.reset(); rtOrder.encodeInto(order, wO); orderRt = wO.bytes().slice();
  bookAot = aot.Book!.encode(book);
  wB.reset(); rtBook.encodeInto(book, wB); bookRt = wB.bytes().slice();
});

afterAll(() => {
  if (existsSync(GEN_FILE)) rmSync(GEN_FILE, { force: true });
});

describe('encode ticker (AOT vs runtime)', () => {
  bench('AOT (compiled)', () => {
    wT.reset();
    aot.Ticker!.encodeInto(ticker, wT);
  });
  bench('runtime (new Function)', () => {
    wT.reset();
    rtTicker.encodeInto(ticker, wT);
  });
});

describe('encode order (AOT vs runtime)', () => {
  bench('AOT (compiled)', () => {
    wO.reset();
    aot.Order!.encodeInto(order, wO);
  });
  bench('runtime', () => {
    wO.reset();
    rtOrder.encodeInto(order, wO);
  });
});

describe('encode book 1000 levels (AOT vs runtime)', () => {
  bench('AOT (compiled)', () => {
    wB.reset();
    aot.Book!.encodeInto(book, wB);
  });
  bench('runtime', () => {
    wB.reset();
    rtBook.encodeInto(book, wB);
  });
});

describe('decode ticker (AOT vs runtime)', () => {
  bench('AOT (compiled)', () => {
    const r = new Reader(tickerAot);
    aot.Ticker!.decodeFrom(r);
  });
  bench('runtime', () => {
    const r = new Reader(tickerRt);
    rtTicker.decodeFrom(r);
  });
});

describe('decode book 1000 levels (AOT vs runtime)', () => {
  bench('AOT (compiled)', () => {
    const r = new Reader(bookAot);
    aot.Book!.decodeFrom(r);
  });
  bench('runtime', () => {
    const r = new Reader(bookRt);
    rtBook.decodeFrom(r);
  });
});
