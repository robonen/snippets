import MagicString from 'magic-string'
import { parseSync } from 'oxc-parser'
import type { Plugin } from 'vite'

/**
 * The reserved import specifier for the feature macro. vite-layers auto-registers this as a Vite
 * alias (→ `src/feature.ts`) and a tsconfig `paths` entry, so consumers need no extra config.
 * `vite-layers/feature` is also accepted (the published subpath export) for tooling that bypasses
 * the alias.
 */
export const FEATURE_MODULE = '#feature'
const FEATURE_SPECIFIERS = new Set([FEATURE_MODULE, 'vite-layers/feature'])

/** Matches an import/export `from '#feature'|'vite-layers/feature'` clause. Used to decide whether a
 *  parse failure must fail the build (the module really uses the macro) rather than be skipped. */
const FEATURE_FROM_RE = /\bfrom\s*['"](?:#feature|vite-layers\/feature)['"]/

/** Code-filter regex for the rolldown `transform` hook filter (see {@link featurePlugin}). A superset
 *  of "actually imports the macro" — it just gates the JS round-trip; the handler decides precisely. */
const MACRO_CODE_RE = /#feature|vite-layers\/feature/

// ---------------------------------------------------------------------------------------------
// Feature tree helpers (shared by the transform and the type generator so they never disagree).
// ---------------------------------------------------------------------------------------------

/**
 * Flatten a (possibly nested) feature object into every dotted path — both intermediate objects and
 * leaves — paired with its value. `{ payments: { stripe: true } }` →
 * `[['payments', {stripe:true}], ['payments.stripe', true]]`. The transform resolves a `feature()`
 * key by exact lookup here, and the type generator emits one interface member per entry, so the
 * accepted keys and the substituted values are guaranteed to match.
 */
export function flattenFeatures(features: Record<string, unknown>): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = []
  const walk = (obj: Record<string, unknown>, prefix: string) => {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k
      out.push([key, v])
      if (v && typeof v === 'object' && !Array.isArray(v)) walk(v as Record<string, unknown>, key)
    }
  }
  walk(features, '')
  return out
}

const isPlainObject = (v: unknown): boolean => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

/**
 * Returns a human description if `v` is NOT a JSON-like value the macro can fold into source (and
 * the type generator into a literal type), else `null`. Recurses arrays/plain objects. Rejects
 * bigint (JSON.stringify throws), functions/symbols (not serializable), non-finite numbers
 * (`NaN`/`Infinity` → invalid TS + JSON `null`), and non-plain objects (Date/Map/RegExp/… would be
 * coerced or crash). Keeping this strict means a bad flag fails fast with a clear message instead of
 * crashing the transform or silently shipping a wrong value.
 */
function unsupportedValue(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'boolean' || typeof v === 'string') return null
  if (typeof v === 'number') return Number.isFinite(v) ? null : `non-finite number (${v})`
  if (typeof v === 'bigint') return 'bigint'
  if (typeof v === 'function') return 'function'
  if (typeof v === 'symbol') return 'symbol'
  if (Array.isArray(v)) {
    for (const el of v) {
      const bad = unsupportedValue(el)
      if (bad) return bad
    }
    return null
  }
  if (isPlainObject(v)) {
    for (const val of Object.values(v as Record<string, unknown>)) {
      const bad = unsupportedValue(val)
      if (bad) return bad
    }
    return null
  }
  return `non-plain object (${Object.prototype.toString.call(v)})`
}

/**
 * Flatten + validate the feature tree. Throws (clear, fail-fast) on a dotted-key collision (an
 * explicit `'a.b'` key clashing with a nested `a.b` path — they would produce a duplicate `.d.ts`
 * member and an order-dependent wrong substitution) or an unsupported value type. Shared by the
 * transform and the type generator so both reject the same inputs identically.
 */
export function validateFeatures(features: Record<string, unknown>): Array<[string, unknown]> {
  const flat = flattenFeatures(features)
  const seen = new Set<string>()
  for (const [key, value] of flat) {
    if (seen.has(key)) {
      throw new Error(
        `vite-layers: feature flag key '${key}' is defined twice — an explicit dotted key and a nested ` +
          `path collide. Use one form, not both.`,
      )
    }
    seen.add(key)
    const bad = unsupportedValue(value)
    if (bad) {
      throw new Error(
        `vite-layers: feature flag '${key}' has an unsupported value type (${bad}). Flags must be ` +
          `JSON-like: boolean, finite number, string, null, plain object, or array of those.`,
      )
    }
  }
  return flat
}

/** A property name that can be written unquoted in a TS type literal / object key. */
const IDENTIFIER_RE = /^[A-Za-z_$][\w$]*$/
const tsKey = (k: string) => (IDENTIFIER_RE.test(k) ? k : JSON.stringify(k))

/**
 * Render a value as a TS **literal** type (not the widened base type): `false`, `2`, `"app"`,
 * `readonly [...]`, `{ … }`. Emitting the literal makes the macro's return type the exact value the
 * transform substitutes, so editors show the real flag value and `keyof` typo-checks the key.
 */
function tsType(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) {
    return value.length ? `readonly [${value.map(tsType).join(', ')}]` : 'readonly []'
  }
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number':
      return String(value)
    case 'string':
      return JSON.stringify(value)
    case 'object': {
      const entries = Object.entries(value as Record<string, unknown>)
      if (entries.length === 0) return 'Record<string, never>'
      return `{ ${entries.map(([k, v]) => `${tsKey(k)}: ${tsType(v)}`).join('; ')} }`
    }
    default:
      return 'unknown'
  }
}

/**
 * Generate the `.d.ts` that augments {@link LayerFeatures} so `feature('key')` is typed with the
 * flag's literal value and an unknown key (`feature('biling')`) is a compile error. The augmentation
 * targets the `#feature` module, which vite-layers maps to `src/feature.ts` via the generated
 * tsconfig `paths`.
 */
export function featuresDts(features: Record<string, unknown> = {}): string {
  const members = validateFeatures(features).map(([k, v]) => `    ${tsKey(k)}: ${tsType(v)}`)
  return [
    '// AUTO-GENERATED by vite-layers — do not edit.',
    `import '${FEATURE_MODULE}'`,
    '',
    `declare module '${FEATURE_MODULE}' {`,
    '  interface LayerFeatures {',
    ...members,
    '  }',
    '}',
    '',
  ].join('\n')
}

// ---------------------------------------------------------------------------------------------
// The transform: replace `feature('key')` with a literal, fail the build on any other use.
// ---------------------------------------------------------------------------------------------

/** `?…&lang.<ext>` query that Vue/Vite append to SFC sub-modules. Module-scope (not re-created per call). */
const LANG_QUERY_RE = /[?&]lang\.(\w+)/

/** Pick the dialect for oxc from the module id (handles `.vue?…&lang.tsx` query ids). */
function langFromId(id: string): 'js' | 'jsx' | 'ts' | 'tsx' {
  const queryLang = id.match(LANG_QUERY_RE)?.[1]
  const clean = id.split('?', 1)[0]!
  const ext = queryLang ?? clean.slice(clean.lastIndexOf('.') + 1)
  if (ext === 'tsx') return 'tsx'
  if (ext === 'jsx') return 'jsx'
  if (ext === 'js' || ext === 'mjs' || ext === 'cjs') return 'js'
  // .ts/.mts/.cts and anything unknown → TS (a superset; the common case for app code).
  return 'ts'
}

type AnyNode = { type: string; start: number; end: number } & Record<string, unknown>

const CHILD_SKIP = new Set(['type', 'start', 'end', 'range', 'loc'])

/** Iterate a node's child AST nodes (oxc emits an ESTree-shaped tree). */
function eachChild(node: AnyNode, fn: (child: AnyNode) => void) {
  for (const key in node) {
    if (CHILD_SKIP.has(key)) continue
    const child = node[key]
    if (Array.isArray(child)) {
      for (const c of child) if (c && typeof (c as AnyNode).type === 'string') fn(c as AnyNode)
    } else if (child && typeof (child as AnyNode).type === 'string') {
      fn(child as AnyNode)
    }
  }
}

/** Collect the names bound by a binding pattern (Identifier / Object / Array / default / rest). */
function patternNames(node: AnyNode | null | undefined, add: (name: string) => void): void {
  if (!node || typeof node.type !== 'string') return
  switch (node.type) {
    case 'Identifier':
      add(node.name as string)
      break
    case 'ObjectPattern':
      for (const p of (node.properties as AnyNode[]) ?? []) {
        patternNames((p.type === 'RestElement' ? p.argument : p.value) as AnyNode, add)
      }
      break
    case 'ArrayPattern':
      for (const el of (node.elements as (AnyNode | null)[]) ?? []) patternNames(el, add)
      break
    case 'AssignmentPattern':
      patternNames(node.left as AnyNode, add)
      break
    case 'RestElement':
      patternNames(node.argument as AnyNode, add)
      break
  }
}

/** Lexical (block-scoped) bindings declared directly in a statement list: let/const/class/function. */
function collectLexical(stmts: AnyNode[], add: (n: string) => void): void {
  for (const st of stmts ?? []) {
    if (st.type === 'VariableDeclaration' && st.kind !== 'var') {
      for (const d of st.declarations as AnyNode[]) patternNames(d.id as AnyNode, add)
    } else if ((st.type === 'FunctionDeclaration' || st.type === 'ClassDeclaration') && st.id) {
      add((st.id as AnyNode).name as string)
    }
  }
}

/** Function-scoped bindings hoisted in a body: `var` (at any depth) + nested function-decl names. */
function collectHoisted(stmts: AnyNode[], add: (n: string) => void): void {
  const visit = (node: AnyNode) => {
    const t = node.type
    if (t === 'FunctionDeclaration') {
      if (node.id) add((node.id as AnyNode).name as string)
      return // its body is a nested scope
    }
    if (t === 'FunctionExpression' || t === 'ArrowFunctionExpression' || t === 'ClassDeclaration' || t === 'ClassExpression') {
      return // nested scope — its vars belong there
    }
    if (t === 'VariableDeclaration') {
      if (node.kind === 'var') for (const d of node.declarations as AnyNode[]) patternNames(d.id as AnyNode, add)
      return
    }
    eachChild(node, visit)
  }
  for (const s of stmts ?? []) visit(s)
}

const SCOPE_NODES = new Set([
  'FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression',
  'BlockStatement', 'StaticBlock', 'CatchClause',
  'ForStatement', 'ForInStatement', 'ForOfStatement', 'SwitchStatement',
])

/** The subset of `locals` (macro binding names) that this scope node re-binds, shadowing the import. */
function scopeBindings(node: AnyNode, locals: Set<string>): Set<string> {
  const bound = new Set<string>()
  const add = (n: string) => {
    if (locals.has(n)) bound.add(n)
  }
  const t = node.type
  if (t === 'FunctionDeclaration' || t === 'FunctionExpression' || t === 'ArrowFunctionExpression') {
    for (const p of (node.params as AnyNode[]) ?? []) patternNames(p, add)
    if (t === 'FunctionExpression' && node.id) add((node.id as AnyNode).name as string)
    const body = node.body as AnyNode | undefined
    if (body?.type === 'BlockStatement') collectHoisted(body.body as AnyNode[], add)
  } else if (t === 'CatchClause') {
    patternNames(node.param as AnyNode, add)
  } else if (t === 'BlockStatement' || t === 'StaticBlock') {
    collectLexical(node.body as AnyNode[], add)
  } else if (t === 'ForStatement' || t === 'ForInStatement' || t === 'ForOfStatement') {
    const head = (t === 'ForStatement' ? node.init : node.left) as AnyNode | null
    if (head?.type === 'VariableDeclaration' && head.kind !== 'var') {
      for (const d of head.declarations as AnyNode[]) patternNames(d.id as AnyNode, add)
    }
  } else if (t === 'SwitchStatement') {
    for (const c of (node.cases as AnyNode[]) ?? []) collectLexical(c.consequent as AnyNode[], add)
  }
  return bound
}

/** Extract a string key from a `feature(arg)` argument — a plain string literal or a `\`literal\``. */
function stringKey(arg: AnyNode | undefined): string | undefined {
  if (!arg) return undefined
  if ((arg.type === 'Literal' || arg.type === 'StringLiteral') && typeof arg.value === 'string') {
    return arg.value
  }
  if (arg.type === 'TemplateLiteral') {
    const exprs = arg.expressions as unknown[]
    const quasis = arg.quasis as Array<{ value: { cooked?: string } }>
    // A single static chunk with a valid cooked value; an invalid escape (`\unicode`) makes cooked
    // null → treat as not-a-string-literal so it routes to the clear "string-literal key" error.
    if (exprs.length === 0 && quasis.length === 1 && typeof quasis[0]!.value.cooked === 'string') {
      return quasis[0]!.value.cooked
    }
  }
  return undefined
}

/** A primitive substitutes bare; an object/array is parenthesized so it is always an expression. */
function literalOf(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value !== null && typeof value === 'object') return `(${JSON.stringify(value)})`
  return JSON.stringify(value)
}

const isImportSource = (node: AnyNode, sources: Set<string>): boolean => {
  const src = node.source as { value?: unknown } | undefined
  return typeof src?.value === 'string' && sources.has(src.value)
}

/**
 * Build-time feature flags via the `feature('key')` macro — one mechanism for dev **and** build.
 *
 * The transform parses every module that imports `feature` (from `#feature` / `vite-layers/feature`),
 * replaces each `feature('key')` call with the flag's literal value, and removes the now-unused
 * import. Replacing a disabled flag's call with `false` lets Rollup/rolldown tree-shake the dead
 * branch — including any `import()` inside it — so the chunk is never emitted.
 *
 * Anything other than a direct call with a known string-literal key (aliasing, destructuring,
 * dynamic key, unknown key) is a **hard error** via `this.error`, surfaced with a code frame in dev
 * (browser overlay + terminal) and as a failed build — the misuse can never silently ship. Because
 * the same substitution runs in dev, dev is a faithful oracle for the build result.
 *
 * @param features the merged feature flags (high→low layer priority already applied).
 */
export function featurePlugin(features: Record<string, unknown> = {}): Plugin {
  const flat = new Map(validateFeatures(features))

  return {
    name: 'vite-layers:features',
    // `enforce: 'post'` so we always run *after* every framework/TS transform (a Vue SFC's
    // `<script setup>` compiled to JS, JSX→JS, TS→JS) — never on raw, unparseable `.vue`/JSX source —
    // and *before* Vite's import-analysis rewrites specifiers, so the macro import is still
    // `#feature`/`vite-layers/feature`. This makes the pass independent of plugin array order: the
    // old no-enforce version could run before `@vitejs/plugin-vue`, fail to parse the raw SFC, and
    // silently skip the `feature()` calls in `<script setup>` — exactly the silent miss this avoids.
    enforce: 'post',
    // Hook filter (rolldown): the bundler only calls this transform for non-node_modules modules whose
    // code references the macro module — every other module skips the JS round-trip entirely.
    // https://rolldown.rs/in-depth/why-plugin-hook-filter . The handler repeats the guards so it stays
    // correct on hosts that don't apply the filter (plain Rollup / older dev pipelines).
    transform: {
      filter: { id: { exclude: /node_modules/ }, code: MACRO_CODE_RE },
      handler(code, id) {
        if (id.includes('/node_modules/')) return null
        if (!code.includes(FEATURE_MODULE) && !code.includes('vite-layers/feature')) return null

      // A real macro module that fails to parse must NEVER be skipped silently — its feature() calls
      // would ship uncompiled. oxc reports syntax errors in `errors` (it does not throw) and yields an
      // empty/partial body, which otherwise looks like "no macro here". So: when the module references
      // `#feature` in a from-clause, any parse failure is a hard build error; if `#feature` only shows
      // up in a string/comment, stay out of the way and let the rest of the pipeline proceed.
      let result: ReturnType<typeof parseSync>
      try {
        result = parseSync(id.split('?', 1)[0]!, code, { sourceType: 'module', lang: langFromId(id) })
      } catch (err) {
        if (FEATURE_FROM_RE.test(code)) {
          this.error(`vite-layers: could not parse ${id} to compile its feature() calls — ${(err as Error)?.message ?? err}`)
        }
        return null
      }
      if (result.errors?.length && FEATURE_FROM_RE.test(code)) {
        this.error(`vite-layers: ${id} has syntax errors; cannot safely compile its feature() calls — ${result.errors[0]?.message ?? ''}`)
      }
      const program = result.program as unknown as AnyNode

      // Pass 1: collect the local binding name(s) imported from our module, and the import nodes.
      const importDecls: AnyNode[] = []
      const locals = new Set<string>()
      for (const node of program.body as AnyNode[]) {
        if (node.type === 'ImportDeclaration' && isImportSource(node, FEATURE_SPECIFIERS)) {
          if (node.importKind === 'type') continue // `import type { feature }` — fully erased, ignore
          importDecls.push(node)
          for (const spec of node.specifiers as AnyNode[]) {
            if (spec.importKind === 'type') continue // `import { type feature }` — erased
            const imported = spec.imported as { name?: string; value?: string } | undefined
            if (spec.type === 'ImportSpecifier' && (imported?.name ?? imported?.value) === 'feature') {
              locals.add((spec.local as { name: string }).name)
            } else if (spec.type === 'ImportDefaultSpecifier' || spec.type === 'ImportNamespaceSpecifier') {
              // A default/namespace import can only be used via dynamic property access, which the
              // transform cannot fold — fail the build now rather than letting it throw at runtime.
              this.error(
                `vite-layers: import the named { feature } macro from '${FEATURE_MODULE}' — ` +
                  'default and namespace imports are not supported (they defeat dead-code elimination).',
                spec.start,
              )
            }
          }
        } else if (
          (node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') &&
          isImportSource(node, FEATURE_SPECIFIERS)
        ) {
          this.error('vite-layers: re-exporting the `feature` macro is not supported — import and call it directly.', node.start)
        }
      }
      if (locals.size === 0) return null

      // Pass 2: every reference to the binding (that isn't shadowed by a local of the same name)
      // must be a direct `feature('known-key')` call; anything else is a hard error.
      const s = new MagicString(code)
      const edits: Array<[number, number, string]> = []

      const handleRef = (node: AnyNode, parent: AnyNode | null) => {
        if (parent) {
          // Binding/declaration positions and non-reference uses of the name — not macro calls.
          if (parent.type === 'ImportSpecifier' || parent.type === 'ImportDefaultSpecifier' || parent.type === 'ImportNamespaceSpecifier') return
          if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) return
          if (parent.type === 'Property' && parent.key === node && !parent.computed && !parent.shorthand) return
          if ((parent.type === 'PropertyDefinition' || parent.type === 'MethodDefinition') && parent.key === node && !parent.computed) return
          // `feature:` labels / `break feature` — not references.
          if ((parent.type === 'LabeledStatement' || parent.type === 'BreakStatement' || parent.type === 'ContinueStatement') && parent.label === node) return
          // TS type positions (`typeof feature`, `feature` as a type) are erased and never affect DCE.
          if (parent.type === 'TSTypeQuery' || parent.type === 'TSTypeReference' || parent.type === 'TSQualifiedName') return
        }

        if (parent && parent.type === 'CallExpression' && parent.callee === node && !parent.optional) {
          const args = parent.arguments as AnyNode[]
          const key = args.length === 1 ? stringKey(args[0]) : undefined
          if (key === undefined) {
            this.error("vite-layers: feature() takes a single string-literal key, e.g. feature('billing').", node.start)
          }
          if (!flat.has(key)) {
            const known = [...flat.keys()].map(k => `'${k}'`).join(', ') || '(none defined)'
            this.error(`vite-layers: unknown feature flag '${key}'. Known flags: ${known}.`, args[0]!.start)
          }
          edits.push([parent.start, parent.end, literalOf(flat.get(key))])
        } else {
          this.error(
            'vite-layers: `feature` is a compile-time macro — call it directly with a string-literal key. ' +
              'Aliasing, destructuring, or passing it as a value defeats dead-code elimination and is not allowed.',
            node.start,
          )
        }
      }

      // Scope-aware descent: a reference is the macro only if no enclosing scope re-binds its name
      // (so an unrelated local `feature` param/const/catch/… is left untouched, not falsely rejected).
      const descend = (node: AnyNode, parent: AnyNode | null, shadow: Set<string>) => {
        let childShadow = shadow
        if (SCOPE_NODES.has(node.type)) {
          const bound = scopeBindings(node, locals)
          if (bound.size) {
            childShadow = new Set(shadow)
            for (const n of bound) childShadow.add(n)
          }
        }
        if (node.type === 'Identifier' && locals.has(node.name as string) && !shadow.has(node.name as string)) {
          handleRef(node, parent)
        }
        // Inline the child walk (instead of `eachChild(node, child => …)`) so this hot recursion
        // allocates no per-node closure — `descend` is called once per AST node on a macro module.
        for (const key in node) {
          if (CHILD_SKIP.has(key)) continue
          const child = node[key]
          if (Array.isArray(child)) {
            for (const c of child) if (c && typeof (c as AnyNode).type === 'string') descend(c as AnyNode, node, childShadow)
          } else if (child && typeof (child as AnyNode).type === 'string') {
            descend(child as AnyNode, node, childShadow)
          }
        }
      }
      descend(program, null, new Set())

      for (const [start, end, text] of edits) s.overwrite(start, end, text)
      for (const decl of importDecls) s.remove(decl.start, decl.end)

      return { code: s.toString(), map: s.generateMap({ source: id, hires: true }) }
      },
    },
  }
}
