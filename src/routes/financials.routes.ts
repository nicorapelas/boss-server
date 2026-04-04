import { Router, type RequestHandler } from 'express'
import { financialsSummary } from '../controllers/financials.controller.js'

export function financialsRouter(requireAuth: RequestHandler, requireAdmin: RequestHandler) {
  const r = Router()
  r.get('/summary', requireAuth, requireAdmin, financialsSummary)
  return r
}

