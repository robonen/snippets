import { describe, expect, it } from 'vitest'
import type { Plugin } from 'vite'
import { FEATURE_MODULE, featurePlugin, featuresDts, flattenFeatures } from '../src/features'

// Minimal TransformPluginContext stand-in: `this.error` throws (as it does for a real build failure).
const ctx = {
  error(msg: string | { message: string }): never {
    throw new Error(typeof msg === 'string' ? msg : msg.message)
  },
}

function transform(features: Record<string, unknown>, code: string, id = '/app/src/x.ts') {
  const t = featurePlugin(features).transform as Plugin['transform']
  const handler = (typeof t === 'function' ? t : t!.handler) as (
    this: unknown,
    code: string,
    id: string,
  ) => { code: string; map?: unknown } | null
  return handler.call(ctx, code, id)
}

describe('featurePlugin', () => {
  it("replaces feature('key') with the flag literal and removes the import", () => {
    const out = transform({ billing: false }, `import { feature } from '#feature'\nexport const r = feature('billing') ? 1 : 2\n`)
    expect(out).not.toBeNull()
    expect(out!.code).toContain('export const r = false ? 1 : 2')
    expect(out!.code).not.toContain("from '#feature'")
    expect((out!.map as { mappings?: string }).mappings).toBeTruthy()
  })

  it('resolves nested dotted keys', () => {
    const out = transform({ nested: { deep: { on: true } } }, `import { feature } from '#feature'\nconst a = feature('nested.deep.on')\n`)
    expect(out!.code).toContain('const a = true')
  })

  it('substitutes an object-valued key as a parenthesized literal (valid in any position)', () => {
    const out = transform({ nested: { on: true } }, `import { feature } from '#feature'\nconst a = feature('nested')\n`)
    expect(out!.code).toContain('const a = ({"on":true})')
  })

  it('honours an import alias (import { feature as f })', () => {
    const out = transform({ billing: true }, `import { feature as f } from '#feature'\nconst a = f('billing')\n`)
    expect(out!.code).toContain('const a = true')
  })

  it('also accepts the vite-layers/feature specifier', () => {
    const out = transform({ billing: true }, `import { feature } from 'vite-layers/feature'\nconst a = feature('billing')\n`)
    expect(out!.code).toContain('const a = true')
  })

  it('parses TSX and gates JSX expressions', () => {
    const out = transform({ billing: false }, `import { feature } from '#feature'\nexport const n = feature('billing') && 1\n`, '/app/src/x.tsx')
    expect(out!.code).toContain('export const n = false && 1')
  })

  it('fails the build on a dynamic (non-literal) key', () => {
    expect(() => transform({ billing: true }, `import { feature } from '#feature'\nconst k = 'billing'\nexport const a = feature(k)\n`))
      .toThrow(/single string-literal key/)
  })

  it('fails the build when the macro is aliased / passed as a value', () => {
    expect(() => transform({ billing: true }, `import { feature } from '#feature'\nexport const g = feature\n`))
      .toThrow(/compile-time macro/)
  })

  it('fails the build on an unknown flag', () => {
    expect(() => transform({ billing: true }, `import { feature } from '#feature'\nexport const a = feature('bling')\n`))
      .toThrow(/unknown feature flag 'bling'/)
  })

  it('fails the build on re-exporting the macro', () => {
    expect(() => transform({ billing: true }, `export { feature } from '#feature'\n`))
      .toThrow(/re-exporting the `feature` macro/)
  })

  it('fails the build on a default import of the macro', () => {
    expect(() => transform({ billing: true }, `import feature from '#feature'\nconst a = feature('billing')\n`))
      .toThrow(/named \{ feature \}/)
  })

  it('fails the build on a namespace import of the macro', () => {
    expect(() => transform({ billing: true }, `import * as F from '#feature'\nconst a = F.feature('billing')\n`))
      .toThrow(/named \{ feature \}/)
  })

  it('leaves modules without the macro import untouched (even if the token appears in a string)', () => {
    expect(transform({ billing: true }, 'export const x = 1\n')).toBeNull()
    expect(transform({ billing: true }, `export const s = 'mentions #feature in a string'\n`)).toBeNull()
  })

  it('fails loudly (never silently skips) when a module that imports the macro fails to parse', () => {
    // oxc reports errors without throwing and yields an empty body — which must NOT look like "no macro".
    expect(() => transform({ billing: true }, `import { feature } from '#feature'\nconst x = @@@ broken(((`))
      .toThrow(/syntax error|could not parse/i)
  })

  it('does not over-fail: a broken module that only mentions #feature in a string is left alone', () => {
    expect(transform({ billing: true }, `const s = 'see #feature'\nconst x = @@@ broken(((`)).toBeNull()
  })

  it('skips node_modules', () => {
    expect(transform({ billing: true }, `import { feature } from '#feature'\nconst a = feature('billing')\n`, '/x/node_modules/y.js')).toBeNull()
  })

  it('leaves an unrelated local named `feature` (param/const) untouched — no false positive', () => {
    const arrow = transform({ billing: true }, `import { feature } from '#feature'\nexport const a = feature('billing')\nexport const xs = [1].map(feature => feature + 1)\n`)
    expect(arrow!.code).toContain('export const a = true') // the real macro call still folds
    expect(arrow!.code).toContain('feature => feature + 1') // the shadowing param is left alone
    const local = transform({ billing: true }, `import { feature } from '#feature'\nexport function f(){ const feature = () => 1; return feature() }\nexport const a = feature('billing')\n`)
    expect(local!.code).toContain('const feature = () => 1; return feature()')
    expect(local!.code).toContain('export const a = true')
  })

  it('allows type-position references (typeof feature) and ignores `import type`', () => {
    const out = transform({ billing: true }, `import { feature } from '#feature'\ntype T = typeof feature\nexport const a = feature('billing')\n`)
    expect(out!.code).toContain('export const a = true') // the value call folds; the type query is skipped
    // a pure `import type { feature }` is erased — nothing to compile
    expect(transform({ billing: true }, `import type { feature } from '#feature'\nexport type T = typeof feature\n`)).toBeNull()
  })

  it('fails the build (never silently mis-substitutes) on a malformed template-literal key', () => {
    // An untagged template with a bad escape is a parse error → caught loudly; if it ever parsed
    // with a null cooked value, stringKey routes it to the string-literal-key error instead.
    expect(() => transform({ billing: true }, 'import { feature } from \'#feature\'\nconst a = feature(`\\unicode`)\n'))
      .toThrow(/vite-layers/)
  })
})

describe('feature value validation', () => {
  it('rejects unsupported value types with a clear error (plugin + dts)', () => {
    for (const features of [{ a: 1n }, { a: () => 1 }, { a: Number.NaN }, { a: Number.POSITIVE_INFINITY }, { a: Symbol('x') }, { a: new Date() }]) {
      expect(() => featurePlugin(features as Record<string, unknown>)).toThrow(/unsupported value type/)
      expect(() => featuresDts(features as Record<string, unknown>)).toThrow(/unsupported value type/)
    }
  })

  it('rejects a dotted key colliding with a nested path', () => {
    expect(() => featurePlugin({ 'a.b': 1, a: { b: 2 } })).toThrow(/defined twice/)
    expect(() => featuresDts({ 'a.b': 1, a: { b: 2 } })).toThrow(/defined twice/)
  })

  it('accepts JSON-like values (bool, finite number, string, null, plain object, array)', () => {
    expect(() => featurePlugin({ a: true, b: 1.5, c: 'x', d: null, e: { f: 1 }, g: ['x', 2] })).not.toThrow()
  })
})

describe('featuresDts', () => {
  it('augments LayerFeatures on #feature with literal types and dotted keys', () => {
    const dts = featuresDts({ billing: false, nested: { enabled: true }, 'kebab-flag': true, count: 2 })
    expect(dts).toContain(`import '${FEATURE_MODULE}'`)
    expect(dts).toContain(`declare module '${FEATURE_MODULE}'`)
    expect(dts).toContain('interface LayerFeatures')
    expect(dts).toContain('billing: false') // literal, not widened `boolean`
    expect(dts).toContain('nested: { enabled: true }')
    expect(dts).toContain('"nested.enabled": true') // dotted leaf key for direct DCE access
    expect(dts).toContain('"kebab-flag": true') // non-identifier keys are now fully supported
    expect(dts).toContain('count: 2')
  })

  it('renders an empty augmentation when there are no features', () => {
    expect(featuresDts({})).toContain('interface LayerFeatures {\n  }')
  })
})

describe('flattenFeatures', () => {
  it('emits both intermediate and leaf dotted paths in order', () => {
    expect(flattenFeatures({ a: { b: 1 }, c: true })).toEqual([
      ['a', { b: 1 }],
      ['a.b', 1],
      ['c', true],
    ])
  })
})
