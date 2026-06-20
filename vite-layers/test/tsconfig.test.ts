import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createLayerHooks } from '../src/hooks'
import { generateTsConfig } from '../src/tsconfig'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = (p: string) => resolve(here, 'fixtures', p)

describe('generateTsConfig', () => {
  it('maps @/* and ~/* to every layer srcDir in priority order (first-match = runtime resolver)', async () => {
    const { tsconfig } = await generateTsConfig(fixture('stack/app'))
    const paths = tsconfig.compilerOptions!.paths as Record<string, string[]>
    // genDir is <app>/.vite-layers, so each src is one level up + the layer path
    expect(paths['@/*']).toEqual([
      '../src/*', // stack/app/src
      '../../base/src/*', // stack/base/src
      '../../core/src/*', // stack/core/src
    ])
    expect(paths['~/*']).toEqual(paths['@/*'])
  })

  it('maps ~~/@@ to the project root (bare + wildcard)', async () => {
    const { tsconfig } = await generateTsConfig(fixture('stack/app'))
    const paths = tsconfig.compilerOptions!.paths as Record<string, string[]>
    expect(paths['~~']).toEqual(['..'])
    expect(paths['~~/*']).toEqual(['../*'])
    expect(paths['@@']).toEqual(paths['~~'])
  })

  it('emits #layers/<name>/* per layer rootDir', async () => {
    const { tsconfig } = await generateTsConfig(fixture('stack/app'))
    const paths = tsconfig.compilerOptions!.paths as Record<string, string[]>
    expect(paths['#layers/app/*']).toEqual(['../*'])
    expect(paths['#layers/base/*']).toEqual(['../../base/*'])
    expect(paths['#layers/core/*']).toEqual(['../../core/*'])
  })

  it('includes every layer srcDir glob', async () => {
    const { tsconfig } = await generateTsConfig(fixture('stack/app'))
    expect(tsconfig.include).toEqual(
      expect.arrayContaining(['../src/**/*', '../../base/src/**/*', '../../core/src/**/*']),
    )
  })

  it('sets framework-neutral defaults with no Vue/JSX specifics', async () => {
    const { tsconfig } = await generateTsConfig(fixture('stack/app'))
    const co = tsconfig.compilerOptions!
    expect(co.moduleResolution).toBe('Bundler')
    expect(co.strict).toBe(true)
    expect(co).not.toHaveProperty('baseUrl') // deprecated in TS 6; paths resolve relative to the file
    expect(co).not.toHaveProperty('jsx')
    expect(co).not.toHaveProperty('jsxImportSource')
  })

  it('merges per-layer `tsConfig` from app.config.ts across the stack (like Nuxt typescript.tsConfig)', async () => {
    const { tsconfig } = await generateTsConfig(fixture('tsconfig-cfg/app'))
    const co = tsconfig.compilerOptions as Record<string, unknown>
    expect(co.strict).toBe(false) // app layer overrides the default `true`
    expect(co.lib).toContain('ESNext') // from the app layer
    expect(co.types).toContain('node') // inherited from the base layer
    expect(co.moduleResolution).toBe('Bundler') // untouched default
    expect((co.paths as Record<string, string[]>)['@/*']).toBeDefined()
  })

  it('opts.tsConfig wins over per-layer tsConfig and defaults, but never the generated paths', async () => {
    const { tsconfig } = await generateTsConfig(fixture('stack/app'), {
      tsConfig: { compilerOptions: { strict: false, jsx: 'preserve', paths: { evil: ['/hax'] } } },
    })
    const co = tsconfig.compilerOptions as Record<string, unknown>
    expect(co.strict).toBe(false) // user wins over default
    expect(co.jsx).toBe('preserve') // user can add options
    const paths = co.paths as Record<string, string[]>
    expect(paths.evil).toBeUndefined() // generated paths are authoritative
    expect(paths['@/*']).toBeDefined()
  })

  it('generates a separate node tsconfig for config files (node-side, no DOM, no paths)', async () => {
    const r = await generateTsConfig(fixture('stack/app'))
    expect(r.nodeFile.replace(/\\/g, '/')).toMatch(/\/\.vite-layers\/tsconfig\.node\.json$/)
    const co = r.nodeTsconfig.compilerOptions as Record<string, unknown>
    expect(co.lib).toEqual(['ESNext']) // no DOM
    expect(co.paths).toEqual({}) // config files don't use @/
    expect(co.noEmit).toBe(true)
    // includes app.config / vite.config of each layer (app + base + core)
    expect(r.nodeTsconfig.include).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/app\.config\.\*$/),
        expect.stringMatching(/vite\.config\.\*$/),
      ]),
    )
    // ...and the app config no longer pulls in config files
    expect((r.tsconfig.include ?? []).some(p => p.includes('app.config'))).toBe(false)
  })

  it('lets a tsconfig:generate hook mutate the node tsconfig', async () => {
    const hooks = createLayerHooks()
    hooks.hook('tsconfig:generate', ctx => void (ctx.nodeTsconfig.compilerOptions!.removeComments = true))
    const r = await generateTsConfig(fixture('stack/app'), { hooks })
    expect((r.nodeTsconfig.compilerOptions as Record<string, unknown>).removeComments).toBe(true)
  })

  it('includes ./features.d.ts and returns its generated content + path', async () => {
    const r = await generateTsConfig(fixture('stack/app'))
    expect(r.tsconfig.include).toContain('./features.d.ts')
    expect(r.dtsFile.replace(/\\/g, '/')).toMatch(/\/\.vite-layers\/features\.d\.ts$/)
    expect(r.dts).toContain(`declare module '#feature'`)
  })

  it('maps #feature to the macro entry so tsc resolves the feature() import', async () => {
    const { tsconfig } = await generateTsConfig(fixture('stack/app'))
    const paths = tsconfig.compilerOptions!.paths as Record<string, string[]>
    expect(paths['#feature']?.[0]).toMatch(/\/src\/feature$/)
  })

  it('reuses a provided stack instead of resolving again (O2)', async () => {
    const stack = {
      merged: { features: { onlyInFake: true } },
      layers: [
        { rootDir: fixture('stack/app'), srcDir: resolve(fixture('stack/app'), 'src'), name: 'FAKELAYER', config: {} },
      ],
    }
    const r = await generateTsConfig(fixture('stack/app'), { stack: stack as never })
    const paths = r.tsconfig.compilerOptions!.paths as Record<string, string[]>
    expect(Object.keys(paths)).toContain('#layers/FAKELAYER/*') // proves the fake stack was used
    expect(r.dts).toContain('onlyInFake: true') // literal type, from the fake stack's features
  })
})
