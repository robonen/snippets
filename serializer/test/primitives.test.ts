import { test, expect } from 'vitest';
import { Reader, Writer } from '../plugin/io.ts';

function roundtrip<T>(write: (w: Writer) => void, read: (r: Reader) => T): T {
  const w = new Writer(16);
  write(w);
  return read(new Reader(w.bytes()));
}

test('u8/u16/u32 round-trip with boundary values', () => {
  for (const v of [0, 1, 127, 128, 255]) {
    expect(roundtrip((w) => w.u8(v), (r) => r.u8())).toBe(v);
  }
  for (const v of [0, 1, 0xff, 0x100, 0xffff]) {
    expect(roundtrip((w) => w.u16(v), (r) => r.u16())).toBe(v);
  }
  for (const v of [0, 1, 0xffff, 0x10000, 0xffffffff]) {
    expect(roundtrip((w) => w.u32(v), (r) => r.u32())).toBe(v);
  }
});

test('i16/i32 signed round-trip including negatives', () => {
  for (const v of [-32768, -1, 0, 1, 32767]) {
    expect(roundtrip((w) => w.i16(v), (r) => r.i16())).toBe(v);
  }
  for (const v of [-2147483648, -1, 0, 1, 2147483647]) {
    expect(roundtrip((w) => w.i32(v), (r) => r.i32())).toBe(v);
  }
});

test('f32/f64 round-trip including special values', () => {
  for (const v of [0, -0, 1, -1, 3.14159, Infinity, -Infinity]) {
    expect(roundtrip((w) => w.f64(v), (r) => r.f64())).toBe(v);
  }
  expect(Number.isNaN(roundtrip((w) => w.f64(NaN), (r) => r.f64()))).toBe(true);
  for (const v of [0, 1, -1, 0.5, -0.5, 2.0, 1024, -1024, 0.125]) {
    expect(roundtrip((w) => w.f32(v), (r) => r.f32())).toBe(v);
  }
});

test('varu32 LEB128 round-trip including 5-byte values', () => {
  const cases = [0, 1, 127, 128, 16383, 16384, 0x1fffff, 0x10000000, 0xffffffff];
  for (const v of cases) {
    expect(roundtrip((w) => w.varu32(v), (r) => r.varu32())).toBe(v);
  }
});

test('varu32 byte lengths follow LEB128 spec', () => {
  const sizes: Array<[number, number]> = [
    [0, 1],
    [127, 1],
    [128, 2],
    [16383, 2],
    [16384, 3],
    [0x1fffff, 3],
    [0x200000, 4],
    [0xfffffff, 4],
    [0x10000000, 5],
  ];
  for (const [v, expectedSize] of sizes) {
    const w = new Writer(16);
    w.varu32(v);
    expect(w.pos, `varu32(${v}) should be ${expectedSize} bytes`).toBe(expectedSize);
  }
});

test('vari32 zigzag round-trip', () => {
  const cases = [0, -1, 1, -2, 2, -64, 63, -8192, 8191, -2147483648, 2147483647];
  for (const v of cases) {
    expect(roundtrip((w) => w.vari32(v), (r) => r.vari32())).toBe(v);
  }
});

test('varu53 round-trip up to 2^53', () => {
  const cases = [
    0,
    1,
    127,
    128,
    2 ** 16,
    2 ** 32 - 1,
    2 ** 32,
    2 ** 40,
    Number.MAX_SAFE_INTEGER,
  ];
  for (const v of cases) {
    expect(roundtrip((w) => w.varu53(v), (r) => r.varu53())).toBe(v);
  }
});

test('vari53 round-trip', () => {
  const cases = [
    0,
    -1,
    1,
    -(2 ** 30),
    2 ** 30,
    Number.MIN_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  ];
  for (const v of cases) {
    expect(roundtrip((w) => w.vari53(v), (r) => r.vari53())).toBe(v);
  }
});

test('varbu/varbi bigint round-trip', () => {
  const u: bigint[] = [0n, 1n, 127n, 128n, 1n << 32n, 1n << 63n, (1n << 64n) - 1n];
  for (const v of u) {
    expect(roundtrip((w) => w.varbu(v), (r) => r.varbu())).toBe(v);
  }
  const s: bigint[] = [0n, -1n, 1n, -(1n << 32n), 1n << 32n, -(1n << 63n), (1n << 63n) - 1n];
  for (const v of s) {
    expect(roundtrip((w) => w.varbi(v), (r) => r.varbi())).toBe(v);
  }
});

test('str round-trip ASCII short and long', () => {
  for (const s of ['', 'a', 'hello', 'BTC-USD', 'abcdefghijklmnopqrstuvwxyz']) {
    expect(roundtrip((w) => w.str(s), (r) => r.str())).toBe(s);
  }
  const long = 'x'.repeat(200);
  expect(roundtrip((w) => w.str(long), (r) => r.str())).toBe(long);
});

test('str round-trip non-ASCII', () => {
  for (const s of ['héllo', 'café', '日本語', '🚀', 'mix αβγ 漢字 🎉']) {
    expect(roundtrip((w) => w.str(s), (r) => r.str())).toBe(s);
  }
});

test('bytes round-trip', () => {
  const data = new Uint8Array([1, 2, 3, 4, 255, 0, 128]);
  const result = roundtrip(
    (w) => w.bytesPrefixed(data),
    (r) => r.bytesPrefixed(),
  );
  expect(Array.from(result)).toEqual(Array.from(data));
});

test('Writer grows beyond initial capacity', () => {
  const w = new Writer(4);
  for (let i = 0; i < 1000; i++) w.u8(i & 0xff);
  expect(w.pos).toBe(1000);
  expect(w.buf.byteLength).toBeGreaterThanOrEqual(1000);
});

test('Writer reset reuses buffer', () => {
  const w = new Writer(16);
  w.u32(42);
  const cap1 = w.buf.byteLength;
  w.reset();
  expect(w.pos).toBe(0);
  w.u32(99);
  expect(w.buf.byteLength).toBe(cap1);
});

test('multi-write/multi-read interleaved', () => {
  const w = new Writer(16);
  w.u8(1);
  w.f64(3.14);
  w.str('hi');
  w.varu53(42);

  const r = new Reader(w.bytes());
  expect(r.u8()).toBe(1);
  expect(r.f64()).toBe(3.14);
  expect(r.str()).toBe('hi');
  expect(r.varu53()).toBe(42);
});

test('bool round-trip', () => {
  for (const v of [true, false]) {
    expect(roundtrip((w) => w.bool(v), (r) => r.bool())).toBe(v);
  }
});
