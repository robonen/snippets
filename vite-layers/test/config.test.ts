import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveLayerStack } from '../src/config'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = (p: string) => resolve(here, 'fixtures', p)
const toPosix = (p: string) => p.replace(/\\/g, '/')
const names = (s: { layers: { name: string }[] }) => s.layers.map(l => l.name)

describe('resolveLayerStack', () => {
  it('orders the stack project-first (layers[0] = project), then extends depth-first', async () => {
    const stack = await resolveLayerStack(fixture('stack/app'))
    expect(names(stack)).toEqual(['app', 'base', 'core'])
    expect(stack.layers[0].name).toBe('app')
  })

  it('merges configs with project winning on key collision (defu first-wins)', async () => {
    const { merged } = await resolveLayerStack(fixture('stack/app'))
    const features = merged.features as Record<string, unknown>
    expect(features.shared).toBe('app') // app overrides base overrides core
    expect(features).toMatchObject({ app: true, base: true, core: true })
  })

  it('resolves srcDir per layer (default "src")', async () => {
    const stack = await resolveLayerStack(fixture('stack/app'))
    expect(stack.layers[0].srcDir).toBe(toPosix(resolve(fixture('stack/app'), 'src')))
  })

  it('dedupes a diamond by rootDir (shared base appears once, first-wins position)', async () => {
    const stack = await resolveLayerStack(fixture('diamond/app'))
    expect(names(stack)).toEqual(['app', 'b', 'd', 'c'])
    expect(names(stack).filter(n => n === 'd')).toHaveLength(1)
  })

  it('survives a cycle (A→B→A) without stack overflow [improvement over raw c12]', async () => {
    const stack = await resolveLayerStack(fixture('cycle/x'))
    expect(names(stack)).toEqual(['x', 'y'])
  })

  it('auto-scans layers/* with descending priority (Z > A / higher numeric prefix)', async () => {
    const stack = await resolveLayerStack(fixture('autoscan'))
    // project first, then 2.z-layer before 1.a-layer (descending sort)
    expect(names(stack)).toEqual(['root', '2.z-layer', '1.a-layer'])
  })

  it('applies per-layer $production/$development overrides by Vite mode', async () => {
    const dev = await resolveLayerStack(fixture('env/app'), { mode: 'development' })
    const prod = await resolveLayerStack(fixture('env/app'), { mode: 'production' })
    expect((dev.merged.features as Record<string, unknown>).flag).toBe('dev') // no $development block
    expect((prod.merged.features as Record<string, unknown>).flag).toBe('prod') // $production wins
    expect((prod.merged.features as Record<string, unknown>).shared).toBe(true) // base flags preserved
  })
})
