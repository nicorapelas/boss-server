import { Router, type RequestHandler } from 'express'
import { requirePermission } from '../middleware/requirePermission.middleware.js'
import { financialsSummary } from '../controllers/financials.controller.js'

export function financialsRouter(requireAuth: RequestHandler) {
  const r = Router()
  r.get('/summary', requireAuth, requirePermission('financials.read'), financialsSummary)
  return r
}
