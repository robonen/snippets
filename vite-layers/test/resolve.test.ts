import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
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

  describe('#super — the explicit super() specifier', () => {
    const brandHeader = fixture('brand/src/components/Header.vue')
    const baseHeader = fixture('base/src/components/Header.vue')

    it('bare #super re-resolves the importer’s own path from the next-lower layer', () => {
      expect(resolveId('#super', brandHeader)).toBe(baseHeader)
    })

    it('#super/<path> resolves any path from strictly below the importer’s layer', () => {
      // the importer is NOT an override of Header — the implicit self-skip can't express this
      expect(resolveId('#super/components/Header.vue', fixture('brand/src/main.ts'))).toBe(baseHeader)
    })

    it('never resolves to the importer’s own layer (strictly below, not first match)', () => {
      expect(resolveId('#super/components/Header.vue', brandHeader)).toBe(baseHeader)
    })

    it('returns null from the lowest layer / for a path absent below', () => {
      expect(resolveId('#super', baseHeader)).toBeNull()
      // Footer.vue exists only in base — from a brand importer it resolves DOWN to base's copy…
      expect(resolveId('#super/components/Footer.vue', brandHeader)).toBe(fixture('base/src/components/Footer.vue'))
      // …but from base itself there is nothing beneath.
      expect(resolveId('#super/components/Footer.vue', fixture('base/src/components/Footer.vue'))).toBeNull()
    })

    it('returns null when the importer is outside the layer stack (or absent)', () => {
      expect(resolveId('#super')).toBeNull()
      expect(resolveId('#super/components/Header.vue', '/somewhere/else/file.ts')).toBeNull()
    })

    it('preserves query suffixes on both forms', () => {
      expect(resolveId('#super?raw', brandHeader)).toBe(`${baseHeader}?raw`)
      expect(resolveId('#super/components/Header.vue?vue&type=style', brandHeader)).toBe(`${baseHeader}?vue&type=style`)
    })

    it('probes extensions/index like any layered id', () => {
      expect(resolveId('#super/widgets/Card', brandHeader)).toBe(fixture('base/src/widgets/Card/index.ts'))
    })

    it('composes through a deep (3-layer) chain, one step down per layer', () => {
      const deepRoots = [fixture('deep/top/src'), fixture('deep/mid/src'), fixture('deep/base/src')]
      const dp = layersResolver({ roots: deepRoots })
      const W = (layer: string) => fixture(`deep/${layer}/src/components/Widget.vue`)
      expect(callResolveId(dp, '#super', W('top'))).toBe(W('mid'))
      expect(callResolveId(dp, '#super', W('mid'))).toBe(W('base'))
      expect(callResolveId(dp, '#super', W('base'))).toBeNull()
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

  it('the hook filter matches #super ids but not lookalikes', () => {
    const h = plugin.resolveId as { filter: { id: RegExp } }
    expect(h.filter.id.test('#super')).toBe(true)
    expect(h.filter.id.test('#super/components/Header.vue')).toBe(true)
    expect(h.filter.id.test('#super?raw')).toBe(true)
    expect(h.filter.id.test('#superstition')).toBe(false)
    expect(h.filter.id.test('@/components/Header.vue')).toBe(true)
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

  it('parse() accepts #super/ as a pseudo-prefix (so devtools can show its candidate stack)', () => {
    const r = createLayeredResolution({ roots })
    expect(r.parse('#super/components/Header.vue?raw')).toEqual({
      prefix: '#super/',
      sub: 'components/Header.vue',
      query: '?raw',
    })
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

  describe('targeted invalidation (invalidateFile / invalidateDir)', () => {
    // Real temp layers — invalidation is about reacting to FS changes, fixtures can't change.
    let tmp: string
    const setup = () => {
      tmp = mkdtempSync(join(tmpdir(), 'vite-layers-inv-'))
      const brandSrc = join(tmp, 'brand/src')
      const baseSrc = join(tmp, 'base/src')
      mkdirSync(join(baseSrc, 'components'), { recursive: true })
      mkdirSync(join(brandSrc, 'components'), { recursive: true })
      writeFileSync(join(baseSrc, 'components/Button.ts'), 'export default 1')
      return { brandSrc, baseSrc, r: createLayeredResolution({ roots: [brandSrc, baseSrc] }) }
    }
    afterEach(() => rmSync(tmp, { recursive: true, force: true }))

    it('a new file in a higher layer changes the winner after invalidateFile', () => {
      const { brandSrc, baseSrc, r } = setup()
      expect(r.resolveId('@/components/Button')).toBe(toPosix(join(baseSrc, 'components/Button.ts'))) // cached
      const override = join(brandSrc, 'components/Button.ts')
      writeFileSync(override, 'export default 2')
      // control: the stale cache still serves the old winner…
      expect(r.resolveId('@/components/Button')).toBe(toPosix(join(baseSrc, 'components/Button.ts')))
      r.invalidateFile(override)
      // …and the targeted invalidation flips it (extension-probe sub `components/Button` was dropped)
      expect(r.resolveId('@/components/Button')).toBe(toPosix(override))
    })

    it('leaves unrelated cache entries warm and ignores files outside every root', () => {
      const { brandSrc, baseSrc, r } = setup()
      writeFileSync(join(baseSrc, 'components/Other.ts'), 'export default 3')
      r.resolveId('@/components/Other')
      const before = r.candidates('components/Other')
      r.invalidateFile(join(brandSrc, 'components/Button.ts')) // different sub
      r.invalidateFile(join(tmp, 'elsewhere/file.ts')) // outside every root — no-op
      expect(r.candidates('components/Other')).toBe(before) // same array identity → still cached
    })

    it('a deleted file falls back to the lower layer after invalidateFile', () => {
      const { brandSrc, baseSrc, r } = setup()
      const override = join(brandSrc, 'components/Button.ts')
      writeFileSync(override, 'export default 2')
      expect(r.resolveId('@/components/Button')).toBe(toPosix(override))
      unlinkSync(override)
      r.invalidateFile(override)
      expect(r.resolveId('@/components/Button')).toBe(toPosix(join(baseSrc, 'components/Button.ts')))
    })

    it('invalidateFile on an index file also drops the bare-dir and dir/index subs', () => {
      const { brandSrc, baseSrc, r } = setup()
      mkdirSync(join(baseSrc, 'widgets/Card'), { recursive: true })
      writeFileSync(join(baseSrc, 'widgets/Card/index.ts'), 'export default 1')
      expect(r.resolveId('@/widgets/Card')).toBe(toPosix(join(baseSrc, 'widgets/Card/index.ts')))
      const override = join(brandSrc, 'widgets/Card/index.ts')
      mkdirSync(join(brandSrc, 'widgets/Card'), { recursive: true })
      writeFileSync(override, 'export default 2')
      r.invalidateFile(override)
      expect(r.resolveId('@/widgets/Card')).toBe(toPosix(override))
    })

    it('invalidateDir drops everything under the dir including its own index sub', () => {
      const { brandSrc, baseSrc, r } = setup()
      mkdirSync(join(brandSrc, 'widgets/Card'), { recursive: true })
      writeFileSync(join(brandSrc, 'widgets/Card/index.ts'), 'export default 2')
      expect(r.resolveId('@/widgets/Card')).toBe(toPosix(join(brandSrc, 'widgets/Card/index.ts')))
      expect(r.resolveId('@/components/Button')).toBe(toPosix(join(baseSrc, 'components/Button.ts')))
      rmSync(join(brandSrc, 'widgets'), { recursive: true })
      r.invalidateDir(join(brandSrc, 'widgets'))
      expect(r.resolveId('@/widgets/Card')).toBeNull() // dir gone, nothing below
      const warm = r.candidates('components/Button')
      expect(r.candidates('components/Button')).toBe(warm) // unrelated entry untouched
    })
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
