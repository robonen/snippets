import type { App } from 'vue'
import { setupDevtoolsPlugin } from '@vue/devtools-api'
import type { TabRuntime } from './tab/runtime'
import type { ClientMsg, ServerMsg, Transport } from './transport/protocol'
import { Kind, Msg, Status } from './core/flags'
import type { EntityDef, InfiniteQueryDef, MutationDef, QueryDef } from './core/types'
import { DEV } from './__dev'

/** Defaults from createEngine/bootstrapWorker — surfaced via installEngine opts. */
export interface SyncEngineDevtoolsOptions {
  defaults?: { staleTime?: number; gcTime?: number }
}

interface SyncEngineRegistry {
  entities: ReadonlyArray<EntityDef>
  queries: ReadonlyArray<(QueryDef | InfiniteQueryDef) & { name: string }>
  mutations: ReadonlyArray<MutationDef>
}

// Worker-side defaults from queryGraph (defaultStaleTime=30s, defaultGcTime=5m).
// We re-state them here so we can display effective values when the user did
// not pass explicit defaults via installEngine(app, runtime, { defaults }).
const INTERNAL_DEFAULT_STALE_MS = 30_000
const INTERNAL_DEFAULT_GC_MS = 300_000

const PLUGIN_ID = 'vue-sync-engine'
const INSPECTOR_ID = 'sync-engine'
const LAYER_ID = 'sync-engine'

const PINIA_GREEN = 0x42b883
const TAG_SUCCESS = { textColor: 0xffffff, backgroundColor: 0x42b883 }
const TAG_PENDING = { textColor: 0xffffff, backgroundColor: 0xf08d49 }
const TAG_ERROR = { textColor: 0xffffff, backgroundColor: 0xe53935 }
const TAG_IDLE = { textColor: 0xffffff, backgroundColor: 0x9e9e9e }
const TAG_SELF = { textColor: 0xffffff, backgroundColor: 0x42b883 }

// Index by StatusFlag (0..3). Hot-path lookup beats an if-cascade and keeps
// the call sites monomorphic (single function, single return type).
const STATUS_LABELS: readonly string[] = ['idle', 'pending', 'success', 'error']
const STATUS_TAGS: readonly { textColor: number; backgroundColor: number }[] = [
  TAG_IDLE,
  TAG_PENDING,
  TAG_SUCCESS,
  TAG_ERROR,
]

// Reused across summarizeEntityPatches() calls to avoid per-message Map
// allocation when EntityPatch bursts arrive during initial hydration.
const SCRATCH_TYPE_COUNTS = new Map<string, number>()

type TimelineLogType = 'default' | 'warning' | 'error'

const MAX_MUTATIONS = 50

interface QueryEntry {
  subId: string
  defName: string
  args: unknown
  status: number
  data: unknown
  error: { message: string } | undefined
  subscribedAt: number
  lastPatchAt: number
  patches: number
}

interface MutationEntry {
  mutId: string
  defName: string
  input: unknown
  status: number
  result: unknown
  error: { message: string } | undefined
  startedAt: number
  finishedAt: number | undefined
}

interface TabEntry {
  tabId: string
  self: boolean
  lastSeen: number
}

const ENGINE_ROOT = '__root_engine__'
const QUERIES_ROOT = '__root_queries__'
const ENTITIES_ROOT = '__root_entities__'
const MUTATIONS_ROOT = '__root_mutations__'
const TABS_ROOT = '__root_tabs__'

const QUERY_PREFIX = 'q:'
const ENTITY_TYPE_PREFIX = 'et:'
const MUTATION_PREFIX = 'm:'
const TAB_PREFIX = 't:'

const BC_CHANNEL = 'vue-sync-engine-devtools'
const HEARTBEAT_MS = 2_000
const TAB_TTL_MS = 5_500

export function setupSyncEngineDevtools(
  app: App,
  runtime: TabRuntime,
  opts?: SyncEngineDevtoolsOptions,
): void {
  if (!DEV) return
  if (typeof window === 'undefined') return

  const ownTabId = makeTabId()
  const subscriptions = new Map<string, QueryEntry>()
  const mutations = new Map<string, MutationEntry>()
  const mutationOrder: string[] = []
  const tabs = new Map<string, TabEntry>([
    [ownTabId, { tabId: ownTabId, self: true, lastSeen: Date.now() }],
  ])

  const userDefaults = opts?.defaults
  const defaultStaleMs = userDefaults?.staleTime ?? INTERNAL_DEFAULT_STALE_MS
  const defaultGcMs = userDefaults?.gcTime ?? INTERNAL_DEFAULT_GC_MS
  const defaultsAreExplicit = userDefaults !== undefined

  // Built once the lazy `virtual:sync-engine-registry` import resolves. Until
  // then they stay null and the inspector simply shows less meta.
  let queryDefByName: Map<string, (QueryDef | InfiniteQueryDef) & { name: string }> | null = null
  let entityDefByName: Map<string, EntityDef> | null = null
  let mutationDefByName: Map<string, MutationDef> | null = null

  let bc: BroadcastChannel | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let reapTimer: ReturnType<typeof setInterval> | null = null
  let treePending = false
  let statePending = false
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  let pluginApi: DevtoolsApi | null = null

  function scheduleFlush(): void {
    if (flushTimer !== null) return
    flushTimer = setTimeout(() => {
      flushTimer = null
      const api = pluginApi
      if (!api) return
      if (treePending) {
        treePending = false
        api.sendInspectorTree(INSPECTOR_ID)
      }
      if (statePending) {
        statePending = false
        api.sendInspectorState(INSPECTOR_ID)
      }
    }, 50)
  }
  function markTree(): void {
    treePending = true
    scheduleFlush()
  }
  function markState(): void {
    statePending = true
    scheduleFlush()
  }

  setupDevtoolsPlugin(
    {
      id: PLUGIN_ID,
      label: 'Sync Engine',
      app: app as unknown as DevtoolsPluginApp,
      packageName: 'vue-sync-engine',
      componentStateTypes: ['sync-engine'],
      enableEarlyProxy: true,
    },
    (api) => {
      pluginApi = api
      api.addInspector({
        id: INSPECTOR_ID,
        label: 'Sync Engine',
        icon: 'sync',
        treeFilterPlaceholder: 'Search queries, entities, mutations…',
        noSelectionText: 'Select a query, entity, mutation or tab',
      })
      api.addTimelineLayer({
        id: LAYER_ID,
        label: 'Sync Engine',
        color: PINIA_GREEN,
      })

      api.on.getInspectorTree((payload) => {
        if (payload.inspectorId !== INSPECTOR_ID) return
        payload.rootNodes = buildTree(payload.filter)
      })

      api.on.getInspectorState((payload) => {
        if (payload.inspectorId !== INSPECTOR_ID) return
        const state = buildState(payload.nodeId)
        if (state) payload.state = state
      })

      wrapTransport(runtime.transport, api)
      openCrossTabChannel(api)
      loadRegistry()
    },
  )

  function loadRegistry(): void {
    // Dynamic import inside the dev-gated function — Vite eliminates the
    // chunk in production builds (where DEV folds to false and the
    // whole setup body becomes dead code).
    import('virtual:sync-engine-registry')
      .then((m) => {
        const r = (m as { default: SyncEngineRegistry }).default
        queryDefByName = new Map(r.queries.map((q) => [q.name, q]))
        entityDefByName = new Map(r.entities.map((e) => [e.name, e]))
        mutationDefByName = new Map(r.mutations.map((mu) => [mu.name, mu]))
        markTree()
        markState()
      })
      .catch(() => {
        // Registry plugin not configured (e.g. embedded usage without Vite).
        // Devtools still works, just shows status/data without cache meta.
      })
  }

  function wrapTransport(transport: Transport, api: DevtoolsApi): void {
    const originalSend = transport.send.bind(transport)
    ;(transport as { send: Transport['send'] }).send = (msg: ClientMsg) => {
      recordOutgoing(msg, api)
      try {
        originalSend(msg)
      } finally {
        markTree()
      }
    }
    transport.onMessage((msg) => {
      recordIncoming(msg, api)
      markTree()
      markState()
    })
  }

  function recordOutgoing(msg: ClientMsg, api: DevtoolsApi): void {
    const now = api.now()
    switch (msg.type) {
      case Msg.Subscribe: {
        const entry: QueryEntry = {
          subId: msg.subId,
          defName: msg.defName,
          args: msg.args,
          status: Status.Pending,
          data: undefined,
          error: undefined,
          subscribedAt: now,
          lastPatchAt: now,
          patches: 0,
        }
        subscriptions.set(msg.subId, entry)
        emitTimeline(
          api,
          now,
          'Subscribe',
          `${msg.defName} · ${shortSubId(msg.subId)}`,
          { tabId: ownTabId, defName: msg.defName, subId: msg.subId, args: msg.args },
          'default',
        )
        return
      }
      case Msg.Unsubscribe: {
        subscriptions.delete(msg.subId)
        emitTimeline(api, now, 'Unsubscribe', shortSubId(msg.subId), { tabId: ownTabId, subId: msg.subId }, 'default')
        return
      }
      case Msg.Mutate: {
        const entry: MutationEntry = {
          mutId: msg.mutId,
          defName: msg.defName,
          input: msg.input,
          status: Status.Pending,
          result: undefined,
          error: undefined,
          startedAt: now,
          finishedAt: undefined,
        }
        addMutation(entry)
        emitTimeline(
          api,
          now,
          'Mutate',
          msg.defName,
          { tabId: ownTabId, defName: msg.defName, mutId: msg.mutId, input: msg.input },
          'default',
        )
        return
      }
      case Msg.FetchNextPage: {
        emitTimeline(api, now, 'FetchNextPage', msg.subId, { tabId: ownTabId, subId: msg.subId }, 'default')
        return
      }
    }
  }

  function recordIncoming(msg: ServerMsg, api: DevtoolsApi): void {
    const now = api.now()
    switch (msg.type) {
      case Msg.QueryPatch: {
        const entry = subscriptions.get(msg.subId)
        const label = STATUS_LABELS[msg.status] ?? String(msg.status)
        if (entry) {
          entry.status = msg.status
          entry.error = msg.error
          entry.lastPatchAt = now
          entry.patches++
          const snap = runtime.mirror.ensureQuery(msg.subId).value
          entry.data = snap.data
        }
        emitTimeline(
          api,
          now,
          'QueryPatch',
          `${entry !== undefined ? entry.defName : shortSubId(msg.subId)} · ${label}`,
          { tabId: ownTabId, subId: msg.subId, status: label, error: msg.error },
          msg.status === Status.Error ? 'error' : 'default',
        )
        return
      }
      case Msg.EntityPatch: {
        const patches = msg.patches
        const len = patches.length
        emitTimeline(
          api,
          now,
          'EntityPatch',
          summarizeEntityPatches(patches),
          { tabId: ownTabId, count: len, sample: len > 10 ? patches.slice(0, 10) : patches },
          'default',
        )
        return
      }
      case Msg.MutateResult: {
        const entry = mutations.get(msg.mutId)
        if (entry) {
          entry.status = msg.ok ? Status.Success : Status.Error
          entry.finishedAt = now
          if (msg.ok) entry.result = msg.data
          else entry.error = msg.error
        }
        emitTimeline(
          api,
          now,
          'MutateResult',
          `${entry !== undefined ? entry.defName : msg.mutId} · ${msg.ok ? 'success' : 'error'}`,
          { tabId: ownTabId, mutId: msg.mutId, ok: msg.ok, data: msg.data, error: msg.error },
          msg.ok ? 'default' : 'error',
        )
        return
      }
    }
  }

  function addMutation(entry: MutationEntry): void {
    mutations.set(entry.mutId, entry)
    mutationOrder.push(entry.mutId)
    while (mutationOrder.length > MAX_MUTATIONS) {
      const oldest = mutationOrder.shift()
      if (oldest !== undefined) mutations.delete(oldest)
    }
  }

  function buildTree(filter: string): InspectorNode[] {
    const f = (filter || '').toLowerCase().trim()
    const match = (s: string) => !f || s.toLowerCase().includes(f)
    const now = Date.now()

    const queryChildren: InspectorNode[] = []
    for (const entry of subscriptions.values()) {
      if (!match(entry.defName) && !match(entry.subId)) continue
      const def = queryDefByName !== null ? queryDefByName.get(entry.defName) : undefined
      const stale = def?.staleTime ?? defaultStaleMs
      const ageMs = now - entry.lastPatchAt
      const tags: InspectorNode['tags'] = [
        { label: statusLabel(entry.status), textColor: statusTag(entry.status).textColor, backgroundColor: statusTag(entry.status).backgroundColor },
      ]
      if (entry.status === Status.Success && ageMs > stale) {
        tags.push({ label: 'stale', textColor: 0xffffff, backgroundColor: 0xf08d49 })
      }
      queryChildren.push({
        id: QUERY_PREFIX + entry.subId,
        label: `${entry.defName} · ${shortSubId(entry.subId)}`,
        tags,
      })
    }

    const entityChildren: InspectorNode[] = []
    for (const [type, bucket] of runtime.mirror.entities) {
      if (!match(type)) continue
      const def = entityDefByName !== null ? entityDefByName.get(type) : undefined
      const tags: InspectorNode['tags'] = [{ ...TAG_IDLE, label: `${bucket.size}` }]
      if (def !== undefined && def.storage !== undefined) {
        tags.push({ label: 'persisted', textColor: 0xffffff, backgroundColor: 0x42b883 })
      }
      entityChildren.push({
        id: ENTITY_TYPE_PREFIX + type,
        label: type,
        tags,
      })
    }

    const mutationChildren: InspectorNode[] = []
    for (let i = mutationOrder.length - 1; i >= 0; i--) {
      const entry = mutations.get(mutationOrder[i])
      if (!entry) continue
      if (!match(entry.defName) && !match(entry.mutId)) continue
      mutationChildren.push({
        id: MUTATION_PREFIX + entry.mutId,
        label: `${entry.defName}`,
        tags: [{ ...statusTag(entry.status), label: statusLabel(entry.status) }],
      })
    }

    const tabChildren: InspectorNode[] = []
    for (const tab of tabs.values()) {
      if (!match(tab.tabId)) continue
      const tags: InspectorNode['tags'] = []
      if (tab.self) tags.push({ ...TAG_SELF, label: 'self' })
      tabChildren.push({
        id: TAB_PREFIX + tab.tabId,
        label: shortTabId(tab.tabId),
        tags,
      })
    }

    return [
      {
        id: ENGINE_ROOT,
        label: 'Engine',
        tags: [
          {
            label: defaultsAreExplicit ? `stale ${formatMs(defaultStaleMs)}` : `stale ${formatMs(defaultStaleMs)} (assumed)`,
            textColor: 0xffffff,
            backgroundColor: 0x42b883,
          },
          {
            label: defaultsAreExplicit ? `gc ${formatMs(defaultGcMs)}` : `gc ${formatMs(defaultGcMs)} (assumed)`,
            textColor: 0xffffff,
            backgroundColor: 0x42b883,
          },
        ],
      },
      {
        id: QUERIES_ROOT,
        label: 'Queries',
        tags: [{ ...TAG_IDLE, label: `${subscriptions.size}` }],
        children: queryChildren,
      },
      {
        id: ENTITIES_ROOT,
        label: 'Entities',
        tags: [{ ...TAG_IDLE, label: `${runtime.mirror.entities.size}` }],
        children: entityChildren,
      },
      {
        id: MUTATIONS_ROOT,
        label: 'Mutations',
        tags: [{ ...TAG_IDLE, label: `${mutations.size}` }],
        children: mutationChildren,
      },
      {
        id: TABS_ROOT,
        label: 'Tabs',
        tags: [{ ...TAG_IDLE, label: `${tabs.size}` }],
        children: tabChildren,
      },
    ]
  }

  function buildState(nodeId: string): InspectorState | null {
    if (nodeId === ENGINE_ROOT) {
      const persisted: string[] = []
      const ephemeral: string[] = []
      if (entityDefByName !== null) {
        for (const def of entityDefByName.values()) {
          if (def.storage !== undefined) persisted.push(def.name)
          else ephemeral.push(def.name)
        }
      }
      return {
        'cache defaults': [
          { key: 'staleTime (ms)', value: defaultStaleMs },
          { key: 'gcTime (ms)', value: defaultGcMs },
          {
            key: 'source',
            value: defaultsAreExplicit
              ? 'installEngine({ defaults })'
              : 'internal default (pass { defaults } to installEngine to confirm)',
          },
        ],
        'registry': [
          { key: 'entities', value: entityDefByName !== null ? entityDefByName.size : 'loading…' },
          { key: 'queries', value: queryDefByName !== null ? queryDefByName.size : 'loading…' },
          { key: 'mutations', value: mutationDefByName !== null ? mutationDefByName.size : 'loading…' },
        ],
        'entity persistence': [
          { key: 'persisted', value: persisted.length > 0 ? persisted : '(none)' },
          { key: 'in-memory only', value: ephemeral.length > 0 ? ephemeral : '(none)' },
        ],
        'runtime': [
          { key: 'ownTabId', value: ownTabId },
          { key: 'connectedTabs', value: tabs.size },
        ],
      }
    }
    if (nodeId.startsWith(QUERY_PREFIX)) {
      const subId = nodeId.slice(QUERY_PREFIX.length)
      const entry = subscriptions.get(subId)
      if (!entry) return null
      const snap = runtime.mirror.ensureQuery(entry.subId).value
      const def = queryDefByName !== null ? queryDefByName.get(entry.defName) : undefined
      const effectiveStale = def?.staleTime ?? defaultStaleMs
      const effectiveGc = def?.gcTime ?? defaultGcMs
      const now = Date.now()
      const ageMs = now - entry.lastPatchAt
      let tags: ReadonlyArray<string> | undefined
      if (def?.tags) {
        try {
          tags = def.tags(entry.args)
        } catch {
          tags = undefined
        }
      }
      const cacheSection: Array<{ key: string; value: unknown }> = [
        {
          key: 'staleTime (ms)',
          value: def?.staleTime !== undefined ? def.staleTime : `${effectiveStale} (engine default)`,
        },
        {
          key: 'gcTime (ms)',
          value: def?.gcTime !== undefined ? def.gcTime : `${effectiveGc} (engine default)`,
        },
        { key: 'ageMs', value: ageMs },
        { key: 'isStale', value: snap.status === Status.Success && ageMs > effectiveStale },
        { key: 'tags', value: tags },
        { key: 'kind', value: def !== undefined ? (def.kind === Kind.Infinite ? 'infiniteQuery' : 'query') : 'unknown' },
      ]
      return {
        'query': [
          { key: 'defName', value: entry.defName },
          { key: 'subId', value: entry.subId },
          { key: 'status', value: statusLabel(snap.status) },
          { key: 'args', value: entry.args },
          { key: 'patches', value: entry.patches },
          { key: 'subscribedAt', value: new Date(entry.subscribedAt).toISOString() },
          { key: 'lastPatchAt', value: new Date(entry.lastPatchAt).toISOString() },
          { key: 'error', value: snap.error },
        ],
        'cache': cacheSection,
        'data': [{ key: 'data', value: snap.data }],
      }
    }
    if (nodeId.startsWith(ENTITY_TYPE_PREFIX)) {
      const type = nodeId.slice(ENTITY_TYPE_PREFIX.length)
      const bucket = runtime.mirror.entities.get(type)
      if (!bucket) return null
      const def = entityDefByName !== null ? entityDefByName.get(type) : undefined
      const items: Array<{ key: string; value: unknown }> = []
      for (const [id, value] of bucket) {
        items.push({ key: String(id), value })
      }
      const persisted = def !== undefined && def.storage !== undefined
      return {
        'collection': [
          { key: 'type', value: type },
          { key: 'count', value: bucket.size },
          { key: 'persisted', value: persisted },
          {
            key: 'storage',
            value: def === undefined
              ? 'unknown (registry not loaded)'
              : persisted
                ? 'KeyedStore configured (e.g. idbStore / memoryStore)'
                : 'in-memory only (not hydrated on reload)',
          },
        ],
        'items': items,
      }
    }
    if (nodeId.startsWith(MUTATION_PREFIX)) {
      const mutId = nodeId.slice(MUTATION_PREFIX.length)
      const entry = mutations.get(mutId)
      if (!entry) return null
      const duration = entry.finishedAt !== undefined ? entry.finishedAt - entry.startedAt : undefined
      const def = mutationDefByName !== null ? mutationDefByName.get(entry.defName) : undefined
      return {
        'mutation': [
          { key: 'defName', value: entry.defName },
          { key: 'mutId', value: entry.mutId },
          { key: 'status', value: statusLabel(entry.status) },
          { key: 'startedAt', value: new Date(entry.startedAt).toISOString() },
          { key: 'finishedAt', value: entry.finishedAt !== undefined ? new Date(entry.finishedAt).toISOString() : undefined },
          { key: 'durationMs', value: duration },
          { key: 'error', value: entry.error },
        ],
        'cache': [
          { key: 'optimistic', value: def?.optimistic !== undefined },
          { key: 'onSuccess', value: def?.onSuccess !== undefined },
          { key: 'invalidates queries', value: def?.invalidate !== undefined },
          { key: 'maxRetries', value: def?.maxRetries },
        ],
        'input': [{ key: 'input', value: entry.input }],
        'result': [{ key: 'result', value: entry.result }],
      }
    }
    if (nodeId.startsWith(TAB_PREFIX)) {
      const tabId = nodeId.slice(TAB_PREFIX.length)
      const tab = tabs.get(tabId)
      if (!tab) return null
      return {
        'tab': [
          { key: 'tabId', value: tab.tabId },
          { key: 'self', value: tab.self },
          { key: 'lastSeen', value: new Date(tab.lastSeen).toISOString() },
        ],
      }
    }
    return null
  }

  function openCrossTabChannel(_api: DevtoolsApi): void {
    if (typeof BroadcastChannel === 'undefined') return
    try {
      bc = new BroadcastChannel(BC_CHANNEL)
    } catch {
      return
    }
    bc.onmessage = (ev: MessageEvent<{ kind: string; tabId: string }>) => {
      const m = ev.data
      if (!m || typeof m.tabId !== 'string') return
      if (m.tabId === ownTabId) return
      const existed = tabs.has(m.tabId)
      tabs.set(m.tabId, { tabId: m.tabId, self: false, lastSeen: Date.now() })
      // Respond to a hello with a one-shot ping so the new tab discovers us
      // immediately. Crucially, do NOT reply with another hello — that creates
      // an exponential echo storm with 3+ tabs (hello→hello→hello…).
      if (m.kind === 'hello' && !existed) sendPing()
      if (!existed) markTree()
    }
    sendHello()
    heartbeatTimer = setInterval(() => {
      sendPing()
      const own = tabs.get(ownTabId)
      if (own) own.lastSeen = Date.now()
    }, HEARTBEAT_MS)
    reapTimer = setInterval(() => {
      const now = Date.now()
      let changed = false
      for (const [tabId, tab] of tabs) {
        if (tab.self) continue
        if (now - tab.lastSeen > TAB_TTL_MS) {
          tabs.delete(tabId)
          changed = true
        }
      }
      if (changed) markTree()
    }, HEARTBEAT_MS)
    window.addEventListener('beforeunload', closeCrossTabChannel)
  }

  function sendHello(): void {
    if (bc) bc.postMessage({ kind: 'hello', tabId: ownTabId })
  }
  function sendPing(): void {
    if (bc) bc.postMessage({ kind: 'ping', tabId: ownTabId })
  }

  function closeCrossTabChannel(): void {
    if (heartbeatTimer !== null) clearInterval(heartbeatTimer)
    if (reapTimer !== null) clearInterval(reapTimer)
    if (flushTimer !== null) clearTimeout(flushTimer)
    try {
      if (bc) bc.close()
    } catch {}
    bc = null
  }
}

function statusLabel(status: number): string {
  return STATUS_LABELS[status] ?? String(status)
}

function statusTag(status: number): { textColor: number; backgroundColor: number } {
  return STATUS_TAGS[status] ?? TAG_IDLE
}

// Single addTimelineEvent call site — keeps the IC monomorphic. Event object
// shape is identical for every call (5 keys, same order, every key always
// present), so V8 sees one hidden class.
function emitTimeline(
  api: DevtoolsApi,
  time: number,
  title: string,
  subtitle: string,
  data: unknown,
  logType: TimelineLogType,
): void {
  api.addTimelineEvent({
    layerId: LAYER_ID,
    event: { time, title, subtitle, data, logType },
  })
}

function summarizeEntityPatches(patches: ReadonlyArray<{ type: string }>): string {
  const len = patches.length
  if (len === 0) return '(empty)'
  const counts = SCRATCH_TYPE_COUNTS
  counts.clear()
  for (let i = 0; i < len; i++) {
    const t = patches[i].type
    const prev = counts.get(t)
    counts.set(t, prev === undefined ? 1 : prev + 1)
  }
  let out = ''
  let first = true
  for (const [type, count] of counts) {
    if (first) first = false
    else out += ', '
    out += type + '×' + count
  }
  return out
}

function formatMs(ms: number): string {
  if (ms < 1_000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1_000).toFixed(ms % 1_000 === 0 ? 0 : 1)}s`
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(ms % 60_000 === 0 ? 0 : 1)}m`
  return `${(ms / 3_600_000).toFixed(1)}h`
}

function shortSubId(subId: string): string {
  const sIdx = subId.indexOf('s')
  if (sIdx > 0 && sIdx < subId.length - 1) return subId.slice(sIdx)
  if (subId.length <= 12) return subId
  return subId.slice(0, 8) + '…'
}

function shortTabId(tabId: string): string {
  if (tabId.length <= 12) return tabId
  return tabId.slice(0, 8) + '…'
}

function makeTabId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'tab-' + Math.random().toString(36).slice(2, 10)
}

interface InspectorNode {
  id: string
  label: string
  tags?: Array<{ label: string; textColor: number; backgroundColor: number }>
  children?: InspectorNode[]
}

type InspectorState = Record<string, Array<{ key: string; value: unknown; editable?: boolean }>>

type DevtoolsApi = Parameters<Parameters<typeof setupDevtoolsPlugin>[1]>[0]
type DevtoolsPluginApp = Parameters<typeof setupDevtoolsPlugin>[0]['app']
