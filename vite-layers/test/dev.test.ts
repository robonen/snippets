import { EventEmitter } from 'node:events'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { configWatchPlugin } from '../src/dev'

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

  it('restarts when a config is newly added to a layer that had none', () => {
    const plugin = configWatchPlugin([fixture('stack/app')])
    const { server, watcher, restart } = mockServer()
    callConfigureServer(plugin, server)
    // app.config.js does not exist at startup, but it is a candidate path → `add` must restart.
    watcher.emit('add', resolve(fixture('stack/app'), 'app.config.js'))
    expect(restart).toHaveBeenCalledTimes(1)
  })
})
