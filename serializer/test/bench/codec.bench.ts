import { bench, describe } from 'vitest';
import { Reader, Writer, router } from '../../plugin/index.ts';
import {
  Book,
  Order,
  Ticker,
  buildBook,
  buildOrder,
  buildTicker,
} from './payloads.ts';

const ticker = buildTicker();
const order = buildOrder();
const book = buildBook(1000);

// Pre-allocated pooled Writers (sized generously so we don't measure grow()).
const wTicker = new Writer(256);
const wOrder = new Writer(256);
const wBook = new Writer(64 * 1024);

// Pre-encoded buffers for decode benches.
const tickerJSON = JSON.stringify(ticker);
const orderJSON = JSON.stringify(order);
const bookJSON = JSON.stringify(book);

const tickerBin = Ticker.encode(ticker);
const orderBin = Order.encode(order);
const bookBin = Book.encode(book);

// One-time payload-size print on module load.
// eslint-disable-next-line no-console
console.log(
  '\n--- payload sizes ---\n' +
    `ticker  | json: ${tickerJSON.length}b  bin: ${tickerBin.length}b  (${((tickerBin.length / tickerJSON.length) * 100).toFixed(0)}%)\n` +
    `order   | json: ${orderJSON.length}b   bin: ${orderBin.length}b   (${((orderBin.length / orderJSON.length) * 100).toFixed(0)}%)\n` +
    `book    | json: ${bookJSON.length}b    bin: ${bookBin.length}b    (${((bookBin.length / bookJSON.length) * 100).toFixed(0)}%)\n`,
);

describe('encode ticker (5 fields)', () => {
  bench('JSON.stringify', () => {
    JSON.stringify(ticker);
  });
  bench('codec.encodeInto (pooled)', () => {
    wTicker.reset();
    Ticker.encodeInto(ticker, wTicker);
  });
});

describe('encode order (10 fields + bitset)', () => {
  bench('JSON.stringify', () => {
    JSON.stringify(order);
  });
  bench('codec.encodeInto (pooled)', () => {
    wOrder.reset();
    Order.encodeInto(order, wOrder);
  });
});

describe('encode book (1000 levels)', () => {
  bench('JSON.stringify', () => {
    JSON.stringify(book);
  });
  bench('codec.encodeInto (pooled)', () => {
    wBook.reset();
    Book.encodeInto(book, wBook);
  });
});

describe('decode ticker', () => {
  bench('JSON.parse', () => {
    JSON.parse(tickerJSON);
  });
  bench('codec.decodeFrom', () => {
    const r = new Reader(tickerBin);
    Ticker.decodeFrom(r);
  });
});

describe('decode order', () => {
  bench('JSON.parse', () => {
    JSON.parse(orderJSON);
  });
  bench('codec.decodeFrom', () => {
    const r = new Reader(orderBin);
    Order.decodeFrom(r);
  });
});

describe('decode book (1000 levels)', () => {
  bench('JSON.parse', () => {
    JSON.parse(bookJSON);
  });
  bench('codec.decodeFrom', () => {
    const r = new Reader(bookBin);
    Book.decodeFrom(r);
  });
});

describe('roundtrip ticker', () => {
  bench('JSON', () => {
    JSON.parse(JSON.stringify(ticker));
  });
  bench('codec (pooled)', () => {
    wTicker.reset();
    Ticker.encodeInto(ticker, wTicker);
    const r = new Reader(wTicker.bytes());
    Ticker.decodeFrom(r);
  });
});

describe('framed ticker via router', () => {
  const proto = router(Ticker, Order, Book);
  bench('JSON', () => {
    JSON.parse(JSON.stringify(ticker));
  });
  bench('router encode + decode (framed)', () => {
    proto.decode(proto.encode(ticker, Ticker));
  });
});
