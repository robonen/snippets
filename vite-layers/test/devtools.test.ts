import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { JsonRenderElement, JsonRenderSpec, ViteDevToolsNodeContext } from '@vitejs/devtools-kit'
import { resolveLayerStack } from '../src/config'
import { inheritanceTreeText, layersDevtoolsPlugin, type LayersDevtoolsData } from '../src/devtools'
import { createLayeredResolution } from '../src/resolve'
import type { LayerStack } from '../src/types'

const here = dirname(fileURLToPath(import.meta.url))
const toPosix = (p: string) => p.replace(/\\/g, '/')
const fixture = (p: string) => toPosix(resolve(here, 'fixtures', 'devtools', p))
const env = { command: 'serve', mode: 'development', isSsrBuild: false, isPreview: false } as const

/**
 * Validate a json-render spec is renderable: the root exists, every referenced child id exists, and
 * every action wired to a button is one our plugin actually registers. Catches the classic broken
 * spec (a dangling child id) that would render as a blank panel.
 */
function assertValidSpec(spec: JsonRenderSpec, registeredActions: Set<string>) {
  expect(spec.elements[spec.root], `root "${spec.root}" missing`).toBeTruthy()
  const visit = (el: JsonRenderElement) => {
    for (const childId of el.children ?? []) {
      expect(spec.elements[childId], `dangling child id "${childId}"`).toBeTruthy()
    }
    const press = (el.on as { press?: { action?: string } } | undefined)?.press
    if (press?.action) expect(registeredActions.has(press.action), `unknown action "${press.action}"`).toBe(true)
  }
  for (const el of Object.values(spec.elements)) visit(el)
}

interface RendererHandle {
  spec: JsonRenderSpec
  updateSpec: (s: JsonRenderSpec) => void
  updateState: (s: Record<string, unknown>) => void
  _stateKey: string
}

/** A minimal stand-in for the kit's node context — records what the plugin registers. */
function makeCtx() {
  const docks: Array<{ entry: Record<string, unknown>; patches: Array<Record<string, unknown>> }> = []
  const rpc = new Map<string, (params?: Record<string, unknown>) => unknown>()
  const commands: Array<Record<string, unknown>> = []
  const messages: Array<Record<string, unknown>> = []
  const renderers: RendererHandle[] = []

  const ctx = {
    createJsonRenderer(spec: JsonRenderSpec): RendererHandle {
      const handle: RendererHandle = {
        spec,
        _stateKey: `state:${renderers.length}`,
        updateSpec(s) {
          handle.spec = s
        },
        updateState() {},
      }
      renderers.push(handle)
      return handle
    },
    docks: {
      register(entry: Record<string, unknown>) {
        const rec = { entry, patches: [] as Array<Record<string, unknown>> }
        docks.push(rec)
        return { update: (patch: Record<string, unknown>) => rec.patches.push(patch) }
      },
    },
    rpc: {
      register(def: { name: string; setup: () => { handler: (p?: Record<string, unknown>) => unknown } }) {
        rpc.set(def.name, def.setup().handler)
      },
    },
    commands: {
      register(cmd: Record<string, unknown>) {
        commands.push(cmd)
        return { id: cmd.id, update() {}, unregister() {} }
      },
    },
    messages: {
      add(input: Record<string, unknown>) {
        messages.push(input)
        return Promise.resolve({ id: String(input.id ?? ''), entry: input, update: async () => undefined, dismiss: async () => {} })
      },
    },
  }

  return { ctx: ctx as unknown as ViteDevToolsNodeContext, docks, rpc, commands, messages, renderers }
}

describe('layersDevtoolsPlugin', () => {
  let stack: LayerStack
  let data: LayersDevtoolsData

  beforeAll(async () => {
    stack = await resolveLayerStack(fixture('app'))
    data = {
      appDir: fixture('app'),
      env,
      stack,
      resolution: createLayeredResolution({ roots: stack.layers.map(l => l.srcDir), record: 50 }),
      tsconfig: {},
    }
  })

  it('returns a Vite plugin carrying a devtools.setup hook', () => {
    const plugin = layersDevtoolsPlugin(data)
    expect(plugin.name).toBe('vite-layers:devtools')
    expect(typeof plugin.devtools?.setup).toBe('function')
  })

  it('resolves the expected two-layer fixture stack (app over base)', () => {
    expect(stack.layers.map(l => l.name)).toEqual(['app', 'base'])
    expect(stack.merged.features).toMatchObject({ billing: false, shared: 'base' })
  })

  it('registers a group + four json-render panels, all with valid specs', async () => {
    const m = makeCtx()
    await layersDevtoolsPlugin(data).devtools!.setup!(m.ctx)

    const ids = m.docks.map(d => d.entry.id)
    expect(ids).toContain('vite-layers')
    expect(ids).toEqual(expect.arrayContaining(['vite-layers:layers', 'vite-layers:features', 'vite-layers:resolver', 'vite-layers:assets']))

    const group = m.docks.find(d => d.entry.id === 'vite-layers')!.entry
    expect(group.type).toBe('group')

    const panels = m.docks.filter(d => d.entry.type === 'json-render')
    expect(panels).toHaveLength(4)
    for (const p of panels) expect(p.entry.groupId).toBe('vite-layers')

    const actions = new Set(m.rpc.keys())
    for (const h of m.renderers) assertValidSpec(h.spec, actions)
  })

  it('registers the refresh / resolve / clear-log actions and a refresh command', async () => {
    const m = makeCtx()
    await layersDevtoolsPlugin(data).devtools!.setup!(m.ctx)
    expect([...m.rpc.keys()]).toEqual(
      expect.arrayContaining(['vite-layers:refresh', 'vite-layers:resolve', 'vite-layers:clear-log']),
    )
    expect(m.commands.some(c => c.id === 'vite-layers:refresh')).toBe(true)
  })

  it('badges the Features panel with the disabled-flag count', async () => {
    const m = makeCtx()
    await layersDevtoolsPlugin(data).devtools!.setup!(m.ctx)
    const featuresDock = m.docks.find(d => d.entry.id === 'vite-layers:features')!
    // `billing` is the only leaf flag disabled in the merged stack.
    expect(featuresDock.patches.some(p => p.badge === '1')).toBe(true)
  })

  it('emits an init message summarizing the stack', async () => {
    const m = makeCtx()
    await layersDevtoolsPlugin(data).devtools!.setup!(m.ctx)
    expect(m.messages).toHaveLength(1)
    expect(m.messages[0]).toMatchObject({ level: 'info', category: 'vite-layers' })
    expect(String(m.messages[0]!.message)).toContain('2 layers')
  })

  it('resolve action computes the candidate stack and rebuilds the resolver panel', async () => {
    const m = makeCtx()
    await layersDevtoolsPlugin(data).devtools!.setup!(m.ctx)

    const resolverDock = m.docks.find(d => d.entry.id === 'vite-layers:resolver')!
    const resolverUi = resolverDock.entry.ui as RendererHandle

    await m.rpc.get('vite-layers:resolve')!({ id: '@/components/Header.vue' })

    const json = JSON.stringify(resolverUi.spec)
    // app/Header.vue wins, base/Header.vue is shadowed — both candidate files appear.
    expect(json).toContain(toPosix(resolve(fixture('app'), 'src/components/Header.vue')))
    expect(json).toContain(toPosix(resolve(fixture('base'), 'src/components/Header.vue')))
    expect(json).toContain('winner')
    expect(json).toContain('shadowed')

    const actions = new Set(m.rpc.keys())
    assertValidSpec(resolverUi.spec, actions)
  })

  it('reports a friendly error for a non-layered id', async () => {
    const m = makeCtx()
    await layersDevtoolsPlugin(data).devtools!.setup!(m.ctx)
    const resolverUi = m.docks.find(d => d.entry.id === 'vite-layers:resolver')!.entry.ui as RendererHandle
    await m.rpc.get('vite-layers:resolve')!({ id: 'vue' })
    expect(JSON.stringify(resolverUi.spec)).toContain('Not a layered id')
  })

  it('works with tsconfig autogen disabled', async () => {
    const m = makeCtx()
    await layersDevtoolsPlugin({ ...data, tsconfig: false }).devtools!.setup!(m.ctx)
    const assetsUi = m.docks.find(d => d.entry.id === 'vite-layers:assets')!.entry.ui as RendererHandle
    expect(JSON.stringify(assetsUi.spec)).toContain('disabled')
  })

  it('renders the inheritance tree into the Layers panel', async () => {
    const m = makeCtx()
    await layersDevtoolsPlugin(data).devtools!.setup!(m.ctx)
    const layersUi = m.docks.find(d => d.entry.id === 'vite-layers:layers')!.entry.ui as RendererHandle
    const json = JSON.stringify(layersUi.spec)
    expect(json).toContain('Inheritance (extends graph)')
    expect(json).toContain('└── base')
  })
})

describe('inheritanceTreeText', () => {
  let appStack: LayerStack
  beforeAll(async () => {
    appStack = await resolveLayerStack(fixture('app'))
  })

  it('draws a simple chain (app extends base)', () => {
    const tree = inheritanceTreeText(appStack)
    const lines = tree.split('\n')
    expect(lines[0]).toMatch(/^app {2}#0 {3}\(project/)
    expect(lines[1]).toBe('└── base  #1')
  })

  it('draws a diamond once, marking the repeated node with ↑ above (no infinite recursion)', async () => {
    const stack = await resolveLayerStack(toPosix(resolve(here, 'fixtures', 'diamond', 'app')))
    const tree = inheritanceTreeText(stack)
    // app → b → d, and app → c → d (d is the diamond tip, reached twice)
    expect(tree).toContain('├── b')
    expect(tree).toContain('└── c')
    expect(tree).toContain('↑ above') // d's second occurrence is collapsed, not re-expanded
    // d is drawn exactly once in full + once as a back-reference
    expect(tree.match(/^.*── d {2}#\d/gm)?.length).toBe(2)
  })

  it('marks an edge to a non-layer (npm/git) target as external', () => {
    const synthetic: LayerStack = {
      merged: {},
      layers: [{ name: 'app', rootDir: '/x/app', srcDir: '/x/app/src', config: {} }],
      edges: [{ from: '/x/app', to: '/x/node_modules/some-npm-layer', source: 'some-npm-layer' }],
    }
    expect(inheritanceTreeText(synthetic)).toContain('some-npm-layer   (external)')
  })

  it('lists layers not reached via the edge graph (auto-scan fallback)', () => {
    const synthetic: LayerStack = {
      merged: {},
      layers: [
        { name: 'app', rootDir: '/x/app', srcDir: '/x/app/src', config: {} },
        { name: 'scanned', rootDir: '/x/scanned', srcDir: '/x/scanned/src', config: {} },
      ],
      edges: [], // nothing links to `scanned`
    }
    const tree = inheritanceTreeText(synthetic)
    expect(tree).toContain('not reached via extends')
    expect(tree).toContain('• scanned  #1')
  })
})
