import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { publicLayersPlugin } from '../src/public'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = (p: string) => resolve(here, 'fixtures', p)

const callConfig = (p: { config?: unknown }) => (p.config as () => unknown)()

function runGenerateBundle(p: { generateBundle?: unknown }): Record<string, string> {
  const emitted: Record<string, string> = {}
  const ctx = {
    emitFile: ({ fileName, source }: { fileName: string; source: Buffer | string }) => {
      emitted[fileName] = source.toString()
    },
  }
  ;(p.generateBundle as (this: unknown, ...a: unknown[]) => void).call(ctx, {}, {}, false)
  return emitted
}

describe('publicLayersPlugin', () => {
  const high = fixture('public/high/public')
  const low = fixture('public/low/public')

  it('disables Vite publicDir when layers have public/, otherwise no-op', () => {
    expect(callConfig(publicLayersPlugin([high, low]))).toEqual({ publicDir: false })
    expect(callConfig(publicLayersPlugin([fixture('public/none/public')]))).toBeUndefined()
  })

  it('emits assets first-match-wins (higher overrides, lower fills gaps, nested ok)', () => {
    const emitted = runGenerateBundle(publicLayersPlugin([high, low]))
    expect(emitted['logo.svg']).toBe('HIGH_LOGO') // overridden by the higher layer
    expect(emitted['shared.txt']).toBe('LOW_SHARED') // inherited from the lower layer
    expect(emitted['img/icon.svg']).toBe('LOW_ICON') // nested, from the lower layer
  })
})
