import { bench, describe } from 'vitest';
import { Reader, Writer, deserialize, serialize } from '../../plugin/index.ts';
import {
  buildBook,
  buildOrder,
  buildTicker,
  registerAll,
} from './payloads.ts';

const codecs = registerAll();

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

const tickerBin = serialize(ticker, codecs.ticker);
const orderBin = serialize(order, codecs.order);
const bookBin = serialize(book, codecs.book);

// One-time payload-size print on module load so it appears once in bench output.
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
  bench('codec.encode (pooled)', () => {
    wTicker.reset();
    codecs.ticker.encode(wTicker, ticker);
  });
});

describe('encode order (10 fields + bitset)', () => {
  bench('JSON.stringify', () => {
    JSON.stringify(order);
  });
  bench('codec.encode (pooled)', () => {
    wOrder.reset();
    codecs.order.encode(wOrder, order);
  });
});

describe('encode book (1000 levels)', () => {
  bench('JSON.stringify', () => {
    JSON.stringify(book);
  });
  bench('codec.encode (pooled)', () => {
    wBook.reset();
    codecs.book.encode(wBook, book);
  });
});

describe('decode ticker', () => {
  bench('JSON.parse', () => {
    JSON.parse(tickerJSON);
  });
  bench('codec.decode', () => {
    const r = new Reader(tickerBin);
    r.pos = 2;
    codecs.ticker.decode(r);
  });
});

describe('decode order', () => {
  bench('JSON.parse', () => {
    JSON.parse(orderJSON);
  });
  bench('codec.decode', () => {
    const r = new Reader(orderBin);
    r.pos = 2;
    codecs.order.decode(r);
  });
});

describe('decode book (1000 levels)', () => {
  bench('JSON.parse', () => {
    JSON.parse(bookJSON);
  });
  bench('codec.decode', () => {
    const r = new Reader(bookBin);
    r.pos = 2;
    codecs.book.decode(r);
  });
});

describe('roundtrip ticker', () => {
  bench('JSON', () => {
    JSON.parse(JSON.stringify(ticker));
  });
  bench('codec (pooled)', () => {
    wTicker.reset();
    codecs.ticker.encode(wTicker, ticker);
    const r = new Reader(wTicker.bytes());
    codecs.ticker.decode(r);
  });
});

describe('serialize+deserialize ticker (with frame)', () => {
  bench('JSON', () => {
    JSON.parse(JSON.stringify(ticker));
  });
  bench('serialize/deserialize (framed)', () => {
    deserialize(serialize(ticker, codecs.ticker));
  });
});
