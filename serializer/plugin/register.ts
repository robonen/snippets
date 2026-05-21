import { compileObject, compileUnion } from './codegen.ts';
import type { AnySchema, ObjectSchema, UnionSchema } from './descriptors.ts';
import { Reader, Writer } from './io.ts';
import { Serializable } from './symbol.ts';

export interface Codec<T = unknown> {
  readonly id: number;
  readonly name: string;
  readonly encode: (w: Writer, v: T) => void;
  readonly decode: (r: Reader) => T;
}

type AnyCodec = Codec<any>;

const byName = new Map<string, AnyCodec>();
const byId = new Map<number, AnyCodec>();
const byCtor = new WeakMap<object, AnyCodec>();

function fnv1a16(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 16) ^ h) & 0xffff;
}

function collectRefDeps(schema: AnySchema, acc: Map<string, ObjectSchema>): void {
  switch (schema.kind) {
    case 'ref': {
      const target = schema.thunk();
      if (!acc.has(target.name)) {
        acc.set(target.name, target);
        for (const f of Object.values(target.fields)) collectRefDeps(f, acc);
      }
      return;
    }
    case 'object':
      for (const f of Object.values(schema.fields)) collectRefDeps(f, acc);
      return;
    case 'array':
    case 'optional':
      collectRefDeps(schema.elem, acc);
      return;
    case 'tuple':
      for (const e of schema.elems) collectRefDeps(e, acc);
      return;
    case 'union':
      for (const v of Object.values(schema.variants)) collectRefDeps(v, acc);
      return;
    default:
      return;
  }
}

function sanIdent(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, '_');
}

export function register<T = unknown>(schema: ObjectSchema | UnionSchema): Codec<T> {
  const existing = byName.get(schema.name);
  if (existing) return existing as Codec<T>;

  // Only `ref` boundaries require a separately registered codec; nested
  // objects/unions/arrays/etc. are inlined into the generated function.
  const refTargets = new Map<string, ObjectSchema>();
  if (schema.kind === 'object') {
    for (const f of Object.values(schema.fields)) collectRefDeps(f, refTargets);
  } else {
    for (const v of Object.values(schema.variants)) collectRefDeps(v, refTargets);
  }
  for (const dep of refTargets.values()) {
    if (!byName.has(dep.name)) register(dep);
  }

  const cg = schema.kind === 'object' ? compileObject(schema) : compileUnion(schema);

  const depsObj: Record<string, Function> = {};
  for (const [local, info] of cg.deps) {
    const target = byName.get(info.targetName);
    if (!target) throw new Error(`Dep not registered: ${info.targetName}`);
    depsObj[local] = info.mode === 'enc' ? target.encode : target.decode;
  }

  const closureObj: Record<string, unknown> = {};
  for (const [k, v] of cg.closure) closureObj[k] = v;

  const encDeps: string[] = [];
  const decDeps: string[] = [];
  for (const [local, info] of cg.deps) {
    const line = `const ${local} = deps[${JSON.stringify(local)}];`;
    if (info.mode === 'enc') encDeps.push(line);
    else decDeps.push(line);
  }

  const closureDecls = [...cg.closure.keys()]
    .map((k) => `const ${k} = closure[${JSON.stringify(k)}];`)
    .join('\n');

  const fname = sanIdent(schema.name);

  const encSrc = `${encDeps.join('\n')}
${closureDecls}
return function encode_${fname}(w, o) {
  let pos = w.pos;
  let buf = w.buf;
  let view = w.view;
  ${cg.encodeBody}
  w.pos = pos;
};`;

  const decSrc = `${decDeps.join('\n')}
${closureDecls}
return function decode_${fname}(r) {
  let pos = r.pos;
  const buf = r.buf;
  const view = r.view;
  ${cg.decodeBody}
};`;

  let encFn: (w: Writer, v: T) => void;
  let decFn: (r: Reader) => T;
  try {
    encFn = new Function('deps', 'closure', encSrc)(depsObj, closureObj);
    decFn = new Function('deps', 'closure', decSrc)(depsObj, closureObj);
  } catch (e) {
    throw new Error(
      `Codegen failed for "${schema.name}": ${(e as Error).message}\n--- encode source ---\n${encSrc}\n--- decode source ---\n${decSrc}`,
    );
  }

  const id = fnv1a16(schema.name);
  const idExisting = byId.get(id);
  if (idExisting) {
    throw new Error(
      `Schema ID collision: "${schema.name}" and "${idExisting.name}" both hash to 0x${id.toString(16)}`,
    );
  }

  const codec: Codec<T> = Object.freeze({
    id,
    name: schema.name,
    encode: encFn,
    decode: decFn,
  });

  byName.set(schema.name, codec);
  byId.set(id, codec);
  return codec;
}

export function registerClass<T>(Ctor: new (...args: never[]) => T): Codec<T> {
  const cached = byCtor.get(Ctor);
  if (cached) return cached as Codec<T>;
  const schema = (Ctor as unknown as Record<symbol, unknown>)[Serializable] as
    | ObjectSchema
    | UnionSchema
    | undefined;
  if (!schema) {
    throw new Error(`${Ctor.name} has no [Serializable] schema`);
  }
  const codec = register<T>(schema);
  byCtor.set(Ctor, codec);
  return codec;
}

/**
 * Encode a value into a framed Uint8Array (2-byte schema ID + body).
 * If a Writer is passed, returns a view; otherwise returns a fresh copy.
 */
export function serialize<T>(value: T, codec: Codec<T>, writer?: Writer): Uint8Array {
  if (writer) {
    writer.u16(codec.id);
    codec.encode(writer, value);
    return writer.bytes();
  }
  const w = new Writer();
  w.u16(codec.id);
  codec.encode(w, value);
  return w.bytesCopy();
}

/**
 * Decode a framed Uint8Array by looking up its schema ID.
 */
export function deserialize<T = unknown>(bytes: Uint8Array): T {
  const r = new Reader(bytes);
  const id = r.u16();
  const codec = byId.get(id);
  if (!codec) throw new Error(`Unknown schema ID: 0x${id.toString(16)}`);
  return codec.decode(r) as T;
}

export function clearRegistry(): void {
  byName.clear();
  byId.clear();
}
