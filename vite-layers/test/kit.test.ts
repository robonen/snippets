import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Plugin, UserConfig, UserConfigFnObject } from 'vite'
import { buildViteConfig, dedupePlugins } from '../src/kit'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = (p: string) => resolve(here, 'fixtures', p).replace(/\\/g, '/')
const env = { command: 'build', mode: 'production', isSsrBuild: false, isPreview: false } as const

async function build(appDir: string): Promise<UserConfig> {
  const fn = (await buildViteConfig(appDir)) as UserConfigFnObject
  return (await fn(env)) as UserConfig
}

describe('buildViteConfig', () => {
  it('exposes merged features via __FEATURES__ define (for DCE)', async () => {
    const cfg = await build(fixture('stack/app'))
    const features = JSON.parse((cfg.define as Record<string, string>).__FEATURES__)
    expect(features.shared).toBe('app')
    expect(features).toMatchObject({ app: true, base: true, core: true })
  })

  it('emits dotted feature defines (for dead-code elimination of gated imports)', async () => {
    const cfg = await build(fixture('stack/app'))
    const define = cfg.define as Record<string, string>
    // dotted entry is folded by esbuild to a literal → enables DCE of `__FEATURES__.x ? import() : []`
    expect(define['__FEATURES__.shared']).toBe('"app"')
    expect(define['__FEATURES__.app']).toBe('true')
  })

  it('emits dotted defines at every nesting depth (so nested flags also DCE)', async () => {
    const cfg = await build(fixture('features/app'))
    const define = cfg.define as Record<string, string>
    expect(define['__FEATURES__.billing']).toBe('false')
    expect(define['__FEATURES__.nested.enabled']).toBe('false') // deep leaf → foldable → DCE-able
    expect(define['__FEATURES__.nested.deep.on']).toBe('true')
    expect(define['__FEATURES__.nested']).toBe('{"enabled":false,"deep":{"on":true}}') // intermediate object too
  })

  it('skips non-identifier feature keys in dotted defines (avoids INVALID_DEFINE_CONFIG crash)', async () => {
    const cfg = await build(fixture('features/app'))
    const define = cfg.define as Record<string, string>
    // a dotted define with `kebab-flag` would crash the build; it is skipped here…
    expect(define['__FEATURES__.kebab-flag']).toBeUndefined()
    // …but still readable at runtime via the whole-object define.
    expect(JSON.parse(define.__FEATURES__)['kebab-flag']).toBe(true)
  })

  it('runs lifecycle hooks: layers:resolved mutates features (before define), vite:config mutates config', async () => {
    const fn = (await buildViteConfig(fixture('stack/app'), {
      hooks: {
        'layers:resolved': s => void ((s.merged.features ??= {}).injected = true),
        'vite:config': ctx => void (ctx.config.define = { ...ctx.config.define, INJECTED: '"yes"' }),
      },
    })) as UserConfigFnObject
    const cfg = (await fn(env)) as UserConfig
    const define = cfg.define as Record<string, string>
    expect(define['__FEATURES__.injected']).toBe('true') // layers:resolved ran before featureDefines
    expect(define.INJECTED).toBe('"yes"') // vite:config ran at the very end
  })

  it('registers the layers resolver plugin', async () => {
    const cfg = await build(fixture('stack/app'))
    const plugins = (cfg.plugins as Plugin[]).flat(Infinity as 1) as Plugin[]
    expect(plugins.some(p => p?.name === 'vite-layers:resolve')).toBe(true)
  })

  it('sets ~~/@@ to the project rootDir and #layers/<name> per layer', async () => {
    const cfg = await build(fixture('stack/app'))
    const alias = (cfg.resolve as { alias: Record<string, string> }).alias
    expect(alias['~~']).toBe(fixture('stack/app'))
    expect(alias['@@']).toBe(fixture('stack/app'))
    expect(alias['#layers/app']).toBe(fixture('stack/app'))
    expect(alias['#layers/base']).toBe(fixture('stack/base'))
    expect(alias['#layers/core']).toBe(fixture('stack/core'))
  })

  it('defaults outDir to dist/<app>', async () => {
    const cfg = await build(fixture('stack/app'))
    expect((cfg.build as { outDir: string }).outDir).toBe('dist/app')
  })
})

describe('dedupePlugins', () => {
  it('removes plugins sharing a name, keeping the later (higher-priority) instance in place', () => {
    const a: Plugin = { name: 'vue', apply: 'build' }
    const b: Plugin = { name: 'vue', apply: 'serve' }
    const other: Plugin = { name: 'other' }
    const out = dedupePlugins({ plugins: [a, other, b] }).plugins as Plugin[]
    expect(out).toHaveLength(2)
    expect(out[0]).toBe(b) // position of first 'vue', value of later one
    expect(out[1]).toBe(other)
  })
})
