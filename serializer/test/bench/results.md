# Benchmark results

Hardware: Intel Xeon (Icelake) @ 2.46 GHz, Windows Server 2019
Runtime: Node.js 24.14.0 (x64)
Tool: mitata
Date: 2026-05-21

Reproduce: `npm run bench` from the `serializer/` directory. Numbers below use the avg (the p75 column where they diverge).

## Payload sizes

| Workload | JSON bytes | Binary bytes | Binary/JSON ratio |
|---|---:|---:|---:|
| Ticker (5 fields) | 82 | 42 | **0.51** |
| Order (10 fields + bitset) | 203 | 52 | **0.26** |
| Book snapshot (1000 levels) | 48,577 | 32,020 | **0.66** |

## Encode (lower is better)

| Workload | JSON.stringify | codec.encode (pooled) | Speedup vs JSON |
|---|---:|---:|---:|
| Ticker | 598.4 ns | **52.2 ns** | **11.5×** |
| Order | 1,170 ns | **123.4 ns** | **9.5×** |
| Book (1000 levels) | 437 µs | **10.2 µs** | **42.9×** |

## Decode (lower is better)

| Workload | JSON.parse | codec.decode | Speedup vs JSON |
|---|---:|---:|---:|
| Ticker | 696.3 ns | **311.0 ns** | **2.2×** |
| Order | 1,440 ns | **360.6 ns** | **4.0×** |
| Book (1000 levels) | 497 µs | **24–28 µs** (high GC variance) | **17–20×** |

## Roundtrip

| | ns/iter | Note |
|---|---:|---|
| `JSON.parse(JSON.stringify(...))` | 1,400 ns | baseline |
| Pooled codec encode + Reader decode | **418 ns** | **3.35× faster** |
| Un-pooled `serialize` + `deserialize` (framed) | 2,180 ns | 1.55× slower |

The un-pooled `serialize()` allocates a fresh Writer + DataView + Uint8Array on every call. Hot paths must pool a Writer.

## What changed vs v1 baseline

The v1 codec used method-call style for every operation: every `w.f64(v)` was a method dispatch with internal property reads on `this.buf`, `this.view`, `this.pos`. The optimized codec restructures the generated functions around four V8-friendly patterns:

| # | Optimization | Effect |
|---|---|---|
| 1 | Lift `pos`, `buf`, `view` to function-local `let/const` at start; sync `w.pos = pos` at end | Replaces N×3 property loads with N register reads |
| 2 | Inline all bounded-size ops (`u8`–`f64`, `bool`, varints, `enum`, `bitset`) using the lifted locals | Eliminates the method-call cost per primitive |
| 3 | Pre-`ensure` for the bounded prefix of each schema in a single bounds check | One growth check per ~10 fields instead of one per field |
| 4 | Inline nested objects/arrays/unions/tuples — no per-element function dispatch | Tight inner loops for array<object> (e.g., order book levels) |
| 5 | Closure-captured frozen map for `enum` with ≥4 values; ternary chain for 2–3 | Avoids string-switch overhead |
| 6 | For array elements that are themselves bounded, pre-`ensure(L * elementMax)` once outside the loop, then run a loop with no per-iteration ensure | Order-book encode goes from method-per-level to inline-per-level |

Unbounded leaves (`str`, `bytes`, `typedArray`, `ref`, `codec`) still go through the Writer/Reader methods, with a small sync/refetch dance around the call.

## Before / after (v1 baseline → v2 optimized, both avg ns)

| Workload | v1 baseline | v2 optimized | Improvement |
|---|---:|---:|---:|
| Ticker encode | 77.4 ns | **52.2 ns** | **1.48×** |
| Order encode | 130.4 ns | **123.4 ns** | 1.06× |
| Book encode | 27.9 µs | **10.2 µs** | **2.73×** |
| Ticker decode | 308.4 ns | 311.0 ns | ~same |
| Order decode | 368.3 ns | 360.6 ns | ~same |
| Book decode | 26.1 µs | 24.4 µs (p75) | 1.07× |

The decode side gains less than encode because Node's `JSON.parse` was already not the bottleneck — most of the decode time goes to allocating the result object and the string for `symbol`/`reason` fields, which the codec also has to do.

The book encode at **2.7× faster than v1 baseline (43× faster than JSON.stringify)** is the headline number: inlining the per-level encoder into the outer loop turned 1000 function calls per snapshot into 1000 inline `view.setFloat64(pos, ...)` pairs sharing one `ensure()`.

## What didn't pan out

We tried `String.fromCharCode.apply(null, buf.subarray(start, end))` for ASCII strings in the 8–64 char range. On Node 24 it was consistently slower than the simple `s += String.fromCharCode(buf[i])` loop for the short strings dominating exchange payloads — the variadic-args wrapper has its own overhead. Reverted.

## Generated source — example

For the Ticker schema (after optimization), the encoder body produced by codegen is:

```js
function encode_BenchTicker(w, o) {
  let pos = w.pos;
  let buf = w.buf;
  let view = w.view;

  if (pos + 33 > buf.byteLength) {
    w.pos = pos; w.grow(33); buf = w.buf; view = w.view;
  }
  // varu53 symbol-length and 4 × f64 are bounded, but the str body itself isn't:
  // (the str field flushes the bounded prefix, calls w.str, then refetches)

  w.pos = pos; w.str(o["symbol"]); pos = w.pos; buf = w.buf; view = w.view;

  if (pos + 32 > buf.byteLength) {
    w.pos = pos; w.grow(32); buf = w.buf; view = w.view;
  }
  view.setFloat64(pos, o["last"], true);   pos += 8;
  view.setFloat64(pos, o["bid"], true);    pos += 8;
  view.setFloat64(pos, o["ask"], true);    pos += 8;
  view.setFloat64(pos, o["volume"], true); pos += 8;

  w.pos = pos;
}
```

No `this.` indirections, no method dispatch for the floats, one ensure for the 4-float run. The result is **52 ns per Ticker encode**, ~12× faster than `JSON.stringify`.

## Acceptance bar (from plan)

| Target | Actual | Status |
|---|---|---|
| Encode ≥ 3× faster than JSON.stringify on medium-order workload | 9.5× | exceeded |
| Decode ≥ 5× faster than JSON.parse on order-book workload | 17–20× | exceeded |
| Payload ≤ 60% of JSON byte length on numeric-heavy data | 26% (Order) / 66% (Book) | partial (Book is f64-dense, little to compress) |
| Zero deopt events on hot benchmark loop | one-time OSR transition only | acceptable |
