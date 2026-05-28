import type { ClientMsg, ServerEndpoint, ServerMsg, Transport } from './protocol'

interface SharedWorkerLike {
  port: MessagePort
}

interface SharedWorkerScopeLike {
  onconnect: ((ev: { ports: readonly MessagePort[] }) => void) | null
}

export function createSharedWorkerClientTransport(worker: SharedWorkerLike): Transport {
  const handlers = new Set<(m: ServerMsg) => void>()
  worker.port.onmessage = (ev: MessageEvent<ServerMsg>) => {
    for (const h of handlers) h(ev.data)
  }
  worker.port.start()
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
      try {
        worker.port.close()
      } catch {}
    })
  }
  return {
    send(msg) {
      worker.port.postMessage(msg)
    },
    onMessage(handler) {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
  }
}

export function createSharedWorkerServerEndpoint(scope: SharedWorkerScopeLike): ServerEndpoint {
  const ports = new Set<MessagePort>()
  const clientHandlers = new Set<(m: ClientMsg) => void>()

  scope.onconnect = (ev) => {
    const port = ev.ports[0]
    ports.add(port)
    port.onmessage = (msg: MessageEvent<ClientMsg>) => {
      for (const h of clientHandlers) h(msg.data)
    }
    port.start()
  }

  return {
    receive(msg) {
      for (const h of clientHandlers) h(msg)
    },
    broadcast(msg) {
      let dead: MessagePort[] | null = null
      for (const port of ports) {
        try {
          port.postMessage(msg)
        } catch {
          if (dead === null) dead = [port]
          else dead.push(port)
        }
      }
      if (dead !== null) for (let i = 0; i < dead.length; i++) ports.delete(dead[i])
    },
    onClient(handler) {
      clientHandlers.add(handler)
      return () => clientHandlers.delete(handler)
    },
  }
}
