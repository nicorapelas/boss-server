import { Router, type RequestHandler } from 'express'
import {
  heartbeatTerminal,
  listTerminals,
  updateTerminal,
} from '../controllers/terminals.controller.js'
import { requirePermission } from '../middleware/requirePermission.middleware.js'

export function terminalsRouter(requireAuth: RequestHandler) {
  const r = Router()
  r.post('/heartbeat', requireAuth, requirePermission('sales.create'), heartbeatTerminal)
  r.get('/', requireAuth, requirePermission('settings.read'), listTerminals)
  r.patch('/:tillCode', requireAuth, requirePermission('settings.write'), updateTerminal)
  return r
}
