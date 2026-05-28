import type { ClientMsg, ServerEndpoint, ServerMsg, Transport } from './protocol'

export function createInlineTransport(): { client: Transport; server: ServerEndpoint } {
  const clientHandlers = new Set<(m: ServerMsg) => void>()
  const serverHandlers = new Set<(m: ClientMsg) => void>()

  let toServer: ClientMsg[] | null = null
  let toClient: ServerMsg[] | null = null

  function drainToServer(): void {
    const batch = toServer!
    toServer = null
    for (let i = 0; i < batch.length; i++) for (const h of serverHandlers) h(batch[i])
  }

  function drainToClient(): void {
    const batch = toClient!
    toClient = null
    for (let i = 0; i < batch.length; i++) for (const h of clientHandlers) h(batch[i])
  }

  const client: Transport = {
    send(msg) {
      if (toServer) {
        toServer.push(msg)
        return
      }
      toServer = [msg]
      queueMicrotask(drainToServer)
    },
    onMessage(handler) {
      clientHandlers.add(handler)
      return () => clientHandlers.delete(handler)
    },
  }

  const server: ServerEndpoint = {
    receive(msg) {
      for (const h of serverHandlers) h(msg)
    },
    broadcast(msg) {
      if (toClient) {
        toClient.push(msg)
        return
      }
      toClient = [msg]
      queueMicrotask(drainToClient)
    },
    onClient(handler) {
      serverHandlers.add(handler)
      return () => serverHandlers.delete(handler)
    },
  }

  return { client, server }
}
