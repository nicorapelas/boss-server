import { Router, type RequestHandler } from 'express'
import {
  fixNegativeStockToZero,
  migrationAudit,
} from '../controllers/migration.controller.js'

export function migrationRouter(requireAuth: RequestHandler, requireAdmin: RequestHandler) {
  const r = Router()
  r.get('/audit', requireAuth, requireAdmin, migrationAudit)
  r.post('/fix-negative-stock-zero', requireAuth, requireAdmin, fixNegativeStockToZero)
  return r
}

