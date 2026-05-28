import { describe, expect, it } from 'vitest'
import { syncEnginePlugin } from '../plugin'

describe('syncEnginePlugin', () => {
  it('resolves virtual:sync-engine-registry to a private id', () => {
    const p = syncEnginePlugin({ definitions: 'src/**/*.defs.ts' })
    expect(p.name).toBe('vue-sync-engine:registry')
    expect(p.enforce).toBe('pre')
    const resolved = (p.resolveId as (id: string) => string | null).call({} as never, 'virtual:sync-engine-registry')
    expect(typeof resolved).toBe('string')
    expect(resolved).toContain('virtual:sync-engine-registry')
  })

  it('returns null for unknown ids', () => {
    const p = syncEnginePlugin({ definitions: ['src/a.defs.ts'] })
    expect((p.resolveId as (id: string) => string | null).call({} as never, 'something-else')).toBeNull()
    expect((p.load as (id: string) => string | null).call({} as never, 'something-else')).toBeNull()
  })

  it('emits a module that aggregates entities/queries/mutations', () => {
    const p = syncEnginePlugin({ definitions: ['src/**/*.defs.ts', 'lib/**/*.defs.ts'] })
    const resolved = (p.resolveId as (id: string) => string | null).call({} as never, 'virtual:sync-engine-registry')!
    const code = (p.load as (id: string) => string | null).call({} as never, resolved)!
    expect(code).toContain('import.meta.glob')
    expect(code).toContain('"src/**/*.defs.ts"')
    expect(code).toContain('"lib/**/*.defs.ts"')
    expect(code).toContain('export default { entities, queries, mutations }')
  })

  it('accepts a single string for definitions', () => {
    const p = syncEnginePlugin({ definitions: 'src/single.defs.ts' })
    const resolved = (p.resolveId as (id: string) => string | null).call({} as never, 'virtual:sync-engine-registry')!
    const code = (p.load as (id: string) => string | null).call({} as never, resolved)!
    expect(code).toContain('"src/single.defs.ts"')
  })
})
