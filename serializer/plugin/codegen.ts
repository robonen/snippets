import type {
  AnySchema,
  ObjectSchema,
  TypedArrayKind,
  UnionSchema,
} from './descriptors.ts';

export interface CodegenResult {
  /** Inner-function body for encoder: takes (w, o), uses lifted pos/buf/view locals. */
  encodeBody: string;
  /** Inner-function body for decoder: takes (r), uses lifted pos/buf/view locals. */
  decodeBody: string;
  /** Cross-codec dependencies for ref/codec fields only (nested objects are inlined). */
  deps: Map<string, { mode: 'enc' | 'dec'; targetName: string }>;
  /** Closure-captured values (enum maps, codec functions). */
  closure: Map<string, unknown>;
}

function sanitize(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, '_');
}

const TA_ELEM_SIZE: Record<TypedArrayKind, number> = {
  f32Array: 4,
  f64Array: 8,
  u8Array: 1,
  u16Array: 2,
  u32Array: 4,
  i32Array: 4,
};

const TA_CTOR: Record<TypedArrayKind, string> = {
  f32Array: 'Float32Array',
  f64Array: 'Float64Array',
  u8Array: 'Uint8Array',
  u16Array: 'Uint16Array',
  u32Array: 'Uint32Array',
  i32Array: 'Int32Array',
};

function isTypedArrayKind(k: string): k is TypedArrayKind {
  return k in TA_ELEM_SIZE;
}

/**
 * Upper bound on bytes the schema may write, or null when truly variable
 * (str, bytes, array, typed-array, ref, codec, and any composite containing them).
 */
function maxBytes(schema: AnySchema): number | null {
  switch (schema.kind) {
    case 'u8':
    case 'i8':
    case 'bool':
    case 'enum':
      return 1;
    case 'u16':
    case 'i16':
      return 2;
    case 'u32':
    case 'i32':
    case 'f32':
      return 4;
    case 'f64':
      return 8;
    case 'u53':
    case 'i53':
    case 'u64':
    case 'i64':
      return 10;
    case 'bitset': {
      const n = schema.flags.length;
      return n <= 8 ? 1 : n <= 16 ? 2 : n <= 32 ? 4 : 10;
    }
    case 'tuple': {
      let sum = 0;
      for (const e of schema.elems) {
        const m = maxBytes(e);
        if (m === null) return null;
        sum += m;
      }
      return sum;
    }
    case 'object': {
      let sum = 0;
      for (const f of Object.values(schema.fields)) {
        const m = maxBytes(f);
        if (m === null) return null;
        sum += m;
      }
      return sum;
    }
    case 'optional': {
      const m = maxBytes(schema.elem);
      return m === null ? null : 1 + m;
    }
    case 'union': {
      let max = 0;
      for (const v of Object.values(schema.variants)) {
        const m = maxBytes(v);
        if (m === null) return null;
        if (m > max) max = m;
      }
      return 1 + max;
    }
    case 'array':
    case 'str':
    case 'bytes':
    case 'ref':
    case 'codec':
      return null;
  }
  return null;
}

class Ctx {
  private counter = 0;
  mode: 'enc' | 'dec';
  deps = new Map<string, { mode: 'enc' | 'dec'; targetName: string }>();
  closure = new Map<string, unknown>();

  constructor(mode: 'enc' | 'dec') {
    this.mode = mode;
  }

  fresh(prefix: string): string {
    return `_${prefix}${++this.counter}`;
  }

  closureVar(prefix: string, value: unknown): string {
    const name = `__cv_${prefix}_${++this.counter}`;
    this.closure.set(name, value);
    return name;
  }
}

/**
 * Builds an encoder body. Bounded ops are buffered with a running budget;
 * unbounded ops (str, array, ref, etc.) flush the buffer with a single
 * `ensure(budget)` then emit themselves. Inside arrays with bounded elements,
 * we pre-ensure the whole batch and run the element loop in "noEnsure" mode.
 */
class SegBuilder {
  private buffered: string[] = [];
  private budget = 0;
  private output: string[] = [];
  noEnsure = false;

  addBounded(stmt: string, maxBytesSize: number): void {
    if (this.noEnsure) {
      this.output.push(stmt);
      return;
    }
    this.buffered.push(stmt);
    this.budget += maxBytesSize;
  }

  addPrelude(stmt: string): void {
    if (this.noEnsure) {
      this.output.push(stmt);
      return;
    }
    this.buffered.push(stmt);
  }

  flush(): void {
    if (this.buffered.length === 0) return;
    if (this.budget > 0 && !this.noEnsure) {
      this.output.push(
        `if (pos + ${this.budget} > buf.byteLength) { w.pos = pos; w.grow(${this.budget}); buf = w.buf; view = w.view; }`,
      );
    }
    this.output.push(...this.buffered);
    this.buffered = [];
    this.budget = 0;
  }

  addUnbounded(stmt: string): void {
    this.flush();
    this.output.push(stmt);
  }

  build(): string {
    this.flush();
    return this.output.join('\n');
  }
}

function emitEnc(schema: AnySchema, ctx: Ctx, seg: SegBuilder, vx: string): void {
  switch (schema.kind) {
    case 'u8':
      seg.addBounded(`buf[pos++] = (${vx}) & 0xff;`, 1);
      return;
    case 'i8':
      seg.addBounded(`buf[pos++] = (${vx}) & 0xff;`, 1);
      return;
    case 'bool':
      seg.addBounded(`buf[pos++] = ${vx} ? 1 : 0;`, 1);
      return;
    case 'u16':
      seg.addBounded(`view.setUint16(pos, ${vx}, true); pos += 2;`, 2);
      return;
    case 'i16':
      seg.addBounded(`view.setInt16(pos, ${vx}, true); pos += 2;`, 2);
      return;
    case 'u32':
      seg.addBounded(`view.setUint32(pos, ${vx}, true); pos += 4;`, 4);
      return;
    case 'i32':
      seg.addBounded(`view.setInt32(pos, ${vx}, true); pos += 4;`, 4);
      return;
    case 'f32':
      seg.addBounded(`view.setFloat32(pos, ${vx}, true); pos += 4;`, 4);
      return;
    case 'f64':
      seg.addBounded(`view.setFloat64(pos, ${vx}, true); pos += 8;`, 8);
      return;
    case 'u53': {
      const v = ctx.fresh('v');
      seg.addBounded(
        `{ let ${v} = ${vx}; while (${v} >= 0x80) { buf[pos++] = (${v} & 0x7f) | 0x80; ${v} = Math.floor(${v} / 128); } buf[pos++] = ${v}; }`,
        10,
      );
      return;
    }
    case 'i53': {
      const v = ctx.fresh('v');
      const src = ctx.fresh('s');
      seg.addBounded(
        `{ const ${src} = ${vx}; let ${v} = ${src} >= 0 ? BigInt(${src}) * 2n : -BigInt(${src}) * 2n - 1n; while (${v} >= 0x80n) { buf[pos++] = Number(${v} & 0x7fn) | 0x80; ${v} >>= 7n; } buf[pos++] = Number(${v}); }`,
        10,
      );
      return;
    }
    case 'u64': {
      const v = ctx.fresh('v');
      seg.addBounded(
        `{ let ${v} = ${vx}; while (${v} >= 0x80n) { buf[pos++] = Number(${v} & 0x7fn) | 0x80; ${v} >>= 7n; } buf[pos++] = Number(${v}); }`,
        10,
      );
      return;
    }
    case 'i64': {
      const v = ctx.fresh('v');
      const src = ctx.fresh('s');
      seg.addBounded(
        `{ const ${src} = ${vx}; let ${v} = ${src} >= 0n ? ${src} << 1n : (-${src} << 1n) - 1n; while (${v} >= 0x80n) { buf[pos++] = Number(${v} & 0x7fn) | 0x80; ${v} >>= 7n; } buf[pos++] = Number(${v}); }`,
        10,
      );
      return;
    }
    case 'enum': {
      const vals = schema.values;
      if (vals.length === 2) {
        seg.addBounded(`buf[pos++] = ${vx} === ${JSON.stringify(vals[0])} ? 0 : 1;`, 1);
      } else if (vals.length === 3) {
        seg.addBounded(
          `buf[pos++] = ${vx} === ${JSON.stringify(vals[0])} ? 0 : ${vx} === ${JSON.stringify(vals[1])} ? 1 : 2;`,
          1,
        );
      } else {
        const map: Record<string, number> = Object.create(null);
        for (let i = 0; i < vals.length; i++) map[vals[i]!] = i;
        const cv = ctx.closureVar('enum', Object.freeze(map));
        seg.addBounded(`buf[pos++] = ${cv}[${vx}];`, 1);
      }
      return;
    }
    case 'bitset': {
      const b = ctx.fresh('b');
      const flags = schema.flags;
      if (flags.length <= 32) {
        const parts: string[] = ['0'];
        for (let i = 0; i < flags.length; i++) {
          parts.push(`((${b})[${JSON.stringify(flags[i])}] ? ${1 << i} : 0)`);
        }
        const expr = parts.join(' | ');
        if (flags.length <= 8) {
          seg.addBounded(`{ const ${b} = ${vx}; buf[pos++] = ${expr}; }`, 1);
        } else if (flags.length <= 16) {
          seg.addBounded(`{ const ${b} = ${vx}; view.setUint16(pos, ${expr}, true); pos += 2; }`, 2);
        } else {
          seg.addBounded(`{ const ${b} = ${vx}; view.setUint32(pos, ${expr}, true); pos += 4; }`, 4);
        }
      } else {
        let big = '0n';
        for (let i = 0; i < flags.length; i++) {
          big = `(${big}) | ((${b})[${JSON.stringify(flags[i])}] ? ${1n << BigInt(i)}n : 0n)`;
        }
        const v = ctx.fresh('v');
        seg.addBounded(
          `{ const ${b} = ${vx}; let ${v} = ${big}; while (${v} >= 0x80n) { buf[pos++] = Number(${v} & 0x7fn) | 0x80; ${v} >>= 7n; } buf[pos++] = Number(${v}); }`,
          10,
        );
      }
      return;
    }
    case 'str': {
      seg.addUnbounded(
        `w.pos = pos; w.str(${vx}); pos = w.pos; buf = w.buf; view = w.view;`,
      );
      return;
    }
    case 'bytes': {
      seg.addUnbounded(
        `w.pos = pos; w.bytesPrefixed(${vx}); pos = w.pos; buf = w.buf; view = w.view;`,
      );
      return;
    }
    case 'tuple': {
      const t = ctx.fresh('t');
      seg.addPrelude(`const ${t} = ${vx};`);
      for (let i = 0; i < schema.elems.length; i++) {
        emitEnc(schema.elems[i]!, ctx, seg, `${t}[${i}]`);
      }
      return;
    }
    case 'optional': {
      const o = ctx.fresh('o');
      const innerMax = maxBytes(schema.elem);
      if (innerMax !== null) {
        const innerSeg = new SegBuilder();
        innerSeg.noEnsure = true;
        emitEnc(schema.elem, ctx, innerSeg, o);
        const innerSrc = innerSeg.build();
        seg.addBounded(
          `{ const ${o} = ${vx}; if (${o} === undefined || ${o} === null) { buf[pos++] = 0; } else { buf[pos++] = 1; ${innerSrc} } }`,
          1 + innerMax,
        );
      } else {
        const innerSeg = new SegBuilder();
        emitEnc(schema.elem, ctx, innerSeg, o);
        const innerSrc = innerSeg.build();
        seg.addUnbounded(
          `{ const ${o} = ${vx}; if (pos + 1 > buf.byteLength) { w.pos = pos; w.grow(1); buf = w.buf; view = w.view; } if (${o} === undefined || ${o} === null) { buf[pos++] = 0; } else { buf[pos++] = 1; ${innerSrc} } }`,
        );
      }
      return;
    }
    case 'object': {
      const oo = ctx.fresh('oo');
      seg.addPrelude(`const ${oo} = ${vx};`);
      for (const fname of Object.keys(schema.fields)) {
        emitEnc(schema.fields[fname]!, ctx, seg, `${oo}[${JSON.stringify(fname)}]`);
      }
      return;
    }
    case 'union': {
      const u = ctx.fresh('u');
      const disc = JSON.stringify(schema.discriminator);
      const keys = Object.keys(schema.variants);
      const cases: string[] = [];
      for (let i = 0; i < keys.length; i++) {
        const variant = schema.variants[keys[i]!]!;
        const innerSeg = new SegBuilder();
        innerSeg.addBounded(`buf[pos++] = ${i};`, 1);
        for (const fname of Object.keys(variant.fields)) {
          emitEnc(variant.fields[fname]!, ctx, innerSeg, `${u}[${JSON.stringify(fname)}]`);
        }
        cases.push(`case ${JSON.stringify(keys[i])}: { ${innerSeg.build()} break; }`);
      }
      seg.addUnbounded(
        `{ const ${u} = ${vx}; switch (${u}[${disc}]) { ${cases.join('\n')} default: throw new Error('Bad union variant: ' + ${u}[${disc}]); } }`,
      );
      return;
    }
    case 'array': {
      const arr = ctx.fresh('arr');
      const L = ctx.fresh('L');
      const i = ctx.fresh('i');
      const elemMax = maxBytes(schema.elem);

      seg.addPrelude(`const ${arr} = ${vx}; const ${L} = ${arr}.length;`);
      const vL = ctx.fresh('vL');
      seg.addBounded(
        `{ let ${vL} = ${L}; while (${vL} >= 0x80) { buf[pos++] = (${vL} & 0x7f) | 0x80; ${vL} = Math.floor(${vL} / 128); } buf[pos++] = ${vL}; }`,
        10,
      );

      if (elemMax !== null) {
        seg.addUnbounded(
          `if (pos + ${L} * ${elemMax} > buf.byteLength) { w.pos = pos; w.grow(${L} * ${elemMax}); buf = w.buf; view = w.view; }`,
        );
        const elemSeg = new SegBuilder();
        elemSeg.noEnsure = true;
        emitEnc(schema.elem, ctx, elemSeg, `${arr}[${i}]`);
        const elemSrc = elemSeg.build();
        seg.addUnbounded(`for (let ${i} = 0; ${i} < ${L}; ${i}++) { ${elemSrc} }`);
      } else {
        const elemSeg = new SegBuilder();
        emitEnc(schema.elem, ctx, elemSeg, `${arr}[${i}]`);
        const elemSrc = elemSeg.build();
        seg.addUnbounded(`for (let ${i} = 0; ${i} < ${L}; ${i}++) { ${elemSrc} }`);
      }
      return;
    }
    case 'ref': {
      const resolved = schema.thunk();
      const dep = `__enc_${sanitize(resolved.name)}`;
      ctx.deps.set(dep, { mode: 'enc', targetName: resolved.name });
      seg.addUnbounded(
        `w.pos = pos; ${dep}(w, ${vx}); pos = w.pos; buf = w.buf; view = w.view;`,
      );
      return;
    }
    case 'codec': {
      const cv = ctx.closureVar('codec_enc', schema.encode);
      seg.addUnbounded(
        `w.pos = pos; ${cv}(w, ${vx}); pos = w.pos; buf = w.buf; view = w.view;`,
      );
      return;
    }
  }
  if (isTypedArrayKind(schema.kind)) {
    const ta = ctx.fresh('ta');
    seg.addUnbounded(
      `{ const ${ta} = ${vx}; w.pos = pos; w.varu53(${ta}.length); w.raw(new Uint8Array(${ta}.buffer, ${ta}.byteOffset, ${ta}.byteLength)); pos = w.pos; buf = w.buf; view = w.view; }`,
    );
    return;
  }
  throw new Error(`emitEnc: unknown kind ${(schema as { kind: string }).kind}`);
}

function emitDec(schema: AnySchema, ctx: Ctx): { pre: string; expr: string } {
  switch (schema.kind) {
    case 'u8':
      return { pre: '', expr: 'buf[pos++]' };
    case 'i8':
      return { pre: '', expr: '(buf[pos++] << 24 >> 24)' };
    case 'bool':
      return { pre: '', expr: '(buf[pos++] !== 0)' };
    case 'u16': {
      const v = ctx.fresh('v');
      return { pre: `const ${v} = view.getUint16(pos, true); pos += 2;`, expr: v };
    }
    case 'i16': {
      const v = ctx.fresh('v');
      return { pre: `const ${v} = view.getInt16(pos, true); pos += 2;`, expr: v };
    }
    case 'u32': {
      const v = ctx.fresh('v');
      return { pre: `const ${v} = view.getUint32(pos, true); pos += 4;`, expr: v };
    }
    case 'i32': {
      const v = ctx.fresh('v');
      return { pre: `const ${v} = view.getInt32(pos, true); pos += 4;`, expr: v };
    }
    case 'f32': {
      const v = ctx.fresh('v');
      return { pre: `const ${v} = view.getFloat32(pos, true); pos += 4;`, expr: v };
    }
    case 'f64': {
      const v = ctx.fresh('v');
      return { pre: `const ${v} = view.getFloat64(pos, true); pos += 8;`, expr: v };
    }
    case 'u53': {
      const v = ctx.fresh('v');
      const vv = ctx.fresh('vv');
      const m = ctx.fresh('m');
      const b = ctx.fresh('b');
      return {
        pre: `let ${v}; { let ${vv} = 0, ${m} = 1, ${b}; do { ${b} = buf[pos++]; ${vv} += (${b} & 0x7f) * ${m}; ${m} *= 128; } while (${b} & 0x80); ${v} = ${vv}; }`,
        expr: v,
      };
    }
    case 'i53': {
      const v = ctx.fresh('v');
      const vv = ctx.fresh('vv');
      const sh = ctx.fresh('sh');
      const b = ctx.fresh('b');
      return {
        pre: `let ${v}; { let ${vv} = 0n, ${sh} = 0n, ${b}; do { ${b} = buf[pos++]; ${vv} |= BigInt(${b} & 0x7f) << ${sh}; ${sh} += 7n; } while (${b} & 0x80); const _z = (${vv} & 1n) === 0n ? ${vv} >> 1n : -((${vv} >> 1n) + 1n); ${v} = Number(_z); }`,
        expr: v,
      };
    }
    case 'u64': {
      const v = ctx.fresh('v');
      const vv = ctx.fresh('vv');
      const sh = ctx.fresh('sh');
      const b = ctx.fresh('b');
      return {
        pre: `let ${v}; { let ${vv} = 0n, ${sh} = 0n, ${b}; do { ${b} = buf[pos++]; ${vv} |= BigInt(${b} & 0x7f) << ${sh}; ${sh} += 7n; } while (${b} & 0x80); ${v} = ${vv}; }`,
        expr: v,
      };
    }
    case 'i64': {
      const v = ctx.fresh('v');
      const vv = ctx.fresh('vv');
      const sh = ctx.fresh('sh');
      const b = ctx.fresh('b');
      return {
        pre: `let ${v}; { let ${vv} = 0n, ${sh} = 0n, ${b}; do { ${b} = buf[pos++]; ${vv} |= BigInt(${b} & 0x7f) << ${sh}; ${sh} += 7n; } while (${b} & 0x80); ${v} = (${vv} & 1n) === 0n ? ${vv} >> 1n : -((${vv} >> 1n) + 1n); }`,
        expr: v,
      };
    }
    case 'enum': {
      const vals = schema.values;
      if (vals.length <= 2) {
        return {
          pre: '',
          expr: `(buf[pos++] === 0 ? ${JSON.stringify(vals[0])} : ${JSON.stringify(vals[1])})`,
        };
      } else if (vals.length === 3) {
        const v = ctx.fresh('v');
        const t = ctx.fresh('t');
        return {
          pre: `let ${v}; { const ${t} = buf[pos++]; ${v} = ${t} === 0 ? ${JSON.stringify(vals[0])} : ${t} === 1 ? ${JSON.stringify(vals[1])} : ${JSON.stringify(vals[2])}; }`,
          expr: v,
        };
      } else {
        const cv = ctx.closureVar('enum_dec', Object.freeze(vals.slice()));
        return { pre: '', expr: `${cv}[buf[pos++]]` };
      }
    }
    case 'bitset': {
      const v = ctx.fresh('v');
      const raw = ctx.fresh('raw');
      const flags = schema.flags;
      let rawDecl: string;
      let isBig = false;
      if (flags.length <= 8) {
        rawDecl = `const ${raw} = buf[pos++];`;
      } else if (flags.length <= 16) {
        rawDecl = `const ${raw} = view.getUint16(pos, true); pos += 2;`;
      } else if (flags.length <= 32) {
        rawDecl = `const ${raw} = view.getUint32(pos, true); pos += 4;`;
      } else {
        isBig = true;
        const vv = ctx.fresh('vv');
        const sh = ctx.fresh('sh');
        const b = ctx.fresh('b');
        rawDecl = `let ${raw}; { let ${vv} = 0n, ${sh} = 0n, ${b}; do { ${b} = buf[pos++]; ${vv} |= BigInt(${b} & 0x7f) << ${sh}; ${sh} += 7n; } while (${b} & 0x80); ${raw} = ${vv}; }`;
      }
      const props: string[] = [];
      for (let i = 0; i < flags.length; i++) {
        if (isBig) {
          props.push(`${JSON.stringify(flags[i])}: (${raw} & ${1n << BigInt(i)}n) !== 0n`);
        } else {
          props.push(`${JSON.stringify(flags[i])}: (${raw} & ${1 << i}) !== 0`);
        }
      }
      return {
        pre: `${rawDecl} const ${v} = { ${props.join(', ')} };`,
        expr: v,
      };
    }
    case 'str': {
      const v = ctx.fresh('v');
      return {
        pre: `r.pos = pos; const ${v} = r.str(); pos = r.pos;`,
        expr: v,
      };
    }
    case 'bytes': {
      const v = ctx.fresh('v');
      return {
        pre: `r.pos = pos; const ${v} = r.bytesPrefixed(); pos = r.pos;`,
        expr: v,
      };
    }
    case 'tuple': {
      let pre = '';
      const exprs: string[] = [];
      for (const elem of schema.elems) {
        const inner = emitDec(elem, ctx);
        if (inner.pre === '') {
          exprs.push(inner.expr);
        } else {
          const tmp = ctx.fresh('tupv');
          pre += `${inner.pre} const ${tmp} = ${inner.expr};`;
          exprs.push(tmp);
        }
      }
      const tup = ctx.fresh('tup');
      return { pre: `${pre} const ${tup} = [${exprs.join(', ')}];`, expr: tup };
    }
    case 'optional': {
      const v = ctx.fresh('opt');
      const inner = emitDec(schema.elem, ctx);
      return {
        pre: `let ${v} = undefined; if (buf[pos++] !== 0) { ${inner.pre} ${v} = ${inner.expr}; }`,
        expr: v,
      };
    }
    case 'object': {
      let pre = '';
      const props: string[] = [];
      for (const fname of Object.keys(schema.fields)) {
        const inner = emitDec(schema.fields[fname]!, ctx);
        const tmp = ctx.fresh(`f_${sanitize(fname)}`);
        pre += `${inner.pre} const ${tmp} = ${inner.expr};`;
        props.push(`${JSON.stringify(fname)}: ${tmp}`);
      }
      const obj = ctx.fresh('obj');
      return { pre: `${pre} const ${obj} = { ${props.join(', ')} };`, expr: obj };
    }
    case 'union': {
      const v = ctx.fresh('un');
      const disc = JSON.stringify(schema.discriminator);
      const keys = Object.keys(schema.variants);
      const cases: string[] = [];
      for (let i = 0; i < keys.length; i++) {
        const variant = schema.variants[keys[i]!]!;
        let varPre = '';
        const props: string[] = [`${disc}: ${JSON.stringify(keys[i])}`];
        for (const fname of Object.keys(variant.fields)) {
          const inner = emitDec(variant.fields[fname]!, ctx);
          if (inner.pre === '') {
            props.push(`${JSON.stringify(fname)}: ${inner.expr}`);
          } else {
            const tmp = ctx.fresh('uv');
            varPre += `${inner.pre} const ${tmp} = ${inner.expr};`;
            props.push(`${JSON.stringify(fname)}: ${tmp}`);
          }
        }
        cases.push(`case ${i}: { ${varPre} ${v} = { ${props.join(', ')} }; break; }`);
      }
      return {
        pre: `let ${v}; switch (buf[pos++]) { ${cases.join(' ')} default: throw new Error('Bad union tag'); }`,
        expr: v,
      };
    }
    case 'array': {
      const a = ctx.fresh('arr');
      const L = ctx.fresh('len');
      const i = ctx.fresh('i');
      const vv = ctx.fresh('vv');
      const m = ctx.fresh('m');
      const b = ctx.fresh('b');
      const elem = emitDec(schema.elem, ctx);
      const lenRead = `let ${L}; { let ${vv} = 0, ${m} = 1, ${b}; do { ${b} = buf[pos++]; ${vv} += (${b} & 0x7f) * ${m}; ${m} *= 128; } while (${b} & 0x80); ${L} = ${vv}; }`;
      return {
        pre: `${lenRead} const ${a} = new Array(${L}); for (let ${i} = 0; ${i} < ${L}; ${i}++) { ${elem.pre} ${a}[${i}] = ${elem.expr}; }`,
        expr: a,
      };
    }
    case 'ref': {
      const resolved = schema.thunk();
      const dep = `__dec_${sanitize(resolved.name)}`;
      ctx.deps.set(dep, { mode: 'dec', targetName: resolved.name });
      const v = ctx.fresh('v');
      return {
        pre: `r.pos = pos; const ${v} = ${dep}(r); pos = r.pos;`,
        expr: v,
      };
    }
    case 'codec': {
      const cv = ctx.closureVar('codec_dec', schema.decode);
      const v = ctx.fresh('v');
      return {
        pre: `r.pos = pos; const ${v} = ${cv}(r); pos = r.pos;`,
        expr: v,
      };
    }
  }
  if (isTypedArrayKind(schema.kind)) {
    const len = ctx.fresh('talen');
    const arr = ctx.fresh('ta');
    const size = TA_ELEM_SIZE[schema.kind];
    const ctor = TA_CTOR[schema.kind];
    const vv = ctx.fresh('vv');
    const m = ctx.fresh('m');
    const b = ctx.fresh('b');
    return {
      pre: `let ${len}; { let ${vv} = 0, ${m} = 1, ${b}; do { ${b} = buf[pos++]; ${vv} += (${b} & 0x7f) * ${m}; ${m} *= 128; } while (${b} & 0x80); ${len} = ${vv}; } const ${arr} = new ${ctor}(${len}); { const _bytes = buf.subarray(pos, pos + ${len} * ${size}); new Uint8Array(${arr}.buffer, ${arr}.byteOffset, ${len} * ${size}).set(_bytes); pos += ${len} * ${size}; }`,
      expr: arr,
    };
  }
  throw new Error(`emitDec: unknown kind ${(schema as { kind: string }).kind}`);
}

const BARE_IDENT = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

export function compileObject(schema: ObjectSchema): CodegenResult {
  const encCtx = new Ctx('enc');
  const decCtx = new Ctx('dec');

  // Encoder body
  const encSeg = new SegBuilder();
  for (const fname of Object.keys(schema.fields)) {
    emitEnc(schema.fields[fname]!, encCtx, encSeg, `o[${JSON.stringify(fname)}]`);
  }
  const encodeBody = encSeg.build();

  // Decoder body: emit as inline object literal in return statement.
  // For fields whose inner.expr is already a bare identifier (declared via inner.pre),
  // skip the wrapping `const tmp = expr;` and use the identifier directly.
  let pre = '';
  const props: string[] = [];
  for (const fname of Object.keys(schema.fields)) {
    const inner = emitDec(schema.fields[fname]!, decCtx);
    if (inner.pre !== '' && BARE_IDENT.test(inner.expr)) {
      pre += inner.pre;
      props.push(`${JSON.stringify(fname)}: ${inner.expr}`);
    } else {
      const tmp = decCtx.fresh(`f_${sanitize(fname)}`);
      pre += `${inner.pre} const ${tmp} = ${inner.expr};`;
      props.push(`${JSON.stringify(fname)}: ${tmp}`);
    }
  }
  const decodeBody = `${pre} r.pos = pos; return { ${props.join(', ')} };`;

  const deps = new Map<string, { mode: 'enc' | 'dec'; targetName: string }>();
  for (const [k, v] of encCtx.deps) deps.set(k, v);
  for (const [k, v] of decCtx.deps) deps.set(k, v);
  const closure = new Map<string, unknown>();
  for (const [k, v] of encCtx.closure) closure.set(k, v);
  for (const [k, v] of decCtx.closure) closure.set(k, v);
  return { encodeBody, decodeBody, deps, closure };
}

export function compileUnion(schema: UnionSchema): CodegenResult {
  const encCtx = new Ctx('enc');
  const decCtx = new Ctx('dec');

  const encSeg = new SegBuilder();
  emitEnc(schema, encCtx, encSeg, 'o');
  const encodeBody = encSeg.build();

  const decRes = emitDec(schema, decCtx);
  const decodeBody = `${decRes.pre} r.pos = pos; return ${decRes.expr};`;

  const deps = new Map<string, { mode: 'enc' | 'dec'; targetName: string }>();
  for (const [k, v] of encCtx.deps) deps.set(k, v);
  for (const [k, v] of decCtx.deps) deps.set(k, v);
  const closure = new Map<string, unknown>();
  for (const [k, v] of encCtx.closure) closure.set(k, v);
  for (const [k, v] of decCtx.closure) closure.set(k, v);
  return { encodeBody, decodeBody, deps, closure };
}
