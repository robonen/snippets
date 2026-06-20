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

const featCtx = {
  error(m: string | { message: string }): never {
    throw new Error(typeof m === 'string' ? m : m.message)
  },
}
const runTransform = (plugin: Plugin, code: string, id = '/app/src/x.ts') => {
  const t = plugin.transform as Plugin['transform']
  const handler = (typeof t === 'function' ? t : t!.handler) as (
    this: unknown,
    c: string,
    i: string,
  ) => { code?: unknown } | null
  return handler.call(featCtx, code, id)
}

describe('buildViteConfig', () => {
  it('registers the feature macro plugin and aliases #feature to the macro entry', async () => {
    const cfg = await build(fixture('stack/app'))
    const plugins = (cfg.plugins as Plugin[]).flat(Infinity as 1) as Plugin[]
    expect(plugins.some(p => p?.name === 'vite-layers:features')).toBe(true)
    const alias = (cfg.resolve as { alias: Record<string, string> }).alias
    expect(alias['#feature']).toMatch(/\/src\/feature\.ts$/)
  })

  it('emits no __FEATURES__ define (flags compile via the feature() macro, not define)', async () => {
    const cfg = await build(fixture('stack/app'))
    const define = (cfg.define ?? {}) as Record<string, string>
    expect(Object.keys(define).some(k => k.startsWith('__FEATURES__'))).toBe(false)
  })

  it('compiles feature() against the merged flags; layers:resolved mutates them first, vite:config runs last', async () => {
    const fn = (await buildViteConfig(fixture('stack/app'), {
      hooks: {
        'layers:resolved': s => void ((s.merged.features ??= {}).injected = true),
        'vite:config': ctx => void (ctx.config.define = { ...ctx.config.define, INJECTED: '"yes"' }),
      },
    })) as UserConfigFnObject
    const cfg = (await fn(env)) as UserConfig
    const feat = (cfg.plugins as Plugin[]).flat(Infinity as 1).find(p => (p as Plugin)?.name === 'vite-layers:features') as Plugin
    const out = runTransform(feat, `import { feature } from '#feature'\nexport const a = feature('injected')\n`)
    expect(String(out?.code)).toContain('export const a = true') // layers:resolved ran before the macro read features
    expect((cfg.define as Record<string, string>).INJECTED).toBe('"yes"') // vite:config ran at the very end
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
