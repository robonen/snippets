import type { Plugin } from 'vite'

const VIRTUAL_ID = 'virtual:sync-engine-registry'
const RESOLVED_ID = '\0' + VIRTUAL_ID

export interface SyncEnginePluginOptions {
  definitions: string | readonly string[]
}

export function syncEnginePlugin(opts: SyncEnginePluginOptions): Plugin {
  const patterns = Array.isArray(opts.definitions) ? opts.definitions : [opts.definitions]
  return {
    name: 'vue-sync-engine:registry',
    enforce: 'pre',
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID
      return null
    },
    load(id) {
      if (id !== RESOLVED_ID) return null
      const globs = patterns.map((p) => JSON.stringify(p)).join(', ')
      return `
const KIND_ENTITY = 1
const KIND_QUERY = 2
const KIND_INFINITE = 3
const KIND_MUTATION = 4
const modules = import.meta.glob([${globs}], { eager: true })
const entities = []
const queries = []
const mutations = []
const seenEntities = new Set()
const seenQueries = new Set()
const seenMutations = new Set()
for (const path in modules) {
  const mod = modules[path]
  for (const key in mod) {
    const v = mod[key]
    if (!v || typeof v !== 'object') continue
    const k = v.kind
    if (k === KIND_QUERY || k === KIND_INFINITE) {
      if (typeof v.name !== 'string' || seenQueries.has(v.name)) continue
      seenQueries.add(v.name)
      queries.push(v)
    } else if (k === KIND_MUTATION) {
      if (typeof v.name !== 'string' || seenMutations.has(v.name)) continue
      seenMutations.add(v.name)
      mutations.push(v)
    } else if (k === KIND_ENTITY) {
      if (typeof v.name !== 'string' || seenEntities.has(v.name)) continue
      seenEntities.add(v.name)
      entities.push(v)
    }
  }
}
export default { entities, queries, mutations }
`
    },
  }
}
