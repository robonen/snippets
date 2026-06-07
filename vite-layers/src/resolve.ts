import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

/** Default resolvable extensions — mirrors Nuxt's `nuxt.options.extensions`. */
export const DEFAULT_EXTENSIONS = ['.js', '.jsx', '.mjs', '.ts', '.tsx', '.vue']

export interface LayersResolverOptions {
  /** Source roots ordered high→low priority (typically `layers.map(l => l.srcDir)`). */
  roots: string[]
  /** Import prefixes treated as layered. Default: `@/`, `~/`. */
  prefixes?: string[]
  /** Extensions probed when the id has no explicit, existing file. */
  extensions?: string[]
}

const toPosix = (p: string) => p.replace(/\\/g, '/')

const isFile = (p: string): boolean => {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

/**
 * Framework-agnostic, layered file resolver — the plain-Vite replacement for Nuxt's
 * Vue-specific component/page/composable scanners. For an id like `@/components/Foo.vue`,
 * it probes each source root in priority order and returns the first match.
 *
 * Probing mirrors Nuxt's `_resolvePathGranularly`: the path as-is, then `<path><ext>`,
 * then `<path>/index<ext>`.
 *
 * Improvement over Nuxt: **self-skip** gives `super()` semantics. If the first match is the
 * importing file itself, resolution continues to the next (lower-priority) layer — so an
 * override at `@/components/Foo.vue` can import `@/components/Foo.vue` to reach the base file.
 */
export function layersResolver(options: LayersResolverOptions): Plugin {
  const { roots, prefixes = ['@/', '~/'], extensions = DEFAULT_EXTENSIONS } = options

  const probe = (root: string, sub: string): string | null => {
    const direct = resolve(root, sub)
    if (isFile(direct)) return direct
    for (const ext of extensions) {
      const p = direct + ext
      if (isFile(p)) return p
    }
    for (const ext of extensions) {
      const p = resolve(direct, `index${ext}`)
      if (isFile(p)) return p
    }
    return null
  }

  // Cache: `sub` (prefix- and query-stripped) → ordered list of matching files across roots
  // (high→low priority). Saves the per-import `statSync` storm; self-skip stays correct because the
  // candidate list is importer-independent (we pick the first candidate that isn't the importer).
  const cache = new Map<string, string[]>()
  const candidates = (sub: string): string[] => {
    const cached = cache.get(sub)
    if (cached) return cached
    const list: string[] = []
    for (const root of roots) {
      const file = probe(root, sub)
      if (file) list.push(toPosix(file))
    }
    cache.set(sub, list)
    return list
  }

  return {
    name: 'vite-layers:resolve',
    enforce: 'pre', // before Vite core resolve; `@/`/`~/` are intentionally NOT registered as aliases
    configureServer(server) {
      // A new/removed file can change which layer wins → drop the cache in dev.
      const clear = () => cache.clear()
      server.watcher.on('add', clear)
      server.watcher.on('unlink', clear)
      server.watcher.on('unlinkDir', clear)
    },
    resolveId(id, importer) {
      const prefix = prefixes.find(p => id.startsWith(p))
      if (!prefix) return null

      const q = id.indexOf('?')
      const query = q < 0 ? '' : id.slice(q) // preserve `?inline`/`?raw`/`?url`/… suffixes
      const sub = (q < 0 ? id : id.slice(0, q)).slice(prefix.length)
      const self = importer ? toPosix(importer.split('?')[0]!) : undefined

      for (const file of candidates(sub)) {
        if (file === self) continue // self-skip → fall through to the base layer (super())
        return file + query
      }
      return null
    },
  }
}
