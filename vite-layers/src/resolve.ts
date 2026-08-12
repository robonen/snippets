import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import { toPosix } from './util'

/** Default resolvable extensions — mirrors Nuxt's `nuxt.options.extensions`. */
export const DEFAULT_EXTENSIONS = ['.js', '.jsx', '.mjs', '.ts', '.tsx', '.vue']

/**
 * The explicit `super()` import specifier: `#super/<path>` resolves `<path>` from the layer
 * **strictly below** the importer's; bare `#super` is sugar for "my own layer-relative path, one
 * layer down". Unlike the implicit self-import form it is greppable, survives copy-paste, and
 * `#super/*` is typed in the generated tsconfig.
 */
export const SUPER_MODULE = '#super'
const SUPER_PREFIX = `${SUPER_MODULE}/`
const SUPER_QUERY = `${SUPER_MODULE}?`

/** Strip a `?query` suffix (allocation-free `split('?')[0]` — resolveId is per-import hot). */
const stripQuery = (s: string): string => {
  const q = s.indexOf('?')
  return q < 0 ? s : s.slice(0, q)
}

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
  /** Split a layered id into prefix/sub/query (`#super/` counts as a prefix), or `null`. */
  parse: (id: string) => ParsedLayeredId | null
  /** Ordered candidate files for a prefix-stripped sub-path, high→low priority. Cached. */
  candidates: (sub: string) => string[]
  /** Resolve a layered id (`#super` + self-skip `super()` + query preservation). `null` if not layered / no match. */
  resolveId: (id: string, importer?: string) => string | null
  /** Drop the whole candidate cache. Prefer the targeted invalidate* methods in dev. */
  clear: () => void
  /** Drop only the cache entries one added/removed file can affect (its sub + ext/index probe subs). */
  invalidateFile: (file: string) => void
  /** Drop the cache entries under (or probing into) a removed directory. */
  invalidateDir: (dir: string) => void
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

  // Layer index of a (posix, query-stripped) file, or -1 if outside every root.
  const posixRoots = roots.map(r => toPosix(r))
  const layerOf = (file: string): number => posixRoots.findIndex(r => file.startsWith(`${r}/`))

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
    // `#super/…` and bare `#super` always parse (bare → prefix `#super`, sub ''), so the devtools
    // playground can list their candidates like any layered id.
    const prefix = id.startsWith(SUPER_PREFIX)
      ? SUPER_PREFIX
      : id === SUPER_MODULE || id.startsWith(SUPER_QUERY)
        ? SUPER_MODULE
        : prefixes.find(p => id.startsWith(p))
    if (!prefix) return null
    const q = id.indexOf('?')
    const query = q < 0 ? '' : id.slice(q) // preserve `?inline`/`?raw`/`?url`/… suffixes
    const sub = (q < 0 ? id : id.slice(0, q)).slice(prefix.length)
    return { prefix, sub, query }
  }

  // Bounded, de-duplicated resolution log (devtools). NUL-joined key: collision-proof (paths can't
  // contain NUL), cheaper than JSON.stringify. Re-inserting moves an entry to the end (most-recent).
  const log = new Map<string, ResolveRecord>()
  const remember = (rec: ResolveRecord) => {
    const key = `${rec.id}\0${rec.importer ?? '\0'}`
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

      const self = importer ? toPosix(stripQuery(importer)) : undefined
      let list: string[]
      let next: string | undefined
      let selfIndex: number

      if (parsed.prefix === SUPER_PREFIX || parsed.prefix === SUPER_MODULE) {
        // #super — explicit super(): first candidate in a layer STRICTLY BELOW the importer's, so it
        // works from any file, not just an override of the same path.
        const myLayer = self ? layerOf(self) : -1
        if (self === undefined || myLayer < 0) return null // importer outside the stack
        // bare `#super` (sub === '') → the importer's own sub-path
        list = candidates(parsed.sub || self.slice(posixRoots[myLayer]!.length + 1))
        next = list.find(f => layerOf(f) > myLayer)
        selfIndex = list.indexOf(self)
      } else {
        // super() via self-skip: if the importer is one of the candidates (an override importing its
        // own layered path), resolve to the NEXT-LOWER layer; a normal importer isn't in the list, so
        // it resolves to the highest-priority match (index 0). Note: "first candidate that isn't me"
        // would be wrong — for a shadowed middle layer it jumps UP to a higher override, and a
        // top↔mid self-import chain would cycle. Position-aware skip stays correct at any depth.
        list = candidates(parsed.sub)
        selfIndex = self ? list.indexOf(self) : -1
        next = list[selfIndex + 1]
      }

      const resolved = next ? next + parsed.query : null
      if (record > 0) remember({ id, importer: self, resolved, candidates: list, selfIndex })
      return resolved
    },
    clear() {
      cache.clear()
    },
    invalidateFile(file) {
      const f = toPosix(file)
      for (const root of posixRoots) {
        // every root, not just the first — with nested roots a file has a different sub per root
        if (!f.startsWith(`${root}/`)) continue
        const sub = f.slice(root.length + 1)
        cache.delete(sub)
        for (const ext of extensions) {
          if (!sub.endsWith(ext)) continue
          const bare = sub.slice(0, -ext.length) // extension probe: `@/foo` ← foo.ts
          cache.delete(bare)
          if (bare.endsWith('/index')) cache.delete(bare.slice(0, -'/index'.length)) // `@/dir` ← dir/index.ts
          break
        }
      }
    },
    invalidateDir(dir) {
      const d = toPosix(dir)
      for (const root of posixRoots) {
        if (!d.startsWith(`${root}/`)) continue
        const sub = d.slice(root.length + 1)
        const prefix = `${sub}/`
        for (const key of cache.keys()) {
          // `key === sub`: `@/dir` may have resolved via dir/index.*
          if (key === sub || key.startsWith(prefix)) cache.delete(key)
        }
      }
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
 * Improvement over Nuxt: `super()` semantics at any depth, in two forms — the explicit
 * `#super`/`#super/<path>` (preferred: greppable and typed, see {@link SUPER_MODULE}) and the
 * implicit self-skip (Nuxt-parity: an override importing its own layered path resolves to the
 * next-lower layer). Both compose through a deep `extends` chain, one step down per layer.
 *
 * Accepts either {@link LayersResolverOptions} (builds its own {@link LayeredResolution}) or a
 * pre-built resolution — `buildViteConfig` passes a shared instance so the devtools panel introspects
 * the exact same cache and resolution log this plugin produces.
 */
export function layersResolver(source: LayersResolverOptions | LayeredResolution): Plugin {
  const resolution = isResolution(source) ? source : createLayeredResolution(source)
  // Hook filter (rolldown): only layered prefixes + `#super` reach the JS handler; every other
  // specifier skips the round-trip. https://rolldown.rs/in-depth/why-plugin-hook-filter
  const idFilter = new RegExp(
    `^(?:${resolution.prefixes.map(escapeRegExp).join('|')}|${SUPER_MODULE}(?:/|\\?|$))`,
  )

  return {
    name: 'vite-layers:resolve',
    enforce: 'pre', // before Vite core resolve; `@/`/`~/` are intentionally NOT registered as aliases
    configureServer(server) {
      // A new/removed file can change which layer wins. Targeted invalidation, not a full clear —
      // dev codegen (typed-router, dts emitters) would otherwise wipe the cache on every emit.
      const invalidateFile = (file: string) => resolution.invalidateFile(file)
      server.watcher.on('add', invalidateFile)
      server.watcher.on('unlink', invalidateFile)
      server.watcher.on('unlinkDir', dir => resolution.invalidateDir(dir))
    },
    resolveId: {
      filter: { id: idFilter },
      handler(id, importer) {
        return resolution.resolveId(id, importer)
      },
    },
  }
}
