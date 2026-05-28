import { describe, expect, it } from 'vitest'
import { createInlineTransport } from '../transport/InlineTransport'
import {
  createSharedWorkerClientTransport,
  createSharedWorkerServerEndpoint,
} from '../transport/SharedWorkerTransport'
import { Msg, Status } from '../core/flags'
import type { ClientMsg, ServerMsg } from '../transport/protocol'

describe('InlineTransport', () => {
  it('client.send → server.onClient delivers asynchronously', async () => {
    const { client, server } = createInlineTransport()
    const received: ClientMsg[] = []
    server.onClient((m) => received.push(m))
    client.send({ type: Msg.Subscribe, subId: 's1', defName: 'q', args: {} })
    client.send({ type: Msg.Unsubscribe, subId: 's1' })
    expect(received.length).toBe(0)
    await Promise.resolve()
    await Promise.resolve()
    expect(received.length).toBe(2)
  })

  it('server.broadcast → client.onMessage delivers asynchronously', async () => {
    const { client, server } = createInlineTransport()
    const received: ServerMsg[] = []
    client.onMessage((m) => received.push(m))
    server.broadcast({ type: Msg.QueryPatch, subId: 's1', status: Status.Pending })
    server.broadcast({ type: Msg.MutateResult, mutId: 'm1', ok: true, data: 1 })
    await Promise.resolve()
    await Promise.resolve()
    expect(received.length).toBe(2)
  })

  it('server.receive delivers synchronously', () => {
    const { server } = createInlineTransport()
    const received: ClientMsg[] = []
    server.onClient((m) => received.push(m))
    server.receive({ type: Msg.Unsubscribe, subId: 's2' })
    expect(received).toEqual([{ type: Msg.Unsubscribe, subId: 's2' }])
  })

  it('unsubscribe returned from onMessage/onClient removes handler', async () => {
    const { client, server } = createInlineTransport()
    const fromClient: ServerMsg[] = []
    const fromServer: ClientMsg[] = []
    const offC = client.onMessage((m) => fromClient.push(m))
    const offS = server.onClient((m) => fromServer.push(m))

    server.broadcast({ type: Msg.QueryPatch, subId: 'x', status: Status.Idle })
    client.send({ type: Msg.Unsubscribe, subId: 'x' })
    await Promise.resolve()
    await Promise.resolve()
    expect(fromClient.length).toBe(1)
    expect(fromServer.length).toBe(1)

    offC()
    offS()
    server.broadcast({ type: Msg.QueryPatch, subId: 'y', status: Status.Idle })
    client.send({ type: Msg.Unsubscribe, subId: 'y' })
    await Promise.resolve()
    await Promise.resolve()
    expect(fromClient.length).toBe(1)
    expect(fromServer.length).toBe(1)
  })

  it('batches multiple sends into a single microtask drain', async () => {
    const { client, server } = createInlineTransport()
    const received: ClientMsg[] = []
    server.onClient((m) => received.push(m))
    for (let i = 0; i < 5; i++) {
      client.send({ type: Msg.Unsubscribe, subId: `s${i}` })
    }
    await Promise.resolve()
    await Promise.resolve()
    expect(received.length).toBe(5)
  })
})

describe('SharedWorkerTransport (via MessageChannel)', () => {
  function makeChannel() {
    const ch = new MessageChannel()
    // The client treats SharedWorker.port as a MessagePort.
    const client = createSharedWorkerClientTransport({ port: ch.port1 })
    // The server treats SharedWorkerScope and gets ports via onconnect.
    const scope = { onconnect: null as null | ((ev: { ports: readonly MessagePort[] }) => void) }
    const server = createSharedWorkerServerEndpoint(scope)
    scope.onconnect!({ ports: [ch.port2] })
    return { client, server, ch }
  }

  it('forwards client.send to server handlers', async () => {
    const { client, server } = makeChannel()
    const received: ClientMsg[] = []
    server.onClient((m) => received.push(m))
    client.send({ type: Msg.Subscribe, subId: 's1', defName: 'q', args: { k: 1 } })
    await new Promise((r) => setTimeout(r, 0))
    expect(received).toEqual([{ type: Msg.Subscribe, subId: 's1', defName: 'q', args: { k: 1 } }])
  })

  it('forwards server.broadcast to all connected clients', async () => {
    const ch1 = new MessageChannel()
    const ch2 = new MessageChannel()
    const c1 = createSharedWorkerClientTransport({ port: ch1.port1 })
    const c2 = createSharedWorkerClientTransport({ port: ch2.port1 })
    const scope = { onconnect: null as null | ((ev: { ports: readonly MessagePort[] }) => void) }
    const server = createSharedWorkerServerEndpoint(scope)
    scope.onconnect!({ ports: [ch1.port2] })
    scope.onconnect!({ ports: [ch2.port2] })

    const got1: ServerMsg[] = []
    const got2: ServerMsg[] = []
    c1.onMessage((m) => got1.push(m))
    c2.onMessage((m) => got2.push(m))

    server.broadcast({ type: Msg.QueryPatch, subId: 's', status: Status.Success })
    await new Promise((r) => setTimeout(r, 0))
    expect(got1.length).toBe(1)
    expect(got2.length).toBe(1)
  })

  it('server.receive dispatches synchronously to all client handlers', () => {
    const { server } = makeChannel()
    const got: ClientMsg[] = []
    server.onClient((m) => got.push(m))
    server.receive({ type: Msg.Unsubscribe, subId: 'x' })
    expect(got).toEqual([{ type: Msg.Unsubscribe, subId: 'x' }])
  })

  it('drops dead ports from broadcast without throwing', async () => {
    const { server, ch } = makeChannel()
    ch.port2.close()
    // Force postMessage to fail on subsequent broadcast — most engines accept
    // close() and either ignore postMessage or throw. Either way, broadcast
    // should not crash.
    expect(() =>
      server.broadcast({ type: Msg.QueryPatch, subId: 's', status: Status.Idle }),
    ).not.toThrow()
  })

  it('onClient unsubscribe removes handler', async () => {
    const { client, server } = makeChannel()
    const got: ClientMsg[] = []
    const off = server.onClient((m) => got.push(m))
    client.send({ type: Msg.Unsubscribe, subId: 'a' })
    await new Promise((r) => setTimeout(r, 0))
    expect(got.length).toBe(1)
    off()
    client.send({ type: Msg.Unsubscribe, subId: 'b' })
    await new Promise((r) => setTimeout(r, 0))
    expect(got.length).toBe(1)
  })

  it('client.onMessage unsubscribe removes handler', async () => {
    const { client, server } = makeChannel()
    const got: ServerMsg[] = []
    const off = client.onMessage((m) => got.push(m))
    server.broadcast({ type: Msg.QueryPatch, subId: 's', status: Status.Idle })
    await new Promise((r) => setTimeout(r, 0))
    expect(got.length).toBe(1)
    off()
    server.broadcast({ type: Msg.QueryPatch, subId: 's', status: Status.Pending })
    await new Promise((r) => setTimeout(r, 0))
    expect(got.length).toBe(1)
  })
})
