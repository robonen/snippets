/**
 * Examples of the @perf/serializer API.
 *
 * When the AOT plugin is enabled in vite.config.ts, every `type(...)` /
 * `oneOf(...)` call below is replaced at build time with a precomputed
 * codec literal. The runtime never calls `new Function`.
 */

import {
  type,
  oneOf,
  router,
  u53,
  f64,
  str,
  list,
  opt,
  enumOf,
  flags,
  Writer,
  Serializable,
} from '@perf/serializer';

// ─── Tee output to console + <pre id="out"> if we're in a browser ──────────

const out =
  typeof document !== 'undefined' ? document.getElementById('out') : null;

function log(...args: unknown[]): void {
  console.log(...args);
  if (out) {
    const text = args
      .map((a) => {
        if (typeof a === 'string') return a;
        if (a instanceof Uint8Array) return `Uint8Array(${a.length})`;
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      })
      .join(' ');
    out.textContent += text + '\n';
  }
}

// ─── Example 1: flat schema ────────────────────────────────────────────────
//
// Define a Ticker, infer its TypeScript type from the schema, encode and
// decode it. This is the 90% use case.

const Ticker = type('Ticker', {
  symbol: str,
  last: f64,
  bid: f64,
  ask: f64,
  volume: f64,
});

type Ticker = typeof Ticker.$infer;
// → { symbol: string; last: number; bid: number; ask: number; volume: number }

const ticker: Ticker = {
  symbol: 'BTC-USD',
  last: 67891.23,
  bid: 67890.5,
  ask: 67892.0,
  volume: 1234567.89,
};

const tickerBytes = Ticker.encode(ticker);
const tickerBack = Ticker.decode(tickerBytes);

log('Example 1: Ticker');
log(`  encoded ${tickerBytes.length} bytes (JSON would be ${JSON.stringify(ticker).length})`);
log('  decoded:', tickerBack);

// ─── Example 2: nested object + list ───────────────────────────────────────
//
// `Level` is itself a codec; it can be passed as a field in another `type()`.
// The transformer inlines its encode/decode into the parent — no per-element
// function dispatch.

const Level = type('Level', { p: f64, q: f64 });

const Book = type('Book', {
  symbol: str,
  ts: u53,
  bids: list(Level),
  asks: list(Level),
});

const book = {
  symbol: 'BTC-USD',
  ts: Date.now(),
  bids: [
    { p: 67890.5, q: 0.1 },
    { p: 67890.0, q: 0.3 },
    { p: 67889.5, q: 0.5 },
  ],
  asks: [
    { p: 67891.0, q: 0.2 },
    { p: 67891.5, q: 0.4 },
  ],
};

const bookBytes = Book.encode(book);
log('\nExample 2: OrderBook');
log(`  encoded ${bookBytes.length} bytes (JSON: ${JSON.stringify(book).length})`);
log('  decoded.bids[0]:', Book.decode(bookBytes).bids[0]);

// ─── Example 3: enum + bitset + optional ───────────────────────────────────
//
// Enums encode as one byte. Bitsets pack up to 32 flags into a u32. Optional
// fields add one presence byte.

const Order = type('Order', {
  id: u53,
  side: enumOf(['buy', 'sell'] as const),
  qty: f64,
  price: opt(f64), // market orders have no price
  flags: flags(['ioc', 'post_only', 'reduce_only'] as const),
});

type Order = typeof Order.$infer;

const marketOrder = {
  id: 1,
  side: 'buy' as const,
  qty: 0.5,
  price: undefined,
  flags: { ioc: true, post_only: false, reduce_only: false },
} satisfies Order;

const limitOrder = {
  id: 2,
  side: 'sell' as const,
  qty: 0.5,
  price: 67900,
  flags: { ioc: false, post_only: true, reduce_only: false },
};

log('\nExample 3: Orders (enum + opt + flags)');
log(`  market: ${Order.encode(marketOrder).length}b`);
log(`  limit:  ${Order.encode(limitOrder).length}b`);

// ─── Example 4: discriminated union ────────────────────────────────────────
//
// Each variant has its own field map. The discriminator (`kind`) is written as
// a one-byte tag, then the variant's fields follow.

const Event = oneOf('Event', 'kind', {
  fill: { price: f64, qty: f64 },
  cancel: { reason: str },
  expire: { at: u53 },
});

const events = [
  { kind: 'fill', price: 67891.0, qty: 0.5 },
  { kind: 'cancel', reason: 'user-requested' },
  { kind: 'expire', at: Date.now() + 60_000 },
];

log('\nExample 4: Events (union)');
for (const e of events) {
  const bytes = Event.encode(e as never);
  log(`  ${e.kind.padEnd(7)}: ${bytes.length}b`);
}

// ─── Example 5: pooled writer (hot path) ───────────────────────────────────
//
// Reuse one Writer across many encodes. `encodeInto` writes directly into the
// pooled buffer; `bytes()` returns a zero-copy view. This is the lowest-overhead
// path — what to use inside a tight WebSocket frame loop.

const w = new Writer(1024);

function sendTicker(t: Ticker, socket: { send(bytes: Uint8Array): void }): void {
  w.reset();
  Ticker.encodeInto(t, w);
  socket.send(w.bytes());
}

const fakeSocket = {
  send(bytes: Uint8Array): void {
    log(`  socket received ${bytes.length} bytes`);
  },
};

log('\nExample 5: pooled writer hot path');
sendTicker(ticker, fakeSocket);
sendTicker({ ...ticker, last: 67900 }, fakeSocket);

// ─── Example 6: router (framed multi-message protocol) ─────────────────────
//
// `router` prepends a 2-byte schema-ID frame on encode and dispatches on it on
// decode. Use this when one socket carries many message types.

const proto = router(Ticker, Book, Order, Event);

const framedTicker = proto.encode(ticker, Ticker);
const framedBook = proto.encode(book, Book);

log('\nExample 6: router (framed)');
log(`  framed ticker: ${framedTicker.length}b (first 2 bytes = schema id)`);
log(`  framed book:   ${framedBook.length}b`);

const dispatched1 = proto.decode(framedTicker);
const dispatched2 = proto.decode(framedBook);
log('  dispatched ticker symbol:', (dispatched1 as Ticker).symbol);
log('  dispatched book bids[0]:', (dispatched2 as typeof book).bids[0]);

// ─── Example 7: class with [Symbol.serializable] contract ──────────────────
//
// Attach the schema to a class via the well-known `Symbol.serializable`. The
// AOT plugin sees this and:
//   • generates a class-aware decoder that returns `Object.create(Position.prototype)`
//     instances, so methods/getters work on decoded values;
//   • auto-registers the codec into the runtime registry on module load — no
//     `registerClass(Position)` call needed;
//   • makes `Position[Serializable]` the codec itself, usable directly.

class Position {
  side!: 'long' | 'short';
  qty!: number;
  entryPrice!: number;

  static [Serializable] = type('Position', {
    side: enumOf(['long', 'short'] as const),
    qty: f64,
    entryPrice: f64,
  });

  get notional(): number {
    return this.qty * this.entryPrice;
  }

  pnl(currentPrice: number): number {
    return this.side === 'long'
      ? (currentPrice - this.entryPrice) * this.qty
      : (this.entryPrice - currentPrice) * this.qty;
  }
}

const pos = Object.assign(new Position(), {
  side: 'long' as const,
  qty: 2,
  entryPrice: 67500,
});

// `Position[Serializable]` IS the codec — no `registerClass(...)` needed.
const PositionCodec = Position[Serializable]!;
const posBytes = PositionCodec.encode(pos);
const back = PositionCodec.decode(posBytes) as Position;

log('\nExample 7: class with Symbol.serializable');
log(`  encoded: ${posBytes.length}b`);
log(`  pos.notional:   ${pos.notional}`);
log(`  back.notional:  ${back.notional}  (method works on decoded value after AOT)`);
log(`  back instanceof Position: ${back instanceof Position}`);
log(`  back.pnl(68000): ${back.pnl(68000)}`);

// ─── Example 8: deeply-nested portfolio (5 levels, ~770 objects) ────────────
//
// Realistic deep-tree data: Portfolio → Accounts → Holdings → Trades →
// Executions. Demonstrates that the codec handles arbitrary nesting; under AOT
// the inner-loop encoder/decoder is fully inlined — no per-level function
// dispatch.

const Execution = type('Execution', {
  id: u53,
  ts: u53,
  price: f64,
  qty: f64,
  venue: enumOf(['NYSE', 'NASDAQ', 'BATS', 'IEX'] as const),
});

const Trade = type('Trade', {
  id: u53,
  symbol: str,
  side: enumOf(['buy', 'sell'] as const),
  executions: list(Execution),
});

const Holding = type('Holding', {
  symbol: str,
  qty: f64,
  avgEntry: f64,
  trades: list(Trade),
});

const Account = type('Account', {
  id: u53,
  name: str,
  currency: enumOf(['USD', 'EUR', 'GBP'] as const),
  balance: f64,
  holdings: list(Holding),
});

const Portfolio = type('Portfolio', {
  ownerId: u53,
  ts: u53,
  accounts: list(Account),
});

type PortfolioT = typeof Portfolio.$infer;

function buildPortfolio(): PortfolioT {
  const venues = ['NYSE', 'NASDAQ', 'BATS', 'IEX'] as const;
  const symbols = ['AAPL', 'MSFT', 'GOOG', 'AMZN', 'TSLA'] as const;
  const currencies = ['USD', 'EUR', 'GBP'] as const;

  return {
    ownerId: 100001,
    ts: 1716100000000,
    accounts: Array.from({ length: 3 }, (_, a) => ({
      id: 10 + a,
      name: `Account-${a + 1}`,
      currency: currencies[a]!,
      balance: 100_000 * (a + 1),
      holdings: Array.from({ length: 5 }, (_, p) => ({
        symbol: symbols[p % symbols.length]!,
        qty: 100 * (p + 1),
        avgEntry: 100 + p * 25,
        trades: Array.from({ length: 10 }, (_, t) => ({
          id: a * 1000 + p * 100 + t,
          symbol: symbols[(a + p + t) % symbols.length]!,
          side: t % 2 === 0 ? ('buy' as const) : ('sell' as const),
          executions: Array.from({ length: 4 }, (_, e) => ({
            id: a * 10000 + p * 1000 + t * 10 + e,
            ts: 1716100000000 + (a * 100 + p * 50 + t * 5 + e) * 1000,
            price: 100 + ((a + p + t + e) % 100) * 2,
            qty: 5 + ((p + t + e) % 50),
            venue: venues[e % 4]!,
          })),
        })),
      })),
    })),
  };
}

const portfolio = buildPortfolio();

// Counts at each level.
const nAccounts = portfolio.accounts.length;
const nHoldings = portfolio.accounts.reduce((s, a) => s + a.holdings.length, 0);
const nTrades = portfolio.accounts.reduce(
  (s, a) => s + a.holdings.reduce((ss, h) => ss + h.trades.length, 0),
  0,
);
const nExecs = portfolio.accounts.reduce(
  (s, a) =>
    s +
    a.holdings.reduce(
      (ss, h) => ss + h.trades.reduce((sss, t) => sss + t.executions.length, 0),
      0,
    ),
  0,
);

const tEnc0 = performance.now();
const portfolioBytes = Portfolio.encode(portfolio);
const tEnc1 = performance.now();
const portfolioJSON = JSON.stringify(portfolio);
const tEnc2 = performance.now();
const decodedPortfolio = Portfolio.decode(portfolioBytes);
const tEnc3 = performance.now();
JSON.parse(portfolioJSON);
const tEnc4 = performance.now();

const total = 1 + nAccounts + nHoldings + nTrades + nExecs;

log('\nExample 8: deeply-nested portfolio (5 levels)');
log(
  `  ${nAccounts} accounts × ${nHoldings / nAccounts} holdings × ${nTrades / nHoldings} trades × ${nExecs / nTrades} executions = ${total} objects total`,
);
log(
  `  encoded:  ${portfolioBytes.length}b in ${(tEnc1 - tEnc0).toFixed(2)}ms   |   JSON: ${portfolioJSON.length}b in ${(tEnc2 - tEnc1).toFixed(2)}ms   (${((portfolioBytes.length / portfolioJSON.length) * 100).toFixed(0)}% of JSON)`,
);
log(
  `  decoded:  ${(tEnc3 - tEnc2).toFixed(2)}ms                              |   JSON.parse: ${(tEnc4 - tEnc3).toFixed(2)}ms`,
);
const sampleExec = decodedPortfolio.accounts[0]!.holdings[0]!.trades[0]!.executions[0]!;
const origExec = portfolio.accounts[0]!.holdings[0]!.trades[0]!.executions[0]!;
log(
  `  round-trip preserves leaf data: ${sampleExec.id === origExec.id && sampleExec.venue === origExec.venue}`,
);
