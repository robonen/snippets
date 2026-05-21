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

const marketOrder = {
  id: 1,
  side: 'buy' as const,
  qty: 0.5,
  price: undefined,
  flags: { ioc: true, post_only: false, reduce_only: false },
};

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
