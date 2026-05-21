import { defineSchema, register, s } from '../../plugin/index.ts';
import type { Codec } from '../../plugin/index.ts';

export const TickerSchema = defineSchema('BenchTicker', (s) => ({
  symbol: s.str,
  last: s.f64,
  bid: s.f64,
  ask: s.f64,
  volume: s.f64,
}));

export const OrderSchema = defineSchema('BenchOrder', (s) => ({
  id: s.u53,
  account: s.u53,
  symbol: s.str,
  side: s.enum(['buy', 'sell'] as const),
  type: s.enum(['limit', 'market', 'stop', 'stop_limit'] as const),
  price: s.f64,
  qty: s.f64,
  filledQty: s.f64,
  ts: s.u53,
  flags: s.bitset(['ioc', 'post_only', 'reduce_only'] as const),
}));

export const LevelSchema = defineSchema('BenchLevel', (s) => ({
  p: s.f64,
  q: s.f64,
}));

export const BookSchema = defineSchema('BenchBook', (s) => ({
  symbol: s.str,
  ts: s.u53,
  bids: s.array(LevelSchema),
  asks: s.array(LevelSchema),
}));

export interface Ticker {
  symbol: string;
  last: number;
  bid: number;
  ask: number;
  volume: number;
}

export interface Order {
  id: number;
  account: number;
  symbol: string;
  side: 'buy' | 'sell';
  type: 'limit' | 'market' | 'stop' | 'stop_limit';
  price: number;
  qty: number;
  filledQty: number;
  ts: number;
  flags: { ioc: boolean; post_only: boolean; reduce_only: boolean };
}

export interface Level {
  p: number;
  q: number;
}

export interface Book {
  symbol: string;
  ts: number;
  bids: Level[];
  asks: Level[];
}

export function buildTicker(): Ticker {
  return {
    symbol: 'BTC-USD',
    last: 67891.23,
    bid: 67890.5,
    ask: 67892.0,
    volume: 1234567.89,
  };
}

export function buildOrder(): Order {
  return {
    id: 9876543210,
    account: 12345678,
    symbol: 'BTC-USD',
    side: 'buy',
    type: 'limit',
    price: 67500.5,
    qty: 0.125,
    filledQty: 0,
    ts: 1716100000123,
    flags: { ioc: false, post_only: true, reduce_only: false },
  };
}

export function buildBook(depth: number): Book {
  const bids: Level[] = new Array(depth);
  const asks: Level[] = new Array(depth);
  for (let i = 0; i < depth; i++) {
    bids[i] = { p: 67890 - i * 0.5, q: 0.1 + (i % 100) * 0.01 };
    asks[i] = { p: 67891 + i * 0.5, q: 0.1 + (i % 100) * 0.01 };
  }
  return { symbol: 'BTC-USD', ts: 1716100000123, bids, asks };
}

export interface Codecs {
  ticker: Codec<Ticker>;
  order: Codec<Order>;
  level: Codec<Level>;
  book: Codec<Book>;
}

export function registerAll(): Codecs {
  const ticker = register<Ticker>(TickerSchema);
  const order = register<Order>(OrderSchema);
  const level = register<Level>(LevelSchema);
  const book = register<Book>(BookSchema);
  return { ticker, order, level, book };
}
