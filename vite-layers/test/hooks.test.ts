import { describe, expect, it } from 'vitest'
import { createLayerHooks, registerLayerHooks } from '../src/hooks'
import type { Layer, LayerStack } from '../src/types'

const fakeStack = (): LayerStack => ({ merged: {}, layers: [] })

describe('layer hooks', () => {
  it('accumulates layer hooks base-first, then programmatic, and runs serially', async () => {
    const hooks = createLayerHooks()
    const order: string[] = []
    // layers are high→low; registration is base-first (reversed), programmatic last.
    const layers: Pick<Layer, 'config'>[] = [
      { config: { hooks: { 'layers:resolved': () => void order.push('high') } } },
      { config: { hooks: { 'layers:resolved': () => void order.push('low') } } },
    ]
    registerLayerHooks(hooks, layers, { 'layers:resolved': () => void order.push('prog') })
    await hooks.callHook('layers:resolved', fakeStack())
    expect(order).toEqual(['low', 'high', 'prog'])
  })

  it('handlers mutate the shared argument (mutation-style)', async () => {
    const hooks = createLayerHooks()
    const layers: Pick<Layer, 'config'>[] = [
      { config: { hooks: { 'layers:resolved': s => void ((s.merged.features ??= {}).x = 1) } } },
    ]
    registerLayerHooks(hooks, layers)
    const stack = fakeStack()
    await hooks.callHook('layers:resolved', stack)
    expect((stack.merged.features as Record<string, unknown>).x).toBe(1)
  })

  it('awaits async handlers serially', async () => {
    const hooks = createLayerHooks()
    const order: string[] = []
    const layers: Pick<Layer, 'config'>[] = [
      // high layer (registered last): async, must still complete before callHook resolves
      { config: { hooks: { 'layers:resolved': async () => { await Promise.resolve(); order.push('high') } } } },
      { config: { hooks: { 'layers:resolved': () => void order.push('low') } } },
    ]
    registerLayerHooks(hooks, layers)
    await hooks.callHook('layers:resolved', fakeStack())
    expect(order).toEqual(['low', 'high'])
  })
})
