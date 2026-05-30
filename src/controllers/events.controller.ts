import type { NextFunction, Request, Response } from 'express'
import { StoreSettings } from '../models/StoreSettings.js'
import { addSseConnection, publishKeepAlive, removeSseConnection } from '../services/realtimeHub.js'

const KEEPALIVE_MS = 25_000

function randomId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export async function sseEvents(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200)
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')

    // Send headers immediately.
    res.flushHeaders?.()

    const id = randomId()
    addSseConnection(id, res)

    // Send current baseline revision so clients can establish a baseline immediately.
    try {
      const doc = await StoreSettings.findById('default').select('catalogRevision').lean()
      const rev = typeof doc?.catalogRevision === 'number' ? doc.catalogRevision : 0
      res.write(`event: catalog.revision\ndata: ${JSON.stringify({ catalogRevision: rev })}\n\n`)
    } catch {
      // Non-blocking
    }

    const timer = setInterval(() => publishKeepAlive(), KEEPALIVE_MS)

    req.on('close', () => {
      clearInterval(timer)
      removeSseConnection(id)
      try {
        res.end()
      } catch {
        // ignore
      }
    })
  } catch (e) {
    next(e)
  }
}

