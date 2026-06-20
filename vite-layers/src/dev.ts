import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import { toPosix } from './util'

const CONFIG_EXTENSIONS = ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs']

/**
 * Dev-only plugin: restart the Vite server when any layer's `app.config.*` changes.
 *
 * `app.config.ts` is loaded out-of-band by c12 (not part of Vite's module graph or config-file
 * dependencies), so Vite never restarts on its own when you edit feature flags / layer config — the
 * `feature()` values baked into transformed modules and the resolved aliases go stale. We watch each
 * resolved layer's config file (including layers outside the project root via `watcher.add`) and call
 * `server.restart()`, which re-runs `buildViteConfig` → `resolveLayerStack` (c12 reads fresh) → a new
 * `featurePlugin` with the updated flag values.
 */
export function configWatchPlugin(rootDirs: string[]): Plugin {
  return {
    name: 'vite-layers:config-watch',
    apply: 'serve',
    configureServer(server) {
      // Every POSSIBLE `app.config.*` path (existing or not), so creating a config in a layer that
      // had none — or deleting one — also restarts, not just edits to configs present at startup.
      const candidates = new Set<string>()
      for (const dir of rootDirs) {
        for (const ext of CONFIG_EXTENSIONS) candidates.add(toPosix(resolve(dir, `app.config${ext}`)))
      }
      if (candidates.size === 0) return
      // chokidar watches an absent path for creation too, so `add`/`unlink` fire for a config that
      // appears/disappears later (incl. layers outside the project root).
      server.watcher.add([...candidates])

      const onEvent = (file: string) => {
        if (!candidates.has(toPosix(file))) return
        server.config.logger.info('[vite-layers] app config changed — restarting…', { timestamp: true })
        void server.restart()
      }
      for (const event of ['add', 'change', 'unlink'] as const) server.watcher.on(event, onEvent)
    },
  }
}
