import { Router, type RequestHandler } from 'express'
import { requirePermission } from '../middleware/requirePermission.middleware.js'
import { sseEvents } from '../controllers/events.controller.js'

export function eventsRouter(requireAuth: RequestHandler) {
  const r = Router()
  r.get('/', requireAuth, requirePermission('catalog.read'), sseEvents)
  return r
}

