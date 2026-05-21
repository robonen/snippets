/**
 * Compile-only transformer for @perf/serializer.
 *
 * Detects `type(...)` and `oneOf(...)` calls in the source, statically
 * evaluates their arguments to ObjectSchema/UnionSchema descriptors, runs
 * the existing codegen, and replaces each call with a self-contained IIFE
 * that constructs the codec inline — no runtime `new Function`, no codegen
 * module needed at runtime.
 *
 * Also detects class declarations with `static [Serializable] = type(...)`:
 *   - the AOT codec's decoder uses `Object.create(ClassName.prototype)` so
 *     decoded values are real `instanceof ClassName` instances with prototype
 *     methods working;
 *   - the codec auto-registers itself into the runtime registry on module
 *     load (so `deserialize(bytes)` dispatches by id);
 *   - top-level `const X = registerClass(ClassName)` calls are rewritten to
 *     `const X = ClassName[Serializable]` so users can drop the call entirely.
 *
 * Scope (v1):
 *   - Same-file only (no cross-file schema references).
 *   - Top-level `const X = type(...)` and `static [Serializable] = type(...)`.
 *   - Field values may be:
 *       • imported primitive markers (u8 … f64, bool, str, bytes, *Array)
 *       • calls to imported combinators (list, opt, enumOf, flags, tuple)
 *       • identifier references to previously-defined codecs in the file
 *       • inline ObjectExpression literals
 *   - `enumOf` / `flags` array args may be plain arrays or `[...] as const`.
 */

import { parseSync } from 'oxc-parser';
import MagicString from 'magic-string';
import { compileObject, compileUnion } from '../codegen.ts';
import { s } from '../schema.ts';
import type { AnySchema, ObjectSchema, UnionSchema } from '../descriptors.ts';

const PKG_NAMES = new Set(['@perf/serializer', '@perf/serializer/index']);

interface ImportInfo {
  bindings: Map<string, string>;
}

interface CompiledCodec {
  schemaName: string;
  schemaKind: 'object' | 'union';
  fieldsDescriptor: string;
  id: number;
}

function fnv1a16(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 16) ^ h) & 0xffff;
}

const PRIMITIVES = new Set([
  'u8', 'u16', 'u32', 'i8', 'i16', 'i32',
  'u53', 'i53', 'u64', 'i64', 'f32', 'f64',
  'bool', 'str', 'bytes',
  'f32Array', 'f64Array', 'u8Array', 'u16Array', 'u32Array', 'i32Array',
]);

type AnyNode = Record<string, any>;

function collectImportsFromSet(program: AnyNode, aliases: Set<string>): ImportInfo {
  const bindings = new Map<string, string>();
  for (const stmt of program.body as AnyNode[]) {
    if (stmt.type !== 'ImportDeclaration') continue;
    const source = stmt.source.value as string;
    if (!aliases.has(source)) continue;
    for (const spec of stmt.specifiers as AnyNode[]) {
      if (spec.type === 'ImportSpecifier') {
        const local = spec.local.name as string;
        const importedName = (spec.imported.name ?? spec.imported.value) as string;
        bindings.set(local, importedName);
      }
    }
  }
  return { bindings };
}

interface Scope {
  imports: ImportInfo;
  locals: Map<string, AnySchema>;
}

let anonCounter = 0;

function evalExpr(node: AnyNode, scope: Scope): AnySchema | null {
  switch (node.type) {
    case 'Identifier': {
      const name = node.name as string;
      const exported = scope.imports.bindings.get(name);
      if (exported && PRIMITIVES.has(exported)) {
        const prim = (s as unknown as Record<string, AnySchema>)[exported];
        if (prim) return prim;
      }
      const local = scope.locals.get(name);
      if (local) return local;
      return null;
    }
    case 'CallExpression': {
      const callee = node.callee as AnyNode;
      if (callee.type !== 'Identifier') return null;
      const exported = scope.imports.bindings.get(callee.name as string);
      if (!exported) return null;
      const args = node.arguments as AnyNode[];
      switch (exported) {
        case 'list': {
          if (args.length !== 1) return null;
          const elem = evalExpr(args[0]!, scope);
          return elem ? s.array(elem) : null;
        }
        case 'opt': {
          if (args.length !== 1) return null;
          const elem = evalExpr(args[0]!, scope);
          return elem ? s.optional(elem) : null;
        }
        case 'enumOf': {
          if (args.length !== 1) return null;
          const arr = unwrapAsConst(args[0]!);
          if (!arr || arr.type !== 'ArrayExpression') return null;
          const values: string[] = [];
          for (const el of arr.elements as AnyNode[]) {
            if (el && el.type === 'Literal' && typeof el.value === 'string') {
              values.push(el.value as string);
            } else return null;
          }
          return s.enum(values);
        }
        case 'flags': {
          if (args.length !== 1) return null;
          const arr = unwrapAsConst(args[0]!);
          if (!arr || arr.type !== 'ArrayExpression') return null;
          const names: string[] = [];
          for (const el of arr.elements as AnyNode[]) {
            if (el && el.type === 'Literal' && typeof el.value === 'string') {
              names.push(el.value as string);
            } else return null;
          }
          return s.bitset(names);
        }
        case 'tuple': {
          const elems: AnySchema[] = [];
          for (const a of args) {
            const e = evalExpr(a, scope);
            if (!e) return null;
            elems.push(e);
          }
          return s.tuple(...elems);
        }
        default:
          return null;
      }
    }
    case 'ObjectExpression': {
      const fields = collectFields(node, scope);
      if (!fields) return null;
      const inlineName = `__InlineObj_${anonCounter++}`;
      return { kind: 'object' as const, name: inlineName, fields };
    }
    default:
      return null;
  }
}

function unwrapAsConst(node: AnyNode): AnyNode | null {
  if (node.type === 'TSAsExpression' || node.type === 'TSSatisfiesExpression') {
    return node.expression as AnyNode;
  }
  if (node.type === 'ArrayExpression') return node;
  return null;
}

function collectFields(obj: AnyNode, scope: Scope): Record<string, AnySchema> | null {
  const fields: Record<string, AnySchema> = {};
  for (const prop of obj.properties as AnyNode[]) {
    if (prop.type !== 'Property') return null;
    const key = prop.key as AnyNode;
    let fname: string;
    if (key.type === 'Identifier') fname = key.name as string;
    else if (key.type === 'Literal' && typeof key.value === 'string') fname = key.value as string;
    else return null;
    const sub = evalExpr(prop.value as AnyNode, scope);
    if (!sub) return null;
    fields[fname] = sub;
  }
  return fields;
}

interface TypeCallInfo {
  call: AnyNode;
  /** Const name for `const X = type(...)` or class name for `class X { static [Serializable] = type(...) }`. */
  declName: string;
  fn: 'type' | 'oneOf';
  /** If set, the call is a static-field initializer inside this class. */
  boundClass?: string;
}

function unwrapStmt(stmt: AnyNode): AnyNode {
  if (stmt.type === 'ExportNamedDeclaration' && stmt.declaration) return stmt.declaration as AnyNode;
  if (stmt.type === 'ExportDefaultDeclaration' && stmt.declaration) return stmt.declaration as AnyNode;
  return stmt;
}

function findTypeCalls(program: AnyNode, imports: ImportInfo): TypeCallInfo[] {
  const calls: TypeCallInfo[] = [];
  for (const topStmt of program.body as AnyNode[]) {
    const stmt = unwrapStmt(topStmt);

    // Top-level `const X = type(...)` / `const X = oneOf(...)`
    if (stmt.type === 'VariableDeclaration') {
      for (const decl of stmt.declarations as AnyNode[]) {
        const id = decl.id as AnyNode;
        const init = decl.init as AnyNode | null;
        if (!init || id.type !== 'Identifier' || init.type !== 'CallExpression') continue;
        const callee = init.callee as AnyNode;
        if (callee.type !== 'Identifier') continue;
        const exported = imports.bindings.get(callee.name as string);
        if (exported === 'type' || exported === 'oneOf') {
          calls.push({ call: init, declName: id.name as string, fn: exported });
        }
      }
      continue;
    }

    // `class X { static [Serializable] = type(...) }`
    if (stmt.type === 'ClassDeclaration') {
      const className = (stmt.id as AnyNode | null)?.name as string | undefined;
      if (!className) continue;
      const body = stmt.body as AnyNode;
      for (const member of body.body as AnyNode[]) {
        if (member.type !== 'PropertyDefinition' || !member.static || !member.computed) continue;
        const key = member.key as AnyNode;
        if (key.type !== 'Identifier') continue;
        const exported = imports.bindings.get(key.name as string);
        if (exported !== 'Serializable') continue;
        const value = member.value as AnyNode | null;
        if (!value || value.type !== 'CallExpression') continue;
        const callee = value.callee as AnyNode;
        if (callee.type !== 'Identifier') continue;
        const fnName = imports.bindings.get(callee.name as string);
        if (fnName !== 'type' && fnName !== 'oneOf') continue;
        calls.push({ call: value, declName: className, fn: fnName, boundClass: className });
      }
    }
  }
  return calls;
}

function buildSchemaFromTypeCall(
  info: TypeCallInfo,
  scope: Scope,
): ObjectSchema | UnionSchema | null {
  const args = info.call.arguments as AnyNode[];
  if (info.fn === 'type') {
    let name: string;
    let fieldsExpr: AnyNode;
    if (args.length >= 2 && args[0]!.type === 'Literal' && typeof args[0]!.value === 'string') {
      name = args[0]!.value as string;
      fieldsExpr = args[1]!;
    } else {
      name = info.declName;
      fieldsExpr = args[0]!;
    }
    if (fieldsExpr.type !== 'ObjectExpression') return null;
    const fields = collectFields(fieldsExpr, scope);
    if (!fields) return null;
    return { kind: 'object', name, fields };
  } else {
    let name: string;
    let disc: string;
    let variantsExpr: AnyNode;
    if (
      args.length >= 3 &&
      args[0]!.type === 'Literal' &&
      typeof args[0]!.value === 'string'
    ) {
      name = args[0]!.value as string;
      const discNode = args[1]!;
      if (discNode.type !== 'Literal' || typeof discNode.value !== 'string') return null;
      disc = discNode.value as string;
      variantsExpr = args[2]!;
    } else if (args.length >= 2) {
      name = info.declName;
      const discNode = args[0]!;
      if (discNode.type !== 'Literal' || typeof discNode.value !== 'string') return null;
      disc = discNode.value as string;
      variantsExpr = args[1]!;
    } else return null;

    if (variantsExpr.type !== 'ObjectExpression') return null;
    const variants: Record<string, Record<string, AnySchema>> = {};
    for (const prop of variantsExpr.properties as AnyNode[]) {
      if (prop.type !== 'Property') return null;
      const key = prop.key as AnyNode;
      const variantName =
        key.type === 'Identifier' ? (key.name as string)
        : key.type === 'Literal' && typeof key.value === 'string' ? (key.value as string)
        : null;
      if (!variantName) return null;
      const variantFields = prop.value as AnyNode;
      if (variantFields.type !== 'ObjectExpression') return null;
      const fields = collectFields(variantFields, scope);
      if (!fields) return null;
      variants[variantName] = fields;
    }
    return s.union(name, disc, variants);
  }
}

function emitDescriptorLiteral(schema: AnySchema): string {
  return JSON.stringify(schema, (key, value) => {
    if (key === 'thunk' || typeof value === 'function') return undefined;
    return value;
  });
}

function compileCall(
  info: TypeCallInfo,
  scope: Scope,
): { src: string; compiled: CompiledCodec } | null {
  const schema = buildSchemaFromTypeCall(info, scope);
  if (!schema) return null;

  const protoExpr = info.boundClass ? `${info.boundClass}.prototype` : undefined;
  const cg =
    schema.kind === 'object'
      ? compileObject(schema, { boundProtoExpr: protoExpr })
      : compileUnion(schema);
  const id = fnv1a16(schema.name);
  const fname = sanitize(schema.name);
  if (cg.deps.size > 0) return null; // ref/codec deps not supported yet

  const closureLines: string[] = [];
  for (const [k, v] of cg.closure) {
    closureLines.push(`const ${k} = ${serializeClosureValue(v)};`);
  }

  const descriptorLit = emitDescriptorLiteral(schema);

  const src = `(function () {
  ${closureLines.join('\n  ')}
  function encode_${fname}(w, o) {
    let pos = w.pos;
    let buf = w.buf;
    let view = w.view;
    ${cg.encodeBody}
    w.pos = pos;
  }
  function decode_${fname}(r) {
    let pos = r.pos;
    const buf = r.buf;
    const view = r.view;
    ${cg.decodeBody}
  }
  const __desc = ${descriptorLit};
  const __codec = Object.freeze({
    ...__desc,
    id: ${id},
    encode(v, into) {
      if (into) { encode_${fname}(into, v); return into.bytes(); }
      const w = new __SerWriter();
      encode_${fname}(w, v);
      return w.bytesCopy();
    },
    decode(b) {
      const r = new __SerReader(b);
      return decode_${fname}(r);
    },
    encodeInto(v, w) { encode_${fname}(w, v); },
    decodeFrom: decode_${fname},
    $infer: undefined,
  });
  return __serRegisterPrecompiled(__codec);
})()`;

  return {
    src,
    compiled: {
      schemaName: schema.name,
      schemaKind: schema.kind,
      fieldsDescriptor: descriptorLit,
      id,
    },
  };
}

function sanitize(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, '_');
}

function serializeClosureValue(v: unknown): string {
  if (v === null || v === undefined) return String(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'bigint') return `${v.toString()}n`;
  if (Array.isArray(v)) return `Object.freeze([${v.map(serializeClosureValue).join(',')}])`;
  if (typeof v === 'object') {
    const entries = Object.entries(v as object).map(
      ([k, val]) => `${JSON.stringify(k)}: ${serializeClosureValue(val)}`,
    );
    return `Object.freeze({${entries.join(',')}})`;
  }
  throw new Error(`Cannot serialize closure value of type ${typeof v}`);
}

function makePrelude(importPath: string): string {
  return `
import { Writer as __SerWriter, Reader as __SerReader, __registerPrecompiled as __serRegisterPrecompiled } from ${JSON.stringify(importPath)};
`;
}

/**
 * Rewrite `const X = registerClass(Y)` (and statement-form `registerClass(Y)`)
 * into a direct reference to the class's pre-attached codec. With the AOT codec
 * already living at `Y[Serializable]`, the runtime `registerClass` call is
 * redundant — we replace it so users can drop it entirely.
 */
function rewriteRegisterClassCalls(
  program: AnyNode,
  imports: ImportInfo,
  ms: MagicString,
): number {
  const serializableLocal = [...imports.bindings.entries()].find(
    ([, e]) => e === 'Serializable',
  )?.[0];
  // If user hasn't imported Serializable, they can't have written `static [Serializable] = ...`,
  // so any registerClass(X) call is using the runtime path. Leave it alone.
  if (!serializableLocal) return 0;

  let count = 0;
  for (const topStmt of program.body as AnyNode[]) {
    const stmt = unwrapStmt(topStmt);

    // `const X = registerClass(Y)` (or `let`/`var`)
    if (stmt.type === 'VariableDeclaration') {
      for (const decl of stmt.declarations as AnyNode[]) {
        const init = decl.init as AnyNode | null;
        if (!init || init.type !== 'CallExpression') continue;
        if (!isRegisterClassCall(init, imports)) continue;
        const arg = (init.arguments as AnyNode[])[0];
        if (!arg || arg.type !== 'Identifier') continue;
        ms.overwrite(
          init.start as number,
          init.end as number,
          `${arg.name}[${serializableLocal}]`,
        );
        count++;
      }
      continue;
    }

    // Bare `registerClass(Y);` expression-statement
    if (stmt.type === 'ExpressionStatement') {
      const expr = stmt.expression as AnyNode;
      if (expr.type !== 'CallExpression') continue;
      if (!isRegisterClassCall(expr, imports)) continue;
      // No-op now — codec already self-registers on class init.
      ms.overwrite(stmt.start as number, stmt.end as number, '/* registerClass elided */');
      count++;
    }
  }
  return count;
}

function isRegisterClassCall(call: AnyNode, imports: ImportInfo): boolean {
  const callee = call.callee as AnyNode;
  if (callee.type !== 'Identifier') return false;
  return imports.bindings.get(callee.name as string) === 'registerClass';
}

export interface TransformOptions {
  importPath?: string;
  packageAliases?: string[];
}

export interface TransformResult {
  code: string;
  transformedCount: number;
}

export function transform(
  source: string,
  filename = 'input.ts',
  options: TransformOptions = {},
): TransformResult {
  const importPath = options.importPath ?? '@perf/serializer';
  const aliases = new Set<string>(PKG_NAMES);
  for (const a of options.packageAliases ?? []) aliases.add(a);
  aliases.add(importPath);

  const lang = filename.endsWith('.ts') || filename.endsWith('.tsx') ? 'ts' : 'js';
  const parsed = parseSync(filename, source, { lang });
  if (parsed.errors && parsed.errors.length > 0) {
    const msgs = parsed.errors.map((e) => e.message ?? String(e)).join('\n');
    throw new Error(`Parse errors in ${filename}:\n${msgs}`);
  }

  const program = parsed.program as unknown as AnyNode;
  const imports = collectImportsFromSet(program, aliases);

  let hasTypeImport = false;
  for (const v of imports.bindings.values()) {
    if (v === 'type' || v === 'oneOf') {
      hasTypeImport = true;
      break;
    }
  }
  if (!hasTypeImport) return { code: source, transformedCount: 0 };

  const calls = findTypeCalls(program, imports);
  if (calls.length === 0) return { code: source, transformedCount: 0 };

  const scope: Scope = { imports, locals: new Map() };
  const ms = new MagicString(source);
  let transformedCount = 0;

  for (const info of calls) {
    const result = compileCall(info, scope);
    if (!result) continue;
    ms.overwrite(info.call.start as number, info.call.end as number, result.src);
    const schema =
      result.compiled.schemaKind === 'object'
        ? ({
            kind: 'object' as const,
            name: result.compiled.schemaName,
            fields: JSON.parse(result.compiled.fieldsDescriptor).fields,
          } as ObjectSchema)
        : ({
            kind: 'union' as const,
            name: result.compiled.schemaName,
            ...JSON.parse(result.compiled.fieldsDescriptor),
          } as UnionSchema);
    scope.locals.set(info.declName, schema);
    transformedCount++;
  }

  if (transformedCount === 0) return { code: source, transformedCount: 0 };

  // Now that codecs are inlined, rewrite registerClass(X) → X[Serializable].
  rewriteRegisterClassCalls(program, imports, ms);

  ms.prepend(makePrelude(importPath));
  return { code: ms.toString(), transformedCount };
}
