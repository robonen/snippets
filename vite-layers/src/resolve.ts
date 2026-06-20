import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import { toPosix } from './util'

/** Default resolvable extensions — mirrors Nuxt's `nuxt.options.extensions`. */
export const DEFAULT_EXTENSIONS = ['.js', '.jsx', '.mjs', '.ts', '.tsx', '.vue']

export interface LayersResolverOptions {
  /** Source roots ordered high→low priority (typically `layers.map(l => l.srcDir)`). */
  roots: string[]
  /** Import prefixes treated as layered. Default: `@/`, `~/`. */
  prefixes?: string[]
  /** Extensions probed when the id has no explicit, existing file. */
  extensions?: string[]
  /**
   * Keep a bounded, de-duplicated log of the last N resolutions for introspection (the devtools
   * resolver panel reads it). `0`/omitted disables recording — zero overhead on the hot path.
   */
  record?: number
}

/** A single recorded resolution — what the resolver saw for one `@/`/`~/` import. */
export interface ResolveRecord {
  /** The original import id (prefix + sub-path + query). */
  id: string
  /** The importer module (query-stripped), if any. */
  importer?: string
  /** The file the id resolved to (with query), or `null` if nothing matched. */
  resolved: string | null
  /** All candidate files across layers, high→low priority (importer-independent). */
  candidates: string[]
  /** Index of the importer within `candidates` (`-1` when it isn't a self-import). */
  selfIndex: number
}

/** A parsed layered id: its matched prefix, the prefix-stripped sub-path, and any query suffix. */
export interface ParsedLayeredId {
  prefix: string
  sub: string
  query: string
}

/**
 * The reusable core of the layered resolver — the pure resolution logic, decoupled from the Vite
 * plugin shell so it can be shared. {@link layersResolver} wraps one of these in a plugin; the
 * devtools integration reuses the *same instance* (via {@link createLayeredResolution} in
 * `buildViteConfig`) to introspect candidates and the live resolution log without re-implementing
 * the probing, the cache, or the `super()` semantics.
 */
export interface LayeredResolution {
  readonly roots: string[]
  readonly prefixes: string[]
  readonly extensions: string[]
  /** Split a layered id into prefix/sub/query, or `null` if no prefix matches. */
  parse: (id: string) => ParsedLayeredId | null
  /** Ordered candidate files for a prefix-stripped sub-path, high→low priority. Cached. */
  candidates: (sub: string) => string[]
  /** Resolve a layered id (super()/self-skip + query preservation). `null` if not layered / no match. */
  resolveId: (id: string, importer?: string) => string | null
  /** Drop the candidate cache (call when files are added/removed — which layer wins can change). */
  clear: () => void
  /** Recorded resolutions, newest first (empty unless `record` was enabled). */
  records: () => ResolveRecord[]
  /** Clear the resolution log (the candidate cache is untouched). */
  clearRecords: () => void
}

/** RegExp metacharacters — escaped when building a RegExp from a literal string (e.g. layer prefixes). */
const REGEXP_META_RE = /[.*+?^${}()|[\]\\]/g
const escapeRegExp = (s: string) => s.replace(REGEXP_META_RE, '\\$&')

const isFile = (p: string): boolean => {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

/**
 * Build the shared resolution core (probing + cache + `super()` + optional recording). Stateless
 * across importers: the candidate list for a sub-path is importer-independent, so `super()` works by
 * locating the importer's position in the list and taking the next entry down.
 */
export function createLayeredResolution(options: LayersResolverOptions): LayeredResolution {
  const { roots, prefixes = ['@/', '~/'], extensions = DEFAULT_EXTENSIONS, record = 0 } = options

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
  // (high→low priority). Saves the per-import `statSync` storm; the list is importer-independent, so
  // super() stays correct — we locate the importer's position in it and take the next entry down.
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

  const parse = (id: string): ParsedLayeredId | null => {
    const prefix = prefixes.find(p => id.startsWith(p))
    if (!prefix) return null
    const q = id.indexOf('?')
    const query = q < 0 ? '' : id.slice(q) // preserve `?inline`/`?raw`/`?url`/… suffixes
    const sub = (q < 0 ? id : id.slice(0, q)).slice(prefix.length)
    return { prefix, sub, query }
  }

  // Bounded, de-duplicated resolution log (devtools). Keyed by a JSON-encoded `[id, importer]` pair
  // (collision-proof, unlike a delimiter string) so repeated resolves of the same import (HMR re-runs)
  // update one entry instead of flooding the log; a Map preserves insertion order, and re-inserting
  // moves the entry to the end (most-recent-last).
  const log = new Map<string, ResolveRecord>()
  const remember = (rec: ResolveRecord) => {
    const key = JSON.stringify([rec.id, rec.importer ?? null]) // collision-proof composite key
    if (log.has(key)) log.delete(key)
    log.set(key, rec)
    while (log.size > record) log.delete(log.keys().next().value!)
  }

  return {
    roots,
    prefixes,
    extensions,
    parse,
    candidates,
    resolveId(id, importer) {
      const parsed = parse(id)
      if (!parsed) return null

      const self = importer ? toPosix(importer.split('?')[0]!) : undefined

      // super(): if the importer is one of the candidates (an override importing its own layered
      // path), resolve to the NEXT-LOWER layer; a normal importer isn't in the list, so it resolves to
      // the highest-priority match (index 0). Note: "first candidate that isn't me" would be wrong —
      // for a shadowed middle layer it jumps UP to a higher override, and a top↔mid self-import chain
      // would cycle. Position-aware skip makes super() correct through a deep extends chain.
      const list = candidates(parsed.sub)
      const selfIndex = self ? list.indexOf(self) : -1
      const next = list[selfIndex + 1]
      const resolved = next ? next + parsed.query : null

      if (record > 0) remember({ id, importer: self, resolved, candidates: list, selfIndex })
      return resolved
    },
    clear() {
      cache.clear()
    },
    records() {
      return [...log.values()].reverse()
    },
    clearRecords() {
      log.clear()
    },
  }
}

/** True if the argument is an already-built {@link LayeredResolution} rather than raw options. */
const isResolution = (v: LayersResolverOptions | LayeredResolution): v is LayeredResolution =>
  typeof (v as LayeredResolution).resolveId === 'function'

/**
 * Framework-agnostic, layered file resolver — the plain-Vite replacement for Nuxt's
 * Vue-specific component/page/composable scanners. For an id like `@/components/Foo.vue`,
 * it probes each source root in priority order and returns the first match.
 *
 * Probing mirrors Nuxt's `_resolvePathGranularly`: the path as-is, then `<path><ext>`,
 * then `<path>/index<ext>`.
 *
 * Improvement over Nuxt: **self-skip** gives `super()` semantics at any depth. When the importer is
 * itself one of the matches (an override importing its own layered path), resolution continues to the
 * **next-lower** layer — so an override at `@/components/Foo.vue` can import `@/components/Foo.vue` to
 * reach the layer beneath it. This composes through a deep `extends` chain: top→mid→base each resolve
 * one step down, so multi-level overrides can each call `super()`.
 *
 * Accepts either {@link LayersResolverOptions} (builds its own {@link LayeredResolution}) or a
 * pre-built resolution — `buildViteConfig` passes a shared instance so the devtools panel introspects
 * the exact same cache and resolution log this plugin produces.
 */
export function layersResolver(source: LayersResolverOptions | LayeredResolution): Plugin {
  const resolution = isResolution(source) ? source : createLayeredResolution(source)
  // Hook filter (rolldown): a RegExp matching the layered prefixes, so the bundler only invokes
  // resolveId for `@/`/`~/` ids — every other specifier skips the JS round-trip. (resolveId filters
  // accept only RegExp ids, not string globs.) https://rolldown.rs/in-depth/why-plugin-hook-filter
  const idFilter = new RegExp(`^(?:${resolution.prefixes.map(escapeRegExp).join('|')})`)

  return {
    name: 'vite-layers:resolve',
    enforce: 'pre', // before Vite core resolve; `@/`/`~/` are intentionally NOT registered as aliases
    configureServer(server) {
      // A new/removed file can change which layer wins → drop the cache in dev.
      const clear = () => resolution.clear()
      server.watcher.on('add', clear)
      server.watcher.on('unlink', clear)
      server.watcher.on('unlinkDir', clear)
    },
    resolveId: {
      filter: { id: idFilter },
      handler(id, importer) {
        return resolution.resolveId(id, importer)
      },
    },
  }
}
