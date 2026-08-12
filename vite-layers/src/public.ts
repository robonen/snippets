import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import sirv from 'sirv'
import type { Plugin } from 'vite'
import { toPosix, walkFiles } from './util'

/**
 * Merged `relativePath → sourceAbs` map across all layers. Walked low→high so the higher-priority
 * layer wins each key — i.e. first-match-wins by priority (`brand/public/logo.svg` shadows `main`'s).
 */
function mergePublic(dirs: string[]): Map<string, string> {
  const assets = new Map<string, string>()
  for (const dir of [...dirs].reverse()) {
    for (const abs of walkFiles(dir)) assets.set(toPosix(relative(dir, abs)), abs)
  }
  return assets
}

/**
 * Layered static assets: each layer may have a `public/` directory, resolved **first-match across
 * layers** (higher-priority layer wins) — e.g. `brand/public/logo.svg` shadows `main/public/logo.svg`.
 *
 * Vite's `publicDir` is a single directory, so this plugin takes over: it disables the built-in
 * `publicDir`, serves all layers' `public/` in priority order in dev (sirv chain — first hit wins),
 * and copies the merged set into the build output (higher layers overwrite lower ones).
 *
 * Build-time copy is streamed file-by-file through the OS (`copyFileSync`) rather than buffered via
 * `emitFile`, so peak memory stays flat regardless of total asset size — large fonts/videos on a
 * memory-constrained CI won't OOM, matching Vite's own `publicDir` copy.
 *
 * @param publicDirs candidate `<rootDir>/public` directories ordered high→low priority.
 */
export function publicLayersPlugin(publicDirs: string[]): Plugin {
  const dirs = publicDirs.filter(existsSync) // high → low
  let outDir = ''
  let copyPublic = true

  return {
    name: 'vite-layers:public',
    config() {
      // We serve/emit public ourselves, so turn off Vite's single-dir handling.
      if (dirs.length > 0) return { publicDir: false }
    },
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
      // Respect Vite's own opt-out (e.g. SSR builds set this false to skip public copy).
      copyPublic = config.build.copyPublicDir !== false
    },
    configureServer(server) {
      // Dev: probe each layer's public/ in priority order; sirv calls next() on miss.
      for (const dir of dirs) {
        server.middlewares.use(sirv(dir, { dev: true, etag: true }))
      }
    },
    writeBundle(options) {
      // Build: copy each file straight to disk via the OS instead of holding every asset's bytes in
      // memory at once — peak RSS stays flat no matter how large the public set is.
      if (!copyPublic || dirs.length === 0) return
      // writeBundle fires once per output; only the one targeting the main outDir copies the assets
      // (a secondary/SSR output has a different dir and is skipped).
      if (options.dir && resolve(options.dir) !== outDir) return
      for (const [fileName, abs] of mergePublic(dirs)) {
        const dest = join(outDir, fileName)
        mkdirSync(dirname(dest), { recursive: true })
        copyFileSync(abs, dest)
      }
    },
  }
}
