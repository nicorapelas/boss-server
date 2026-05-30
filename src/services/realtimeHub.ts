import type { Response } from 'express'

export type ServerEventName = 'catalog.revision'

type Connection = {
  id: string
  res: Response
}

const connections = new Map<string, Connection>()

function sseFrame(event: ServerEventName, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export function addSseConnection(id: string, res: Response) {
  connections.set(id, { id, res })
}

export function removeSseConnection(id: string) {
  connections.delete(id)
}

export function publishEvent(event: ServerEventName, data: unknown) {
  const payload = sseFrame(event, data)
  for (const c of connections.values()) {
    try {
      c.res.write(payload)
    } catch {
      // ignore broken pipes; disconnect handled by request close event
    }
  }
}

export function publishCatalogRevision(catalogRevision: number) {
  publishEvent('catalog.revision', { catalogRevision })
}

/** Best-effort keepalive to prevent proxies timing out idle SSE connections. */
export function publishKeepAlive() {
  for (const c of connections.values()) {
    try {
      c.res.write(`: keepalive ${Date.now()}\n\n`)
    } catch {
      // ignore
    }
  }
}

