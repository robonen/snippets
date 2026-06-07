import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { layersResolver } from '../src/resolve'

const here = dirname(fileURLToPath(import.meta.url))
const toPosix = (p: string) => p.replace(/\\/g, '/')
const fixture = (p: string) => toPosix(resolve(here, 'fixtures', 'resolve', p))

// roots ordered high→low priority: brand overrides base.
const roots = [fixture('brand/src'), fixture('base/src')]
const plugin = layersResolver({ roots })
const resolveId = (id: string, importer?: string): string | null =>
  (plugin.resolveId as (id: string, importer?: string) => string | null)(id, importer)

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
    const rid = (id: string) => (p.resolveId as (id: string) => string | null)(id)
    expect(rid('#/widgets/Card')).toBe(fixture('base/src/widgets/Card/index.ts')) // index probe, .ts only
    expect(rid('@/components/Header.vue')).toBeNull() // '@/' is not a configured prefix here
  })

  it('caches candidates (repeated resolveId is stable, served from cache)', () => {
    const p = layersResolver({ roots })
    const rid = (id: string) => (p.resolveId as (id: string) => string | null)(id)
    expect(rid('@/components/Header.vue')).toBe(rid('@/components/Header.vue'))
    expect(rid('@/components/Footer.vue')).toBe(fixture('base/src/components/Footer.vue'))
  })
})
