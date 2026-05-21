import {
  type,
  enumOf,
  f64,
  flags,
  list,
  str,
  u53,
  type TypeCodec,
} from '../../plugin/index.ts';

export const Ticker = type('BenchTicker', {
  symbol: str,
  last: f64,
  bid: f64,
  ask: f64,
  volume: f64,
});

export const Order = type('BenchOrder', {
  id: u53,
  account: u53,
  symbol: str,
  side: enumOf(['buy', 'sell'] as const),
  type: enumOf(['limit', 'market', 'stop', 'stop_limit'] as const),
  price: f64,
  qty: f64,
  filledQty: f64,
  ts: u53,
  flags: flags(['ioc', 'post_only', 'reduce_only'] as const),
});

export const Level = type('BenchLevel', { p: f64, q: f64 });

export const Book = type('BenchBook', {
  symbol: str,
  ts: u53,
  bids: list(Level),
  asks: list(Level),
});

export type TickerT = typeof Ticker.$infer;
export type OrderT = typeof Order.$infer;
export type LevelT = typeof Level.$infer;
export type BookT = typeof Book.$infer;

export function buildTicker(): TickerT {
  return {
    symbol: 'BTC-USD',
    last: 67891.23,
    bid: 67890.5,
    ask: 67892.0,
    volume: 1234567.89,
  };
}

export function buildOrder(): OrderT {
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

export function buildBook(depth: number): BookT {
  const bids: LevelT[] = new Array(depth);
  const asks: LevelT[] = new Array(depth);
  for (let i = 0; i < depth; i++) {
    bids[i] = { p: 67890 - i * 0.5, q: 0.1 + (i % 100) * 0.01 };
    asks[i] = { p: 67891 + i * 0.5, q: 0.1 + (i % 100) * 0.01 };
  }
  return { symbol: 'BTC-USD', ts: 1716100000123, bids, asks };
}

export type AllCodecs = {
  ticker: TypeCodec<TickerT>;
  order: TypeCodec<OrderT>;
  level: TypeCodec<LevelT>;
  book: TypeCodec<BookT>;
};
