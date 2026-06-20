import { readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import type { ConfigEnv } from 'vite'
import type {
  DevToolsServerCommandInput,
  DevToolsViewGroup,
  DevToolsViewJsonRender,
  JsonRenderElement,
  JsonRenderSpec,
  PluginWithDevTools,
  ViteDevToolsNodeContext,
} from '@vitejs/devtools-kit'
import { flattenFeatures } from './features'
import type { LayeredResolution, ResolveRecord } from './resolve'
import { generateTsConfig, type GenerateTsConfigOptions } from './tsconfig'
import type { LayerStack } from './types'
import { toPosix } from './util'

// ---------------------------------------------------------------------------------------------
// This module imports **only types** from `@vitejs/devtools-kit` — they are erased at emit, so the
// plugin has no runtime dependency on the kit and is fully inert unless the `@vitejs/devtools` hub
// mounts it and calls `setup`. The kit's `defineRpcFunction`/`defineDockEntry`/`defineCommand` are
// pure identity helpers and `register()` accepts plain objects, so we hand-build the (typed) specs.
//
// We import the real kit types (rather than re-declaring a local subset) on purpose: when the hub is
// present it augments `vite`'s `Plugin` with `devtools`, and the real types keep our `setup`
// signature consistent with that augmentation. The kit ships transitively with `@vitejs/devtools`, so
// any project using these panels already has it; type-checking vite-layers needs the kit present
// (an optional peer in the install sense, required in the type-check sense for this raw-source pkg).
// ---------------------------------------------------------------------------------------------

const NS = 'vite-layers'
const GROUP_ID = NS
const PANEL = {
  layers: `${NS}:layers`,
  features: `${NS}:features`,
  resolver: `${NS}:resolver`,
  assets: `${NS}:assets`,
} as const
const RPC = {
  refresh: `${NS}:refresh`,
  resolve: `${NS}:resolve`,
  clearLog: `${NS}:clear-log`,
} as const
const ICON = {
  group: 'ph:stack-duotone',
  layers: 'ph:stack-duotone',
  features: 'ph:toggle-right-duotone',
  resolver: 'ph:signpost-duotone',
  assets: 'ph:images-duotone',
  refresh: 'ph:arrows-clockwise-duotone',
} as const

/** Data the devtools panel needs, captured by `buildViteConfig` at config-resolution time. */
export interface LayersDevtoolsData {
  /** The app directory (the cwd `resolveLayerStack` was called with). */
  appDir: string
  /** The Vite env (`command`/`mode`) the config was built for. */
  env: ConfigEnv
  /** The resolved, in-effect layer stack (after `layers:resolved` hooks). */
  stack: LayerStack
  /** The live layered resolution — shared with `vite-layers:resolve` so the panel sees real data. */
  resolution: LayeredResolution
  /** tsconfig generation options, or `false` when autogen is disabled. */
  tsconfig: GenerateTsConfigOptions | false
}

// ---------------------------------------------------------------------------------------------
// Snapshot — a plain, serializable view of the stack the spec builders render. Cheap to recompute,
// so `vite-layers:refresh` just rebuilds it (re-walking `public/`, re-reading the resolution log).
// ---------------------------------------------------------------------------------------------

interface LayerRow {
  index: number
  name: string
  project: boolean
  extends: string
  rootDir: string
  srcDir: string
}
interface FeatureRow {
  key: string
  value: string
  type: string
  kind: 'leaf' | 'group'
  enabled: boolean
}
// These two row shapes are handed to `DataTable` as-is (not re-mapped at the call site), so they
// carry an index signature to satisfy the renderer's `Record<string, unknown>` row type.
interface PublicRow {
  path: string
  winner: string
  shadowedBy: string
  [key: string]: unknown
}
interface HookRow {
  hook: string
  layer: string
  [key: string]: unknown
}
type TsconfigInfo =
  | { enabled: false }
  | { enabled: true; paths: Record<string, string[]>; appJson: string; nodeJson: string; dts: string }

interface Snapshot {
  projectName: string
  appDir: string
  mode: string
  command: string
  layers: LayerRow[]
  mergedTree: Record<string, unknown>
  features: FeatureRow[]
  rawFeatures: Record<string, unknown>
  featureLeafCount: number
  featureDisabledCount: number
  publicAssets: PublicRow[]
  publicLayerCount: number
  hooks: HookRow[]
  tsconfig: TsconfigInfo
  inheritanceTree: string
}

/** Recursively list files under a directory (absolute paths); `[]` if it isn't a directory. */
function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of entries) {
    const abs = join(dir, name)
    // Guard each stat: a broken symlink or a file unlinked between readdir and stat (a real TOCTOU
    // window under the dev watcher) throws ENOENT — skip it instead of failing the whole snapshot.
    let isDir: boolean
    try {
      isDir = statSync(abs).isDirectory()
    } catch {
      continue
    }
    if (isDir) walk(abs, out)
    else out.push(abs)
  }
  return out
}

const asArray = (v: unknown): string[] =>
  v == null ? [] : (Array.isArray(v) ? v : [v]).map(String)

const TRAILING_SLASHES_RE = /\/+$/
const noTrailing = (p: string) => p.replace(TRAILING_SLASHES_RE, '')

/**
 * Render the layer **extends graph** as a box-drawing tree (for a monospace CodeBlock).
 *
 * The resolved stack is a flat priority order; the *structure* comes from `stack.edges` — the
 * parent→child edges captured during resolution (c12 strips the `extends` keys from resolved configs,
 * so they can't be read back afterwards). Diamonds (a layer reached via two parents) are drawn once
 * and marked `↑ above` on repeat — no infinite recursion. Edges whose target isn't a stack layer (npm
 * / git sources) become `(external)` leaves, and any layer never reached from the project is listed
 * below so the view stays complete. With no `edges` (a hand-built stack) only the project is drawn.
 */
export function inheritanceTreeText(stack: LayerStack): string {
  const { layers, edges = [] } = stack
  const byRoot = new Map<string, number>()
  layers.forEach((l, i) => byRoot.set(noTrailing(toPosix(l.rootDir)), i))

  // Group edges by the (normalized) directory they extend FROM, preserving walk order.
  const childEdges = new Map<string, Array<{ index: number } | { external: string }>>()
  for (const e of edges) {
    const fromKey = noTrailing(toPosix(e.from))
    const idx = byRoot.get(noTrailing(toPosix(e.to)))
    const list = childEdges.get(fromKey) ?? childEdges.set(fromKey, []).get(fromKey)!
    list.push(idx !== undefined ? { index: idx } : { external: e.source })
  }
  const childrenOf = (i: number) => childEdges.get(noTrailing(toPosix(layers[i]!.rootDir))) ?? []

  const lines: string[] = []
  const seen = new Set<number>()

  const render = (i: number, prefix: string, isLast: boolean, isRoot: boolean) => {
    const connector = isRoot ? '' : isLast ? '└── ' : '├── '
    const repeated = seen.has(i)
    const tag = isRoot ? '   (project · highest priority)' : ''
    lines.push(`${prefix}${connector}${layers[i]!.name}  #${i}${tag}${repeated ? '   ↑ above' : ''}`)
    if (repeated) return
    seen.add(i)

    const kids = childrenOf(i)
    const childPrefix = prefix + (isRoot ? '' : isLast ? '    ' : '│   ')
    kids.forEach((k, ci) => {
      const last = ci === kids.length - 1
      if ('index' in k) render(k.index, childPrefix, last, false)
      else lines.push(`${childPrefix}${last ? '└── ' : '├── '}${k.external}   (external)`)
    })
  }

  render(0, '', true, true)

  const orphans = layers.map((_, i) => i).filter(i => !seen.has(i))
  if (orphans.length) {
    lines.push('')
    lines.push('not reached via extends (e.g. auto-scanned layers/*):')
    for (const i of orphans) lines.push(`• ${layers[i]!.name}  #${i}`)
  }

  return lines.join('\n')
}

async function collectSnapshot(data: LayersDevtoolsData): Promise<Snapshot> {
  const { layers, merged } = data.stack

  const layerRows: LayerRow[] = layers.map((l, index) => ({
    index,
    name: l.name,
    project: index === 0,
    extends: asArray(l.config.extends).join(', ') || '—',
    rootDir: l.rootDir,
    srcDir: l.srcDir,
  }))

  // Features: every dotted path (groups + leaves). Leaves drive DCE; a falsy leaf is the value the
  // `feature()` macro folds to `false`, killing its branch + chunk.
  const flat = flattenFeatures((merged.features ?? {}) as Record<string, unknown>)
  const features: FeatureRow[] = flat.map(([key, value]) => {
    const group = value != null && typeof value === 'object'
    return {
      key,
      value: JSON.stringify(value) ?? String(value),
      type: Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value,
      kind: group ? 'group' : 'leaf',
      enabled: Boolean(value),
    }
  })
  const leaves = features.filter(f => f.kind === 'leaf')

  // Public assets: walk each layer's `public/` high→low; the first layer to hold a path wins, the
  // rest are shadowed — mirrors `publicLayersPlugin`'s first-match-by-priority resolution.
  const publicLayers = layers
    .map(l => ({ name: l.name, dir: resolve(l.rootDir, 'public') }))
    .filter(p => {
      try {
        return statSync(p.dir).isDirectory()
      } catch {
        return false
      }
    })
  const byPath = new Map<string, string[]>()
  for (const { name, dir } of publicLayers) {
    for (const abs of walk(dir)) {
      const rel = toPosix(relative(dir, abs))
      ;(byPath.get(rel) ?? byPath.set(rel, []).get(rel)!).push(name)
    }
  }
  const publicAssets: PublicRow[] = [...byPath.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, names]) => ({
      path,
      winner: names[0]!,
      shadowedBy: names.slice(1).join(', ') || '—',
    }))

  // Per-layer lifecycle hooks (base-first display order, like registration).
  const hooks: HookRow[] = []
  for (const l of [...layers].reverse()) {
    for (const hook of Object.keys(l.config.hooks ?? {})) hooks.push({ hook, layer: l.name })
  }

  // Curated merged view for the Tree — omit `vite` (functions/plugins) and `hooks` (functions),
  // which aren't serializable and aren't useful as a tree.
  const mergedTree: Record<string, unknown> = {
    name: merged.name,
    extends: merged.extends,
    srcDir: merged.srcDir,
    features: merged.features ?? {},
    tsConfig: merged.tsConfig,
    vite: merged.vite ? '[Vite config fragment — see Vite DevTools]' : undefined,
    hooks: hooks.length ? hooks.map(h => `${h.hook} (${h.layer})`) : undefined,
  }

  let tsconfig: TsconfigInfo = { enabled: false }
  if (data.tsconfig !== false) {
    const opts = typeof data.tsconfig === 'object' ? data.tsconfig : {}
    const gen = await generateTsConfig(data.appDir, { ...opts, stack: data.stack })
    tsconfig = {
      enabled: true,
      paths: (gen.tsconfig.compilerOptions?.paths ?? {}) as Record<string, string[]>,
      appJson: JSON.stringify(gen.tsconfig, null, 2),
      nodeJson: JSON.stringify(gen.nodeTsconfig, null, 2),
      dts: gen.dts,
    }
  }

  return {
    projectName: layers[0]?.name ?? 'app',
    appDir: data.appDir,
    mode: data.env.mode,
    command: data.env.command,
    layers: layerRows,
    mergedTree,
    features,
    rawFeatures: (merged.features ?? {}) as Record<string, unknown>,
    featureLeafCount: leaves.length,
    featureDisabledCount: leaves.filter(f => !f.enabled).length,
    publicAssets,
    publicLayerCount: publicLayers.length,
    hooks,
    tsconfig,
    inheritanceTree: inheritanceTreeText(data.stack),
  }
}

/** Which layer (by name) owns a resolved file — found by matching the file against layer `srcDir`s. */
function layerOf(stack: LayerStack, file: string | null): string {
  if (!file) return '—'
  const f = toPosix(file.split('?')[0]!)
  for (const l of stack.layers) {
    const src = toPosix(l.srcDir)
    if (f === src || f.startsWith(`${src}/`)) return l.name
  }
  return '?'
}

// ---------------------------------------------------------------------------------------------
// Spec builder — a tiny DSL over the flat `{ root, elements }` json-render shape. Each `add*`
// returns the generated element id, so panels compose by nesting calls.
// ---------------------------------------------------------------------------------------------

interface Column {
  key: string
  label: string
  width?: string
}

class Spec {
  private readonly elements: Record<string, JsonRenderElement> = {}
  private readonly state: Record<string, unknown> = {}
  private n = 0

  private add(node: JsonRenderElement): string {
    const id = `e${this.n++}`
    this.elements[id] = node
    return id
  }

  setState(key: string, value: unknown): this {
    this.state[key] = value
    return this
  }

  vstack(children: string[], gap = 12, padding?: number): string {
    return this.add({ type: 'Stack', props: { direction: 'vertical', gap, padding }, children })
  }

  hstack(children: string[], props: Record<string, unknown> = {}): string {
    return this.add({ type: 'Stack', props: { direction: 'horizontal', gap: 8, align: 'center', ...props }, children })
  }

  card(title: string, children: string[], collapsible = false): string {
    return this.add({ type: 'Card', props: { title, collapsible }, children })
  }

  text(content: string, variant?: 'heading' | 'body' | 'caption' | 'code'): string {
    return this.add({ type: 'Text', props: { content, variant } })
  }

  badge(text: string, variant: 'default' | 'info' | 'success' | 'warning' | 'error' = 'default', title?: string): string {
    return this.add({ type: 'Badge', props: { text, variant, title } })
  }

  divider(label?: string): string {
    return this.add({ type: 'Divider', props: { label } })
  }

  kvTable(entries: Array<{ key: string; value: string }>, title?: string): string {
    return this.add({ type: 'KeyValueTable', props: { title, entries } })
  }

  dataTable(columns: Column[], rows: Array<Record<string, unknown>>, maxHeight = '360px'): string {
    return this.add({ type: 'DataTable', props: { columns, rows, maxHeight } })
  }

  tree(data: unknown, expandLevel = 1): string {
    return this.add({ type: 'Tree', props: { data, expandLevel } })
  }

  code(code: string, filename?: string, maxHeight = '320px'): string {
    return this.add({ type: 'CodeBlock', props: { code, filename, maxHeight } })
  }

  button(label: string, action: string, opts: { icon?: string; variant?: string; params?: Record<string, unknown> } = {}): string {
    return this.add({
      type: 'Button',
      props: { label, icon: opts.icon, variant: opts.variant ?? 'secondary' },
      on: { press: { action, params: opts.params } },
    })
  }

  textInput(stateKey: string, placeholder: string): string {
    return this.add({ type: 'TextInput', props: { placeholder, value: { $bindState: `/${stateKey}` } } })
  }

  build(root: string): JsonRenderSpec {
    return { root, elements: this.elements, state: this.state }
  }
}

/** A header row: a heading on the left, a Refresh button on the right. */
function header(s: Spec, title: string, subtitle: string): string {
  const left = s.vstack([s.text(title, 'heading'), s.text(subtitle, 'caption')], 2)
  const refresh = s.button('Refresh', RPC.refresh, { icon: ICON.refresh })
  return s.hstack([left, refresh], { justify: 'space-between' })
}

// ---------------------------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------------------------

function buildLayersSpec(snap: Snapshot): JsonRenderSpec {
  const s = new Spec()
  const sections: string[] = [
    header(s, 'Layers', `${snap.layers.length} layers · ${snap.projectName} · ${snap.command}/${snap.mode}`),
  ]

  // Headline visual: the extends graph drawn as a tree (the structure the flat stack flattens away).
  sections.push(
    s.card('Inheritance (extends graph)', [
      s.code(snap.inheritanceTree, 'extends graph'),
      s.text('Reconstructed from each layer’s extends. Diamonds drawn once (↑ above); external (npm/git) sources marked.', 'caption'),
    ]),
  )

  sections.push(
    s.card('Layer stack (high → low priority)', [
      s.dataTable(
        [
          { key: 'index', label: '#', width: '36px' },
          { key: 'name', label: 'Name' },
          { key: 'role', label: 'Role', width: '90px' },
          { key: 'extends', label: 'Extends' },
          { key: 'srcDir', label: 'srcDir' },
        ],
        snap.layers.map(l => ({
          index: l.index,
          name: l.name,
          role: l.project ? 'project' : 'layer',
          extends: l.extends,
          srcDir: l.srcDir,
        })),
      ),
      s.text('layers[0] is the project (highest priority); collisions resolve to the smaller index.', 'caption'),
    ]),
  )

  sections.push(s.card('Merged config', [s.tree(prune(snap.mergedTree), 2)], true))

  if (snap.hooks.length) {
    sections.push(
      s.card(
        'Lifecycle hooks',
        [
          s.dataTable(
            [
              { key: 'hook', label: 'Hook' },
              { key: 'layer', label: 'Declared by' },
            ],
            snap.hooks,
            '200px',
          ),
          s.text('Hooks run serially, base layer first.', 'caption'),
        ],
        true,
      ),
    )
  }

  return s.build(s.vstack(sections, 14, 12))
}

function buildFeaturesSpec(snap: Snapshot): JsonRenderSpec {
  const s = new Spec()
  const sections: string[] = [
    header(
      s,
      'Features',
      `${snap.featureLeafCount} flags · ${snap.featureDisabledCount} disabled (dead-code eliminated)`,
    ),
  ]

  if (snap.features.length === 0) {
    sections.push(s.text('No feature flags defined in any layer.', 'caption'))
  } else {
    sections.push(
      s.card('Flags (merged, high → low priority)', [
        s.dataTable(
          [
            { key: 'status', label: '', width: '30px' },
            { key: 'key', label: 'Key' },
            { key: 'value', label: 'Value' },
            { key: 'type', label: 'Type', width: '70px' },
            { key: 'dce', label: 'feature()', width: '150px' },
          ],
          snap.features.map(f => ({
            status: f.kind === 'group' ? '▸' : f.enabled ? '●' : '○',
            key: f.key,
            value: f.value,
            type: f.type,
            dce:
              f.kind === 'group'
                ? '(group)'
                : f.enabled
                  ? 'kept'
                  : 'branch eliminated',
          })),
        ),
      ]),
    )
    sections.push(s.card('Raw feature tree', [s.tree(snap.rawFeatures, 3)], true))
  }

  sections.push(
    s.card(
      'About dead-code elimination',
      [
        s.text(
          "feature('key') is replaced by the flag's literal at compile time (dev + build alike). " +
            'A disabled flag folds to false, so its branch — and any import() inside it — is statically ' +
            'dead and the chunk is never emitted. An unknown key fails the build.',
          'caption',
        ),
      ],
      true,
    ),
  )

  return s.build(s.vstack(sections, 14, 12))
}

interface ResolveResult {
  id: string
  sub: string
  query: string
  candidates: string[]
  error?: string
}

function buildResolverSpec(data: LayersDevtoolsData, query: string, result: ResolveResult | null): JsonRenderSpec {
  const s = new Spec()
  s.setState('query', query)

  const sections: string[] = [
    s.vstack([s.text('Resolver', 'heading'), s.text(`Prefixes: ${data.resolution.prefixes.join('  ')}`, 'caption')], 2),
  ]

  // Playground: type a layered id, resolve it across the stack.
  const input = s.textInput('query', 'e.g. @/components/AppHeader.vue')
  const go = s.button('Resolve', RPC.resolve, { icon: ICON.resolver, variant: 'primary', params: { id: { $state: '/query' } } })
  sections.push(s.card('Playground', [s.hstack([input, go]), ...resolveResultEls(s, data, result)]))

  // Live log of real @/ ~/ resolutions seen this session.
  const records = data.resolution.records()
  const logChildren: string[] = [
    s.hstack([s.text(`Live resolutions (${records.length})`, 'body'), s.button('Clear', RPC.clearLog, { icon: 'ph:eraser-duotone' })], {
      justify: 'space-between',
    }),
  ]
  if (records.length === 0) {
    logChildren.push(s.text('No layered imports resolved yet — load the app to populate this.', 'caption'))
  } else {
    logChildren.push(s.dataTable(
      [
        { key: 'id', label: 'Import' },
        { key: 'resolves', label: 'Resolves to (layer)', width: '150px' },
        { key: 'via', label: 'Via', width: '120px' },
        { key: 'n', label: '#cand', width: '60px' },
      ],
      records.map(r => ({
        id: r.id,
        resolves: layerOf(data.stack, r.resolved),
        via: recordVia(r),
        n: r.candidates.length,
      })),
      '300px',
    ))
  }
  sections.push(s.card('Live log', logChildren))

  return s.build(s.vstack(sections, 14, 12))
}

/** Describe how a record resolved: a normal import, a `super()` self-import, or unresolved. */
function recordVia(r: ResolveRecord): string {
  if (r.resolved === null) return 'unresolved'
  if (r.selfIndex < 0) return 'top match'
  return `super() #${r.selfIndex + 1}`
}

function resolveResultEls(s: Spec, data: LayersDevtoolsData, result: ResolveResult | null): string[] {
  if (!result) return [s.text('Enter a layered import above and press Resolve.', 'caption')]
  if (result.error) return [s.badge(result.error, 'error')]
  if (result.candidates.length === 0) {
    return [s.badge(`No file matches "${result.id}" in any layer.`, 'warning')]
  }
  const winner = result.candidates[0]!
  return [
    s.hstack([s.text('Resolves to', 'caption'), s.badge(layerOf(data.stack, winner), 'success', winner)]),
    s.dataTable(
      [
        { key: 'pri', label: '#', width: '36px' },
        { key: 'status', label: '', width: '90px' },
        { key: 'layer', label: 'Layer', width: '110px' },
        { key: 'file', label: 'File' },
      ],
      result.candidates.map((file, i) => ({
        pri: i,
        status: i === 0 ? 'winner' : 'shadowed',
        layer: layerOf(data.stack, file),
        file,
      })),
      '240px',
    ),
    s.text('A self-import (an override importing its own path) would super()-skip to the next row down.', 'caption'),
  ]
}

function buildAssetsSpec(snap: Snapshot): JsonRenderSpec {
  const s = new Spec()
  const sections: string[] = [
    header(s, 'Public & TS', `${snap.publicAssets.length} assets across ${snap.publicLayerCount} public/ dirs`),
  ]

  const publicChildren: string[] =
    snap.publicAssets.length === 0
      ? [s.text('No layer has a public/ directory.', 'caption')]
      : [
          s.dataTable(
            [
              { key: 'path', label: 'Asset' },
              { key: 'winner', label: 'Served from', width: '120px' },
              { key: 'shadowedBy', label: 'Shadows', width: '140px' },
            ],
            snap.publicAssets,
            '260px',
          ),
          s.text('Higher-priority layers win; the winner is served in dev and emitted to the build output.', 'caption'),
        ]
  sections.push(s.card('Layered public/ assets', publicChildren))

  if (snap.tsconfig.enabled) {
    const ts = snap.tsconfig
    sections.push(
      s.card(
        'Generated tsconfig paths',
        [
          s.kvTable(
            Object.entries(ts.paths).map(([key, value]) => ({ key, value: value.join('  •  ') })),
          ),
          s.text('@/ and ~/ map to every layer srcDir in priority order — tsc mirrors the runtime resolver.', 'caption'),
        ],
      ),
    )
    sections.push(s.card('.vite-layers/tsconfig.json', [s.code(ts.appJson, 'tsconfig.json')], true))
    sections.push(s.card('.vite-layers/tsconfig.node.json', [s.code(ts.nodeJson, 'tsconfig.node.json')], true))
    sections.push(s.card('.vite-layers/features.d.ts', [s.code(ts.dts, 'features.d.ts')], true))
  } else {
    sections.push(s.card('TypeScript', [s.text('tsconfig autogeneration is disabled (tsconfig: false).', 'caption')]))
  }

  return s.build(s.vstack(sections, 14, 12))
}

/** Drop `undefined` values so the merged-config Tree stays tidy. */
function prune(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v
  return out
}

// ---------------------------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------------------------

/** Build an `action`-type RPC definition. `register` takes the plain object (the kit's
 *  `defineRpcFunction` is identity); the parameter type is a broad conditional, so cast once here. */
type RpcDefinition = Parameters<ViteDevToolsNodeContext['rpc']['register']>[0]
const action = (name: string, handler: (params?: Record<string, unknown>) => void | Promise<void>): RpcDefinition =>
  ({ name, type: 'action', setup: () => ({ handler }) }) as unknown as RpcDefinition

/**
 * Run the layered resolver against a single id, for the playground. Uses `parse` + `candidates`
 * directly (not `resolveId`) so a manual query doesn't pollute the live log, and so we can show the
 * full candidate stack rather than just the winner.
 */
function runResolve(data: LayersDevtoolsData, rawId: unknown): ResolveResult {
  const id = String(rawId ?? '').trim()
  const parsed = data.resolution.parse(id)
  if (!id) return { id, sub: '', query: '', candidates: [], error: 'Enter an import id.' }
  if (!parsed) {
    return {
      id,
      sub: '',
      query: '',
      candidates: [],
      error: `Not a layered id — must start with one of: ${data.resolution.prefixes.join(', ')}`,
    }
  }
  return { id, sub: parsed.sub, query: parsed.query, candidates: data.resolution.candidates(parsed.sub) }
}

/**
 * The vite-layers DevTools integration: four json-render panels (Layers, Features, Resolver, Public &
 * TS) grouped under a single dock button, plus a refresh command and an init message. Server-rendered
 * JSON specs — no client bundle, keeping vite-layers buildless. Inert unless the `@vitejs/devtools`
 * hub mounts it; `buildViteConfig` attaches it by default (disable with `devtools: false`).
 */
export function layersDevtoolsPlugin(data: LayersDevtoolsData): PluginWithDevTools {
  return {
    name: 'vite-layers:devtools',
    devtools: {
      async setup(ctx: ViteDevToolsNodeContext) {
        let snap = await collectSnapshot(data)
        let lastQuery = ''
        let lastResult: ResolveResult | null = null

        const layersUi = ctx.createJsonRenderer(buildLayersSpec(snap))
        const featuresUi = ctx.createJsonRenderer(buildFeaturesSpec(snap))
        const resolverUi = ctx.createJsonRenderer(buildResolverSpec(data, lastQuery, lastResult))
        const assetsUi = ctx.createJsonRenderer(buildAssetsSpec(snap))

        // A single dock button collapsing the four panels (orphan-tolerant: if the host doesn't
        // render groups, the entries fall back to top-level — no loss of access).
        ctx.docks.register({ id: GROUP_ID, type: 'group', title: 'vite-layers', icon: ICON.group, category: 'app' } satisfies DevToolsViewGroup)

        const entry = (id: string, title: string, icon: string, ui: typeof layersUi, order: number) => {
          // Typed as the full entry interface (not the narrow literal) so the returned handle's
          // `update(patch)` accepts base-entry fields like `badge`.
          const view: DevToolsViewJsonRender = {
            id,
            title,
            icon,
            type: 'json-render',
            ui,
            groupId: GROUP_ID,
            category: 'app',
            defaultOrder: order,
          }
          return ctx.docks.register(view)
        }

        entry(PANEL.layers, 'Layers', ICON.layers, layersUi, 40)
        entry(PANEL.resolver, 'Resolver', ICON.resolver, resolverUi, 30)
        entry(PANEL.assets, 'Public & TS', ICON.assets, assetsUi, 20)
        const featuresEntry = entry(PANEL.features, 'Features', ICON.features, featuresUi, 35)
        const featuresBadge = () => (snap.featureDisabledCount > 0 ? String(snap.featureDisabledCount) : undefined)
        featuresEntry.update({ badge: featuresBadge() })

        const refresh = async () => {
          snap = await collectSnapshot(data)
          await Promise.all([
            layersUi.updateSpec(buildLayersSpec(snap)),
            featuresUi.updateSpec(buildFeaturesSpec(snap)),
            assetsUi.updateSpec(buildAssetsSpec(snap)),
            resolverUi.updateSpec(buildResolverSpec(data, lastQuery, lastResult)),
          ])
          featuresEntry.update({ badge: featuresBadge() })
        }

        ctx.rpc.register(action(RPC.refresh, refresh))
        ctx.rpc.register(action(RPC.resolve, async (params) => {
          lastResult = runResolve(data, params?.id)
          lastQuery = lastResult.id
          await resolverUi.updateSpec(buildResolverSpec(data, lastQuery, lastResult))
        }))
        ctx.rpc.register(action(RPC.clearLog, async () => {
          data.resolution.clearRecords()
          await resolverUi.updateSpec(buildResolverSpec(data, lastQuery, lastResult))
        }))

        ctx.commands.register({
          id: RPC.refresh,
          title: 'vite-layers: Refresh panels',
          icon: ICON.refresh,
          handler: refresh,
        } satisfies DevToolsServerCommandInput)

        void ctx.messages.add({
          id: `${NS}:ready`,
          message: `vite-layers: ${snap.layers.length} layers, ${snap.featureLeafCount - snap.featureDisabledCount}/${snap.featureLeafCount} features enabled`,
          level: 'info',
          category: NS,
        })
      },
    },
  }
}
