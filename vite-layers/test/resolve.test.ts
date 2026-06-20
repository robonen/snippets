import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Plugin } from 'vite'
import { createLayeredResolution, layersResolver } from '../src/resolve'

const here = dirname(fileURLToPath(import.meta.url))
const toPosix = (p: string) => p.replace(/\\/g, '/')
const fixture = (p: string) => toPosix(resolve(here, 'fixtures', 'resolve', p))

// `resolveId` is now a filtered object hook (`{ filter, handler }`); call its handler.
const callResolveId = (plugin: Plugin, id: string, importer?: string): string | null => {
  const h = plugin.resolveId
  const fn = (typeof h === 'function' ? h : h?.handler) as (id: string, importer?: string) => string | null
  return fn(id, importer)
}

// roots ordered high→low priority: brand overrides base.
const roots = [fixture('brand/src'), fixture('base/src')]
const plugin = layersResolver({ roots })
const resolveId = (id: string, importer?: string): string | null => callResolveId(plugin, id, importer)

describe('layersResolver', () => {
  it('ignores non-layered ids', () => {
    expect(resolveId('vue')).toBeNull()
    expect(resolveId('./relative')).toBeNull()
    expect(resolveId('#layers/base/x')).toBeNull()
  })

  it('resolves @/ to the highest-priority layer that has the file', () => {
    expect(resolveId('@/components/Header.vue')).toBe(fixture('brand/src/components/Header.vue'))
  })

  it('falls through to a lower layer when the higher one lacks the file', () => {
    expect(resolveId('@/components/Footer.vue')).toBe(fixture('base/src/components/Footer.vue'))
  })

  it('supports the ~/ prefix identically', () => {
    expect(resolveId('~/components/Header.vue')).toBe(fixture('brand/src/components/Header.vue'))
  })

  it('probes <path>/index<ext> when no direct file exists', () => {
    expect(resolveId('@/widgets/Card')).toBe(fixture('base/src/widgets/Card/index.ts'))
  })

  it('self-skips: an override importing itself reaches the base layer (super())', () => {
    const brandHeader = fixture('brand/src/components/Header.vue')
    const baseHeader = fixture('base/src/components/Header.vue')
    expect(resolveId('@/components/Header.vue', brandHeader)).toBe(baseHeader)
  })

  describe('super() through a deep (3-layer) extends chain', () => {
    const deepRoots = [fixture('deep/top/src'), fixture('deep/mid/src'), fixture('deep/base/src')]
    const dp = layersResolver({ roots: deepRoots })
    const drid = (id: string, importer?: string) => callResolveId(dp, id, importer)
    const W = (layer: string) => fixture(`deep/${layer}/src/components/Widget.vue`)

    it('a normal import resolves to the highest layer', () => {
      expect(drid('@/components/Widget.vue')).toBe(W('top'))
    })

    it('super() resolves to the NEXT-LOWER layer at every level (never upward)', () => {
      expect(drid('@/components/Widget.vue', W('top'))).toBe(W('mid'))
      // the regression guard: a shadowed middle layer must reach `base`, not jump back up to `top`
      expect(drid('@/components/Widget.vue', W('mid'))).toBe(W('base'))
    })

    it('super() from the lowest layer resolves to null (nothing beneath it)', () => {
      expect(drid('@/components/Widget.vue', W('base'))).toBeNull()
    })
  })

  it('returns null when nothing matches across layers', () => {
    expect(resolveId('@/components/Missing.vue')).toBeNull()
  })

  it('preserves query suffixes (?inline / ?raw / ?vue&type=…)', () => {
    expect(resolveId('@/components/Header.vue?vue&type=style&lang.css')).toBe(
      `${fixture('brand/src/components/Header.vue')}?vue&type=style&lang.css`,
    )
  })

  it('honors custom prefixes and extensions', () => {
    const p = layersResolver({ roots, prefixes: ['#/'], extensions: ['.ts'] })
    const rid = (id: string) => callResolveId(p, id)
    expect(rid('#/widgets/Card')).toBe(fixture('base/src/widgets/Card/index.ts')) // index probe, .ts only
    expect(rid('@/components/Header.vue')).toBeNull() // '@/' is not a configured prefix here
  })

  it('caches candidates (repeated resolveId is stable, served from cache)', () => {
    const p = layersResolver({ roots })
    const rid = (id: string) => callResolveId(p, id)
    expect(rid('@/components/Header.vue')).toBe(rid('@/components/Header.vue'))
    expect(rid('@/components/Footer.vue')).toBe(fixture('base/src/components/Footer.vue'))
  })
})

describe('createLayeredResolution (introspection core)', () => {
  it('parse() splits prefix/sub/query and rejects non-layered ids', () => {
    const r = createLayeredResolution({ roots })
    expect(r.parse('@/components/Header.vue?raw')).toEqual({ prefix: '@/', sub: 'components/Header.vue', query: '?raw' })
    expect(r.parse('vue')).toBeNull()
    expect(r.parse('#layers/base/x')).toBeNull()
  })

  it('candidates() lists every matching file across layers, high→low', () => {
    const r = createLayeredResolution({ roots })
    expect(r.candidates('components/Header.vue')).toEqual([
      fixture('brand/src/components/Header.vue'),
      fixture('base/src/components/Header.vue'),
    ])
    expect(r.candidates('components/Footer.vue')).toEqual([fixture('base/src/components/Footer.vue')])
    expect(r.candidates('components/Missing.vue')).toEqual([])
  })

  it('records resolutions only when enabled, newest-first, de-duplicated by id+importer', () => {
    const off = createLayeredResolution({ roots })
    off.resolveId('@/components/Header.vue')
    expect(off.records()).toEqual([]) // recording disabled by default

    const r = createLayeredResolution({ roots, record: 10 })
    r.resolveId('@/components/Header.vue')
    r.resolveId('@/components/Footer.vue')
    r.resolveId('@/components/Header.vue') // repeat → updates the existing entry, no duplicate
    const recs = r.records()
    expect(recs).toHaveLength(2)
    expect(recs[0]!.id).toBe('@/components/Header.vue') // most-recent first
    expect(recs[0]!.candidates).toEqual([
      fixture('brand/src/components/Header.vue'),
      fixture('base/src/components/Header.vue'),
    ])
    expect(recs[0]!.selfIndex).toBe(-1) // a normal (non-self) import

    r.clearRecords()
    expect(r.records()).toEqual([])
  })

  it('records a super() self-import with the importer position', () => {
    const r = createLayeredResolution({ roots, record: 10 })
    const brandHeader = fixture('brand/src/components/Header.vue')
    expect(r.resolveId('@/components/Header.vue', brandHeader)).toBe(fixture('base/src/components/Header.vue'))
    expect(r.records()[0]!.selfIndex).toBe(0) // importer is the top candidate → super() skips to #1
  })

  it('keeps the log bounded to the record size', () => {
    const r = createLayeredResolution({ roots, record: 2 })
    r.resolveId('@/components/Header.vue')
    r.resolveId('@/components/Footer.vue')
    r.resolveId('@/components/Missing.vue')
    expect(r.records()).toHaveLength(2) // oldest (Header) evicted
    expect(r.records().map(x => x.id)).toEqual(['@/components/Missing.vue', '@/components/Footer.vue'])
  })

  it('the plugin and a shared resolution stay in sync', () => {
    const shared = createLayeredResolution({ roots, record: 10 })
    const plugin = layersResolver(shared)
    callResolveId(plugin, '@/components/Header.vue')
    // the resolution the plugin wraps recorded the resolveId the plugin handled
    expect(shared.records()).toHaveLength(1)
    expect(shared.records()[0]!.resolved).toBe(fixture('brand/src/components/Header.vue'))
  })
})
