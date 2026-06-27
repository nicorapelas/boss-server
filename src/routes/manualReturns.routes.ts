import { Router, type RequestHandler } from 'express'
import { postManualReturn } from '../controllers/manualReturns.controller.js'
import { requireAdmin } from '../middleware/requireAdmin.middleware.js'

export function manualReturnsRouter(requireAuth: RequestHandler) {
  const r = Router()
  r.post('/', requireAuth, requireAdmin(), postManualReturn)
  return r
}
