const TE = new TextEncoder();
const TD = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true });

export class Writer {
  buf: Uint8Array;
  view: DataView;
  pos: number;

  constructor(initial = 1024) {
    this.buf = new Uint8Array(initial);
    this.view = new DataView(this.buf.buffer);
    this.pos = 0;
  }

  reset(): void {
    this.pos = 0;
  }

  bytes(): Uint8Array {
    return this.buf.subarray(0, this.pos);
  }

  bytesCopy(): Uint8Array {
    return this.buf.slice(0, this.pos);
  }

  ensure(n: number): void {
    if (this.pos + n > this.buf.byteLength) this.grow(n);
  }

  private grow(n: number): void {
    let next = this.buf.byteLength * 2;
    const need = this.pos + n;
    while (next < need) next *= 2;
    const nb = new Uint8Array(next);
    nb.set(this.buf);
    this.buf = nb;
    this.view = new DataView(nb.buffer);
  }

  u8(v: number): void {
    if (this.pos + 1 > this.buf.byteLength) this.grow(1);
    this.buf[this.pos++] = v;
  }

  u16(v: number): void {
    if (this.pos + 2 > this.buf.byteLength) this.grow(2);
    this.view.setUint16(this.pos, v, true);
    this.pos += 2;
  }

  i16(v: number): void {
    if (this.pos + 2 > this.buf.byteLength) this.grow(2);
    this.view.setInt16(this.pos, v, true);
    this.pos += 2;
  }

  u32(v: number): void {
    if (this.pos + 4 > this.buf.byteLength) this.grow(4);
    this.view.setUint32(this.pos, v, true);
    this.pos += 4;
  }

  i32(v: number): void {
    if (this.pos + 4 > this.buf.byteLength) this.grow(4);
    this.view.setInt32(this.pos, v, true);
    this.pos += 4;
  }

  f32(v: number): void {
    if (this.pos + 4 > this.buf.byteLength) this.grow(4);
    this.view.setFloat32(this.pos, v, true);
    this.pos += 4;
  }

  f64(v: number): void {
    if (this.pos + 8 > this.buf.byteLength) this.grow(8);
    this.view.setFloat64(this.pos, v, true);
    this.pos += 8;
  }

  bool(v: boolean): void {
    if (this.pos + 1 > this.buf.byteLength) this.grow(1);
    this.buf[this.pos++] = v ? 1 : 0;
  }

  varu32(v: number): void {
    if (this.pos + 5 > this.buf.byteLength) this.grow(5);
    while (v >= 0x80) {
      this.buf[this.pos++] = (v & 0x7f) | 0x80;
      v >>>= 7;
    }
    this.buf[this.pos++] = v;
  }

  vari32(v: number): void {
    const z = ((v << 1) ^ (v >> 31)) >>> 0;
    this.varu32(z);
  }

  varu53(v: number): void {
    if (this.pos + 10 > this.buf.byteLength) this.grow(10);
    while (v >= 0x80) {
      this.buf[this.pos++] = (v & 0x7f) | 0x80;
      v = Math.floor(v / 128);
    }
    this.buf[this.pos++] = v;
  }

  vari53(v: number): void {
    const z = v >= 0 ? BigInt(v) * 2n : -BigInt(v) * 2n - 1n;
    this.varbu(z);
  }

  varbu(v: bigint): void {
    if (this.pos + 10 > this.buf.byteLength) this.grow(10);
    while (v >= 0x80n) {
      this.buf[this.pos++] = Number(v & 0x7fn) | 0x80;
      v >>= 7n;
    }
    this.buf[this.pos++] = Number(v);
  }

  varbi(v: bigint): void {
    const z = v >= 0n ? v << 1n : (-v << 1n) - 1n;
    this.varbu(z);
  }

  raw(src: Uint8Array): void {
    if (this.pos + src.length > this.buf.byteLength) this.grow(src.length);
    this.buf.set(src, this.pos);
    this.pos += src.length;
  }

  bytesPrefixed(src: Uint8Array): void {
    this.varu53(src.length);
    this.raw(src);
  }

  str(s: string): void {
    const len = s.length;
    if (len === 0) {
      this.u8(0);
      return;
    }

    if (len < 64) {
      if (this.pos + len + 5 > this.buf.byteLength) this.grow(len + 5);
      let allAscii = true;
      for (let i = 0; i < len; i++) {
        if (s.charCodeAt(i) > 127) {
          allAscii = false;
          break;
        }
      }
      if (allAscii) {
        let p = this.pos;
        let lv = len;
        while (lv >= 0x80) {
          this.buf[p++] = (lv & 0x7f) | 0x80;
          lv >>>= 7;
        }
        this.buf[p++] = lv;
        for (let i = 0; i < len; i++) this.buf[p++] = s.charCodeAt(i);
        this.pos = p;
        return;
      }
    }

    const maxBytes = len * 3;
    if (this.pos + maxBytes + 5 > this.buf.byteLength) this.grow(maxBytes + 5);
    const dst = this.buf.subarray(this.pos + 5);
    const { written } = TE.encodeInto(s, dst);
    const w = written ?? 0;

    let lenBytes = 1;
    let lv = w;
    while (lv >= 0x80) {
      lenBytes++;
      lv >>>= 7;
    }

    if (lenBytes < 5 && w > 0) {
      this.buf.copyWithin(this.pos + lenBytes, this.pos + 5, this.pos + 5 + w);
    }

    let p = this.pos;
    lv = w;
    while (lv >= 0x80) {
      this.buf[p++] = (lv & 0x7f) | 0x80;
      lv >>>= 7;
    }
    this.buf[p++] = lv;
    this.pos = p + w;
  }
}

export class Reader {
  buf: Uint8Array;
  view: DataView;
  pos: number;
  end: number;

  constructor(buf: Uint8Array) {
    this.buf = buf;
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    this.pos = 0;
    this.end = buf.byteLength;
  }

  reset(buf: Uint8Array): void {
    this.buf = buf;
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    this.pos = 0;
    this.end = buf.byteLength;
  }

  remaining(): number {
    return this.end - this.pos;
  }

  u8(): number {
    return this.buf[this.pos++]!;
  }

  u16(): number {
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  i16(): number {
    const v = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }

  u32(): number {
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  i32(): number {
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }

  f32(): number {
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }

  f64(): number {
    const v = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }

  bool(): boolean {
    return this.buf[this.pos++] !== 0;
  }

  varu32(): number {
    let v = 0;
    let shift = 0;
    let byte = 0;
    do {
      byte = this.buf[this.pos++]!;
      v |= (byte & 0x7f) << shift;
      shift += 7;
    } while (byte & 0x80);
    return v >>> 0;
  }

  vari32(): number {
    const z = this.varu32();
    return (z >>> 1) ^ -(z & 1);
  }

  varu53(): number {
    let v = 0;
    let mult = 1;
    let byte = 0;
    do {
      byte = this.buf[this.pos++]!;
      v += (byte & 0x7f) * mult;
      mult *= 128;
    } while (byte & 0x80);
    return v;
  }

  vari53(): number {
    const z = this.varbu();
    const v = (z & 1n) === 0n ? z >> 1n : -((z >> 1n) + 1n);
    return Number(v);
  }

  varbu(): bigint {
    let v = 0n;
    let shift = 0n;
    let byte = 0;
    do {
      byte = this.buf[this.pos++]!;
      v |= BigInt(byte & 0x7f) << shift;
      shift += 7n;
    } while (byte & 0x80);
    return v;
  }

  varbi(): bigint {
    const z = this.varbu();
    return (z & 1n) === 0n ? z >> 1n : -((z >> 1n) + 1n);
  }

  bytes(n: number): Uint8Array {
    const slice = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return slice;
  }

  bytesPrefixed(): Uint8Array {
    const n = this.varu53();
    return this.bytes(n);
  }

  str(): string {
    const len = this.varu53();
    if (len === 0) return '';
    const start = this.pos;
    const end = start + len;
    const buf = this.buf;

    if (len < 32) {
      let allAscii = true;
      for (let i = start; i < end; i++) {
        if (buf[i]! > 127) {
          allAscii = false;
          break;
        }
      }
      if (allAscii) {
        let s = '';
        for (let i = start; i < end; i++) {
          s += String.fromCharCode(buf[i]!);
        }
        this.pos = end;
        return s;
      }
    }

    const slice = buf.subarray(start, end);
    this.pos = end;
    return TD.decode(slice);
  }
}
