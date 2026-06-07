import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import sirv from 'sirv'
import type { Plugin } from 'vite'

const toPosix = (p: string) => p.replace(/\\/g, '/')

/** Recursively list files under a directory (absolute paths). */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) walk(abs, out)
    else out.push(abs)
  }
  return out
}

/**
 * Layered static assets: each layer may have a `public/` directory, resolved **first-match across
 * layers** (higher-priority layer wins) — e.g. `brand/public/logo.svg` shadows `main/public/logo.svg`.
 *
 * Vite's `publicDir` is a single directory, so this plugin takes over: it disables the built-in
 * `publicDir`, serves all layers' `public/` in priority order in dev (sirv chain — first hit wins),
 * and emits the merged set into the build output (higher layers overwrite lower ones).
 *
 * @param publicDirs candidate `<rootDir>/public` directories ordered high→low priority.
 */
export function publicLayersPlugin(publicDirs: string[]): Plugin {
  const dirs = publicDirs.filter(existsSync) // high → low

  return {
    name: 'vite-layers:public',
    config() {
      // We serve/emit public ourselves, so turn off Vite's single-dir handling.
      if (dirs.length > 0) return { publicDir: false }
    },
    configureServer(server) {
      // Dev: probe each layer's public/ in priority order; sirv calls next() on miss.
      for (const dir of dirs) {
        server.middlewares.use(sirv(dir, { dev: true, etag: true }))
      }
    },
    generateBundle() {
      // Build: merge low→high so higher layers overwrite — i.e. first-match-wins by priority.
      const assets = new Map<string, string>()
      for (const dir of [...dirs].reverse()) {
        for (const abs of walk(dir)) assets.set(toPosix(relative(dir, abs)), abs)
      }
      for (const [fileName, abs] of assets) {
        this.emitFile({ type: 'asset', fileName, source: readFileSync(abs) })
      }
    },
  }
}
