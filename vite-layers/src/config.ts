import { basename, relative, resolve } from 'node:path'
import { loadConfig, type ConfigLayer } from 'c12'
import { createDefu } from 'defu'
import { glob } from 'tinyglobby'
import { withoutTrailingSlash, withTrailingSlash } from 'ufo'
import type { Layer, LayerConfig, LayerStack } from './types'

/** Identity helper for typed `app.config.ts` files. */
export const defineLayerConfig = (config: LayerConfig): LayerConfig => config

/**
 * Normalize to forward slashes. c12 returns `cwd` posix-style while node `resolve()` is
 * OS-native (backslashes on Windows); paths must be canonicalized before they are compared
 * for dedup or emitted into a Vite config (where posix is conventional).
 */
const toPosix = (p: string) => p.replace(/\\/g, '/')

/**
 * Port of Nuxt's layer merger: arrays are concatenated rather than replaced.
 * (See `@nuxt/kit` `loadNuxtConfig`.)
 */
const merger = createDefu((obj, key, value) => {
  const target = obj as Record<PropertyKey, unknown>
  if (Array.isArray(target[key]) && Array.isArray(value)) {
    target[key] = (target[key] as unknown[]).concat(value)
    return true
  }
  return false
})

/**
 * Resolve the full layer stack for an app directory, faithfully porting Nuxt's
 * `loadNuxtConfig` behavior on top of c12:
 *
 *  1. Auto-scan `layers/*` and prepend them (descending sort → "Z>A" / higher numeric prefix wins).
 *  2. Load + merge the `extends` graph via c12 (`defu`, arrays concatenated, project wins).
 *  3. Normalize: dedup layers by resolved `rootDir` (first-wins), resolve `srcDir` and layer name.
 *
 * Improvement over Nuxt/c12: a cycle-guard in c12's `resolve` hook. Raw c12 neither dedups nor
 * detects cycles and will stack-overflow on a back-edge (`A→B→A`); Nuxt's own dedup runs only
 * *after* c12's recursive walk, so it does not prevent the overflow. Returning a terminal empty
 * layer the second time a source is seen cuts the recursion (returning null/undefined would fall
 * back to c12's default resolution and still recurse).
 *
 * Pass `mode` (typically Vite's `env.mode`) to enable per-layer environment overrides — c12 applies
 * a layer's `$development`/`$production`/`$env[mode]` block when `mode` matches (Nuxt parity).
 *
 * @returns layers ordered high→low priority; `layers[0]` is the project itself.
 */
export async function resolveLayerStack(
  cwd: string,
  opts: { mode?: string } = {},
): Promise<LayerStack> {
  // 1) Auto-scan `layers/*` — descending sort so "Z"/higher numeric prefix wins, like Nuxt.
  const localLayers = (await glob('layers/*', { onlyDirectories: true, cwd }))
    .map(d => withTrailingSlash(resolve(cwd, d)))
    .sort((a, b) => b.localeCompare(a))

  // 2) Cycle-guard [improvement]: terminate the recursion on a repeated source.
  const seen = new Set<string>()

  const { config, layers = [] } = await loadConfig<LayerConfig>({
    cwd,
    configFile: 'app.config',
    extend: { extendKey: ['_extends', 'extends'] },
    overrides: { _extends: localLayers } as LayerConfig,
    // Per-layer env overrides ($production/$development/$env). Undefined → c12 uses NODE_ENV.
    // Do NOT set `omit$Keys` — it would strip `$meta`, which we read for layer names below.
    envName: opts.mode,
    rcFile: false,
    packageJson: false,
    globalRc: false,
    merger: merger as (...sources: Array<LayerConfig | null | undefined>) => LayerConfig,
    resolve(id, opts) {
      const abs = resolve(opts?.cwd ?? cwd, id)
      if (seen.has(abs)) return { config: {}, cwd: abs }
      seen.add(abs)
      return undefined
    },
  })

  // 3) Normalization — dedup by resolved rootDir (first-wins), resolve srcDir + name.
  const all: ConfigLayer<LayerConfig>[] = layers.length ? layers : [{ config, cwd }]
  const stack: Layer[] = []
  const processed = new Set<string>()
  const localRel = new Set(localLayers.map(l => relative(cwd, withoutTrailingSlash(l))))

  for (const layer of all) {
    const rawRoot = layer.config?.rootDir ?? layer.cwd
    if (!rawRoot) continue
    const rootDir = toPosix(rawRoot)
    if (processed.has(rootDir)) continue
    processed.add(rootDir)

    const srcDir = toPosix(resolve(rootDir, layer.config?.srcDir ?? 'src'))
    let name = layer.config?.$meta?.name ?? layer.config?.name
    if (!name && layer.cwd && localRel.has(relative(cwd, layer.cwd))) {
      name = basename(layer.cwd)
    }

    stack.push({ rootDir, srcDir, name: name ?? basename(rootDir), config: layer.config ?? {} })
  }

  return { merged: config, layers: stack }
}
