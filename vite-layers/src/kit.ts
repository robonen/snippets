import { basename, resolve } from 'node:path'
import { defineConfig, mergeConfig, type PluginOption, type UserConfig } from 'vite'
import { resolveLayerStack } from './config'
import { configWatchPlugin, featuresRuntimePlugin } from './dev'
import { createLayerHooks, registerLayerHooks, type LayerHooksConfig } from './hooks'
import { publicLayersPlugin } from './public'
import { layersResolver } from './resolve'
import { tsconfigPlugin, type GenerateTsConfigOptions } from './tsconfig'

export interface BuildViteConfigOptions {
  /** Extra Vite config merged at the very end (highest priority). */
  vite?: UserConfig
  /** Output directory. Default: `dist/<basename(appDir)>`. */
  outDir?: string
  /**
   * Auto-generate `.vite-layers/tsconfig.json` on config resolution (dev + build).
   * Pass options to customize, or `false` to disable. Default: enabled.
   */
  tsconfig?: GenerateTsConfigOptions | false
  /** Override the layered resolver's import prefixes / probed extensions. */
  resolver?: { prefixes?: string[]; extensions?: string[] }
  /** Programmatic lifecycle hooks, registered after (so running after) all layer hooks. */
  hooks?: LayerHooksConfig
}

/**
 * `mergeConfig` concatenates arrays — including `plugins` — so a plugin added by several
 * layers (e.g. a framework plugin in the base and re-declared in a brand) ends up duplicated.
 * Dedupe by `plugin.name`, keeping the highest-priority (last-merged) instance in original order.
 */
function dedupePlugins(config: UserConfig): UserConfig {
  if (!Array.isArray(config.plugins)) return config
  const flat = (config.plugins as PluginOption[]).flat(Infinity as 1)
  const indexByName = new Map<string, number>()
  const out: PluginOption[] = []
  for (const p of flat) {
    const name = p && typeof p === 'object' && 'name' in p ? (p as { name?: unknown }).name : undefined
    if (typeof name === 'string' && indexByName.has(name)) {
      out[indexByName.get(name)!] = p // keep position, take later (higher-priority) instance
      continue
    }
    if (typeof name === 'string') indexByName.set(name, out.length)
    out.push(p)
  }
  return { ...config, plugins: out }
}

/** A member-expression define key segment must be a plain JS identifier. */
const IDENTIFIER_RE = /^[A-Za-z_$][\w$]*$/

/**
 * Build the `define` map for feature flags. Emits the whole `__FEATURES__` object (for runtime
 * reads) plus a dotted entry for **every nested path** whose segments are valid identifiers
 * (`__FEATURES__.billing`, `__FEATURES__.nested.enabled`, …).
 *
 * The dotted entries are what make dead-code elimination work: esbuild folds a replaced literal
 * (`false ? import('…') : []` → `[]`) and drops the dynamic import *before* Rollup builds the
 * module graph, so the page's chunk is never emitted. A member access on an object literal
 * (`{"enabled":false}.enabled`) is NOT folded, so the object form alone does not DCE — which is why
 * we walk recursively and emit a literal at every depth.
 *
 * Keys that are not valid identifiers (e.g. `'kebab-flag'`) are skipped rather than emitted: a
 * dotted define with such a segment is an `INVALID_DEFINE_CONFIG` build error, and you cannot fold
 * a bracket access anyway. The key still lives inside the whole-object `__FEATURES__` for runtime.
 */
function featureDefines(features: Record<string, unknown> = {}): Record<string, string> {
  const define: Record<string, string> = { __FEATURES__: JSON.stringify(features) }
  const walk = (obj: Record<string, unknown>, prefix: string) => {
    for (const [key, value] of Object.entries(obj)) {
      if (!IDENTIFIER_RE.test(key)) continue
      const path = `${prefix}.${key}`
      define[path] = JSON.stringify(value)
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        walk(value as Record<string, unknown>, path)
      }
    }
  }
  walk(features, '__FEATURES__')
  return define
}

/**
 * Build a Vite config from an app's layer stack. Drop-in for `vite.config.ts`:
 *
 * ```ts
 * export default buildViteConfig(import.meta.dirname)
 * ```
 *
 * - Layer `vite` fragments are merged low→high (high overrides), mirroring Nuxt's `.reverse()`.
 * - Aliases: `~~`/`@@` → project rootDir; `#layers/<name>` → each layer's rootDir (first-wins).
 *   `@/`/`~/` are handled by {@link layersResolver}, not as plain aliases.
 * - `__FEATURES__` is defined from the merged `features` for build-time dead-code elimination.
 */
export function buildViteConfig(appDir: string, options: BuildViteConfigOptions = {}) {
  return defineConfig(async (env) => {
    const stack = await resolveLayerStack(appDir, { mode: env.mode })

    // Hooks: register each layer's `hooks` (base-first) + programmatic, then let `layers:resolved`
    // mutate the stack (merged config / features / layers) before anything reads it.
    const hooks = createLayerHooks()
    registerLayerHooks(hooks, stack.layers, options.hooks)
    await hooks.callHook('layers:resolved', stack)

    const { merged, layers } = stack
    const roots = layers.map(l => l.srcDir)

    const project = layers[0]! // resolveLayerStack always returns at least the project layer
    const alias: Record<string, string> = {
      '~~': project.rootDir,
      '@@': project.rootDir,
    }
    // `#layers/<name>` → layer rootDir. Iterate low→high so the highest-priority layer wins (first-wins).
    for (const l of [...layers].reverse()) alias[`#layers/${l.name}`] = l.rootDir

    let vite: UserConfig = {
      resolve: { alias },
      build: { outDir: options.outDir ?? `dist/${basename(appDir)}` },
    }

    // Layer fragments: low → high so higher-priority layers override.
    for (const l of [...layers].reverse()) {
      const frag = typeof l.config.vite === 'function' ? l.config.vite(env) : l.config.vite
      if (frag) vite = mergeConfig(vite, frag)
    }
    vite = dedupePlugins(vite)

    const plugins: PluginOption[] = [
      layersResolver({ roots, ...options.resolver }),
      publicLayersPlugin(layers.map(l => resolve(l.rootDir, 'public'))), // layered public/ assets
      configWatchPlugin(layers.map(l => l.rootDir)), // dev: restart on app.config change
      featuresRuntimePlugin(merged.features), // dev: supply __FEATURES__ at runtime (define is build-only here)
    ]
    if (options.tsconfig !== false) {
      // Reuse the already-resolved stack + shared hooks (so the tsconfig plugin doesn't re-resolve
      // and `tsconfig:generate` sees the same handlers).
      plugins.push(tsconfigPlugin(appDir, { ...options.tsconfig, stack, hooks }))
    }

    vite = mergeConfig(vite, {
      plugins,
      define: featureDefines(merged.features),
    })

    if (options.vite) vite = mergeConfig(vite, options.vite)

    // Final escape hatch: let hooks mutate (or replace) the assembled Vite config.
    const ctx = { config: vite, env, stack }
    await hooks.callHook('vite:config', ctx)
    return ctx.config
  })
}

export { dedupePlugins }
