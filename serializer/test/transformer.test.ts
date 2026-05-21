import { test, expect, afterAll } from 'vitest';
import { writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transform } from '../plugin/compile/transformer.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
// Write gen files directly in the test dir so relative imports `../src/...`
// resolve to serializer/src/index.ts.
const GEN_DIR = HERE;

let counter = 0;
async function transformAndImport(source: string): Promise<Record<string, unknown>> {
  const id = ++counter;
  const file = join(GEN_DIR, `__gen_${id}.ts`);
  const result = transform(source, file, {
    importPath: '../plugin/index.ts',
    packageAliases: ['../plugin/index.ts'],
  });
  writeFileSync(file, result.code, 'utf8');
  // Use file URL + @vite-ignore so vite passes through to native dynamic import.
  const url = `${pathToFileURL(file).href}?t=${Date.now()}`;
  const mod = await import(/* @vite-ignore */ url);
  return mod as Record<string, unknown>;
}

test('transformer: flat type round-trip', async () => {
  const src = `
import { type, u53, f64, str } from '../plugin/index.ts';

export const Ticker = type('TxTicker', {
  symbol: str,
  last: f64,
  volume: f64,
});
`;
  const mod = await transformAndImport(src);
  const Ticker = mod.Ticker as { encode: (v: unknown) => Uint8Array; decode: (b: Uint8Array) => unknown };
  const v = { symbol: 'BTC-USD', last: 100.5, volume: 1234.5 };
  expect(Ticker.decode(Ticker.encode(v))).toEqual(v);
});

test('transformer: nested object via local reference', async () => {
  const src = `
import { type, u53, f64 } from '../plugin/index.ts';

export const Price = type('TxPrice', { value: f64, scale: u53 });
export const Order = type('TxOrder', { id: u53, price: Price, qty: f64 });
`;
  const mod = await transformAndImport(src);
  const Order = mod.Order as { encode: (v: unknown) => Uint8Array; decode: (b: Uint8Array) => unknown };
  const v = { id: 42, price: { value: 100.5, scale: 2 }, qty: 0.5 };
  expect(Order.decode(Order.encode(v))).toEqual(v);
});

test('transformer: combinators (list, opt, enumOf, flags, tuple)', async () => {
  const src = `
import { type, u53, f64, str, list, opt, enumOf, flags, tuple } from '../plugin/index.ts';

export const Combo = type('TxCombo', {
  tags: list(str),
  maybe: opt(f64),
  side: enumOf(['buy', 'sell'] as const),
  f: flags(['ioc', 'post_only'] as const),
  point: tuple(f64, f64),
});
`;
  const mod = await transformAndImport(src);
  const Combo = mod.Combo as { encode: (v: unknown) => Uint8Array; decode: (b: Uint8Array) => unknown };
  const v = {
    tags: ['a', 'b'],
    maybe: 3.14,
    side: 'buy',
    f: { ioc: true, post_only: false },
    point: [1, 2],
  };
  expect(Combo.decode(Combo.encode(v))).toEqual(v);
});

test('transformer: anonymous (no name) — uses const name as schema name', async () => {
  const src = `
import { type, u53, f64 } from '../plugin/index.ts';

export const TxAnon = type({ x: u53, y: f64 });
`;
  const mod = await transformAndImport(src);
  const T = mod.TxAnon as {
    encode: (v: unknown) => Uint8Array;
    decode: (b: Uint8Array) => unknown;
    id: number;
    name: string;
  };
  expect(T.name).toBe('TxAnon');
  const v = { x: 1, y: 2.5 };
  expect(T.decode(T.encode(v))).toEqual(v);
});

test('transformer: array of nested objects (the OrderBook hot path)', async () => {
  const src = `
import { type, u53, f64, str, list } from '../plugin/index.ts';

export const Level = type('TxLevel', { p: f64, q: f64 });
export const Book = type('TxBook', {
  symbol: str,
  ts: u53,
  bids: list(Level),
  asks: list(Level),
});
`;
  const mod = await transformAndImport(src);
  const Book = mod.Book as { encode: (v: unknown) => Uint8Array; decode: (b: Uint8Array) => unknown };
  const v = {
    symbol: 'BTC-USD',
    ts: 1700000000000,
    bids: Array.from({ length: 100 }, (_, i) => ({ p: 100 - i * 0.1, q: 0.5 + i * 0.01 })),
    asks: Array.from({ length: 100 }, (_, i) => ({ p: 100 + i * 0.1, q: 0.5 + i * 0.01 })),
  };
  const decoded = Book.decode(Book.encode(v)) as typeof v;
  expect(decoded.symbol).toBe(v.symbol);
  expect(decoded.ts).toBe(v.ts);
  expect(decoded.bids.length).toBe(100);
  expect(decoded.bids[0]).toEqual(v.bids[0]);
  expect(decoded.asks[99]).toEqual(v.asks[99]);
});

test('transformer: file without type() imports — unchanged', () => {
  const src = `
import { foo } from 'somewhere';
const x = foo();
`;
  const result = transform(src, 'test.ts', { importPath: '../plugin/index.ts' });
  expect(result.transformedCount).toBe(0);
  expect(result.code).toBe(src);
});

test('transformer: file with type import but no calls — adds nothing', () => {
  const src = `
import { type, u53 } from '../plugin/index.ts';
// no type() call here
const x = 1;
`;
  const result = transform(src, 'test.ts', {
    importPath: '../plugin/index.ts',
    packageAliases: ['../plugin/index.ts'],
  });
  expect(result.transformedCount).toBe(0);
});

test('transformer: replaces call with IIFE (smoke check on output)', () => {
  const src = `
import { type, u53, f64 } from '../plugin/index.ts';
export const T = type('TxSmoke', { x: u53, y: f64 });
`;
  const result = transform(src, 'test.ts', {
    importPath: '../plugin/index.ts',
    packageAliases: ['../plugin/index.ts'],
  });
  expect(result.transformedCount).toBe(1);
  expect(result.code).toContain('function encode_TxSmoke');
  expect(result.code).toContain('function decode_TxSmoke');
  expect(result.code).not.toContain("type('TxSmoke'");
});

afterAll(() => {
  for (let i = 1; i <= counter; i++) {
    const file = join(GEN_DIR, `__gen_${i}.ts`);
    if (existsSync(file)) rmSync(file, { force: true });
  }
});
