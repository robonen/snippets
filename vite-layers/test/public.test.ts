import { fileURLToPath } from 'node:url'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { publicLayersPlugin } from '../src/public'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = (p: string) => resolve(here, 'fixtures', p)

const callConfig = (p: { config?: unknown }) => (p.config as () => unknown)()

type ResolvedishConfig = { root: string; build: { outDir: string; copyPublicDir?: boolean } }

/** List every file written under `dir` as `posixRelativePath → contents`. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (d: string) => {
    for (const name of readdirSync(d, { withFileTypes: true })) {
      const abs = join(d, name.name)
      if (name.isDirectory()) walk(abs)
      else out[resolve(abs).slice(resolve(dir).length + 1).replace(/\\/g, '/')] = readFileSync(abs, 'utf8')
    }
  }
  walk(dir)
  return out
}

/** Drive the build-time hooks (configResolved → writeBundle) and return what landed on disk. */
function runBuild(
  p: { configResolved?: unknown; writeBundle?: unknown },
  outDir: string,
  { copyPublicDir, writeDir }: { copyPublicDir?: boolean; writeDir?: string } = {},
): Record<string, string> {
  const cfg: ResolvedishConfig = { root: '/', build: { outDir, copyPublicDir } }
  ;(p.configResolved as (c: ResolvedishConfig) => void)(cfg)
  ;(p.writeBundle as (this: unknown, o: { dir?: string }) => void).call({}, { dir: writeDir ?? outDir })
  return snapshot(outDir)
}

describe('publicLayersPlugin', () => {
  const high = fixture('public/high/public')
  const low = fixture('public/low/public')
  let outDir: string

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), 'vite-layers-public-'))
  })
  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true })
  })

  it('disables Vite publicDir when layers have public/, otherwise no-op', () => {
    expect(callConfig(publicLayersPlugin([high, low]))).toEqual({ publicDir: false })
    expect(callConfig(publicLayersPlugin([fixture('public/none/public')]))).toBeUndefined()
  })

  it('copies assets first-match-wins (higher overrides, lower fills gaps, nested ok)', () => {
    const written = runBuild(publicLayersPlugin([high, low]), outDir)
    expect(written['logo.svg']).toBe('HIGH_LOGO') // overridden by the higher layer
    expect(written['shared.txt']).toBe('LOW_SHARED') // inherited from the lower layer
    expect(written['img/icon.svg']).toBe('LOW_ICON') // nested, from the lower layer
  })

  it('skips the copy when Vite opts out (copyPublicDir: false)', () => {
    const written = runBuild(publicLayersPlugin([high, low]), outDir, { copyPublicDir: false })
    expect(written).toEqual({})
  })

  it('only copies for the output targeting the main outDir', () => {
    const written = runBuild(publicLayersPlugin([high, low]), outDir, { writeDir: join(outDir, 'server') })
    expect(written).toEqual({})
  })
})
