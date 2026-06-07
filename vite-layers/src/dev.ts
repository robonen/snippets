import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import MagicString from 'magic-string'
import type { Plugin } from 'vite'

const CONFIG_EXTENSIONS = ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs']
const toPosix = (p: string) => p.replace(/\\/g, '/')

const existingConfigFiles = (rootDirs: string[]): Set<string> => {
  const files = new Set<string>()
  for (const dir of rootDirs) {
    for (const ext of CONFIG_EXTENSIONS) {
      const file = resolve(dir, `app.config${ext}`)
      try {
        if (statSync(file).isFile()) files.add(toPosix(file))
      } catch {
        // not present in this layer
      }
    }
  }
  return files
}

/**
 * Dev-only plugin: restart the Vite server when any layer's `app.config.*` changes.
 *
 * `app.config.ts` is loaded out-of-band by c12 (not part of Vite's module graph or config-file
 * dependencies), so Vite never restarts on its own when you edit feature flags / layer config — the
 * baked `__FEATURES__` `define` and aliases go stale. We watch each resolved layer's config file
 * (including layers outside the project root via `watcher.add`) and call `server.restart()`, which
 * re-runs `buildViteConfig` → `resolveLayerStack` (c12 reads fresh) → new `define`.
 */
export function configWatchPlugin(rootDirs: string[]): Plugin {
  return {
    name: 'vite-layers:config-watch',
    apply: 'serve',
    configureServer(server) {
      const files = existingConfigFiles(rootDirs)
      if (files.size === 0) return
      server.watcher.add([...files]) // ensure extended layers outside the root are watched too

      const onChange = (file: string) => {
        if (!files.has(toPosix(file))) return
        server.config.logger.info('[vite-layers] app config changed — restarting…', { timestamp: true })
        void server.restart()
      }
      server.watcher.on('change', onChange)
    },
  }
}

/** Matches a standalone `__FEATURES__` reference (not a `.__FEATURES__` property access). */
const STANDALONE_FEATURES_RE = /(?<![.\w$])__FEATURES__\b/

/**
 * Dev-only plugin: make `__FEATURES__` resolve at runtime in the dev server.
 *
 * Vite 8 / rolldown-vite does **not** inline user `define` into dev-served source modules (only
 * `import.meta.env` is special-cased), so `__FEATURES__` would be an undefined global in dev. For
 * production, `define` (with DCE) still does the job; here we prepend a module-local
 * `const __FEATURES__ = {…}` to each served module that references the global, so feature flags have
 * correct values in dev — and pick up edits after a config-change restart (see {@link configWatchPlugin}).
 *
 * Only standalone references are handled (not `_ctx.__FEATURES__` from Vue templates — same as
 * `define`); gate features in `<script>`, not in template expressions.
 */
export function featuresRuntimePlugin(features: Record<string, unknown> = {}): Plugin {
  const json = JSON.stringify(features)
  return {
    name: 'vite-layers:features-runtime',
    apply: 'serve',
    transform(code, id) {
      if (id.includes('/node_modules/') || !STANDALONE_FEATURES_RE.test(code)) return null
      // NOTE: rolldown's *native* magic-string (the transform `meta.magicString` in the rolldown
      // docs) is NOT surfaced by Vite plugins — `meta` is `{ inMap, moduleType, ssr }` with no
      // `magicString` in dev or build. So we use the npm `magic-string` fallback the rolldown docs
      // recommend for non-native hosts; it also produces clean cross-platform sourcemaps.
      // Prepend on line 1 (keeps line numbers); module-local const shadows the missing global.
      const s = new MagicString(code)
      s.prepend(`const __FEATURES__=${json};`)
      return { code: s.toString(), map: s.generateMap({ source: id, hires: true }) }
    },
  }
}
