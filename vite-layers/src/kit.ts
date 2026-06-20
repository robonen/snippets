import { existsSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { defineConfig, mergeConfig, type PluginOption, type UserConfig } from 'vite'
import { resolveLayerStack } from './config'
import { configWatchPlugin } from './dev'
import { layersDevtoolsPlugin } from './devtools'
import { FEATURE_MODULE, featurePlugin } from './features'
import { createLayerHooks, registerLayerHooks, type LayerHooksConfig } from './hooks'
import { publicLayersPlugin } from './public'
import { createLayeredResolution, layersResolver } from './resolve'
import { tsconfigPlugin, type GenerateTsConfigOptions } from './tsconfig'
import { toPosix } from './util'

/**
 * Absolute path to the `feature` macro entry, aliased as `#feature` (see {@link featurePlugin}).
 * Resolved next to this module — `feature.ts` when running from source (dev/tests), `feature.js`
 * after a `tsdown` build — so the alias always points at a real file in either layout.
 */
const FEATURE_ENTRY = resolve(import.meta.dirname, 'feature')
const FEATURE_FILE = toPosix(existsSync(`${FEATURE_ENTRY}.ts`) ? `${FEATURE_ENTRY}.ts` : `${FEATURE_ENTRY}.js`)

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
  /**
   * Mount the vite-layers panels (stack / features / resolver / public+ts) in Vite DevTools.
   * Requires the `@vitejs/devtools` hub in the plugin list; the integration is inert without it.
   * Enabled by default — pass `false` to skip it (and the resolver's resolution-log recording).
   */
  devtools?: boolean
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

/**
 * Build a Vite config from an app's layer stack. Drop-in for `vite.config.ts`:
 *
 * ```ts
 * export default buildViteConfig(import.meta.dirname)
 * ```
 *
 * - Layer `vite` fragments are merged low→high (high overrides), mirroring Nuxt's `.reverse()`.
 * - Aliases: `~~`/`@@` → project rootDir; `#layers/<name>` → each layer's rootDir (first-wins);
 *   `#feature` → the {@link featurePlugin} macro entry. `@/`/`~/` are handled by
 *   {@link layersResolver}, not as plain aliases.
 * - Build-time feature flags are compiled by {@link featurePlugin} (the `feature('key')` macro),
 *   one mechanism for dev and build.
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
    const devtoolsEnabled = options.devtools !== false

    // One shared resolution drives both the resolver plugin and the devtools resolver panel, so the
    // panel introspects the exact same candidate cache and resolution log. The log is only recorded
    // when devtools is enabled AND in dev (`serve`) — the panel can't mount during a build, so a
    // production build does zero per-import recording work.
    const recordLog = devtoolsEnabled && env.command === 'serve'
    const resolution = createLayeredResolution({ roots, ...options.resolver, record: recordLog ? 200 : 0 })

    const project = layers[0]! // resolveLayerStack always returns at least the project layer
    const alias: Record<string, string> = {
      '~~': project.rootDir,
      '@@': project.rootDir,
      [FEATURE_MODULE]: FEATURE_FILE, // `#feature` → the macro entry (compiled away by featurePlugin)
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
      layersResolver(resolution),
      publicLayersPlugin(layers.map(l => resolve(l.rootDir, 'public'))), // layered public/ assets
      configWatchPlugin(layers.map(l => l.rootDir)), // dev: restart on app.config change
      featurePlugin(merged.features), // compile `feature('key')` → literal (dev + build, one mechanism)
    ]
    if (options.tsconfig !== false) {
      // Reuse the already-resolved stack + shared hooks (so the tsconfig plugin doesn't re-resolve
      // and `tsconfig:generate` sees the same handlers).
      plugins.push(tsconfigPlugin(appDir, { ...options.tsconfig, stack, hooks }))
    }
    if (devtoolsEnabled) {
      // Inert unless the `@vitejs/devtools` hub mounts it (uses only *type* imports from the kit).
      plugins.push(
        layersDevtoolsPlugin({
          appDir,
          env,
          stack,
          resolution,
          tsconfig: options.tsconfig === false ? false : (options.tsconfig ?? {}),
        }),
      )
    }

    vite = mergeConfig(vite, { plugins })

    if (options.vite) vite = mergeConfig(vite, options.vite)

    // Final escape hatch: let hooks mutate (or replace) the assembled Vite config.
    const ctx = { config: vite, env, stack }
    await hooks.callHook('vite:config', ctx)
    return ctx.config
  })
}

export { dedupePlugins }
