import { EventEmitter } from 'node:events'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { configWatchPlugin, featuresRuntimePlugin } from '../src/dev'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = (p: string) => resolve(here, 'fixtures', p)

function mockServer() {
  const watcher = new EventEmitter() as EventEmitter & { add: (paths: string[]) => void }
  watcher.add = vi.fn()
  const restart = vi.fn()
  const server = { watcher, restart, config: { logger: { info: vi.fn() } } }
  return { server, watcher, restart }
}

const callConfigureServer = (plugin: { configureServer?: unknown }, server: unknown) =>
  (plugin.configureServer as (s: unknown) => void)(server)

describe('configWatchPlugin', () => {
  it('applies only in serve mode', () => {
    expect(configWatchPlugin([]).apply).toBe('serve')
  })

  it('watches layer config files and restarts on change', () => {
    const plugin = configWatchPlugin([fixture('stack/app'), fixture('stack/base')])
    const { server, watcher, restart } = mockServer()
    callConfigureServer(plugin, server)
    expect(watcher.add).toHaveBeenCalled()
    watcher.emit('change', resolve(fixture('stack/base'), 'app.config.ts'))
    expect(restart).toHaveBeenCalledTimes(1)
  })

  it('ignores unrelated file changes', () => {
    const plugin = configWatchPlugin([fixture('stack/app')])
    const { server, watcher, restart } = mockServer()
    callConfigureServer(plugin, server)
    watcher.emit('change', resolve(fixture('stack/app'), 'src', 'whatever.ts'))
    expect(restart).not.toHaveBeenCalled()
  })
})

const runTransform = (
  plugin: { transform?: unknown },
  code: string,
  id = '/app/src/x.ts',
): { code: unknown; map?: unknown } | null => {
  const t = plugin.transform as
    | ((this: unknown, c: string, i: string) => { code: unknown; map?: unknown } | null)
    | undefined
  return t ? t.call({}, code, id) : null
}

describe('featuresRuntimePlugin', () => {
  it('applies only in serve mode', () => {
    expect(featuresRuntimePlugin({}).apply).toBe('serve')
  })

  it('prepends a module-local __FEATURES__ with a rolldown-generated sourcemap', () => {
    const out = runTransform(featuresRuntimePlugin({ billing: true }), 'export const x = __FEATURES__.billing')
    const code = String(out?.code)
    expect(code).toContain('const __FEATURES__={"billing":true};')
    expect(code).toContain('export const x = __FEATURES__.billing')
    expect((out?.map as { mappings?: string })?.mappings).toBeTruthy() // real sourcemap
  })

  it('ignores property access (_ctx.__FEATURES__) and node_modules', () => {
    const p = featuresRuntimePlugin({ billing: true })
    expect(runTransform(p, 'const a = _ctx.__FEATURES__.billing')).toBeNull()
    expect(runTransform(p, 'export const x = __FEATURES__.billing', '/x/node_modules/y.js')).toBeNull()
  })
})
