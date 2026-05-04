import { Router, type RequestHandler } from 'express'
import { requirePermission } from '../middleware/requirePermission.middleware.js'
import { fixNegativeStockToZero, migrationAudit } from '../controllers/migration.controller.js'

export function migrationRouter(requireAuth: RequestHandler) {
  const r = Router()
  r.get('/audit', requireAuth, requirePermission('migration.access'), migrationAudit)
  r.post('/fix-negative-stock-zero', requireAuth, requirePermission('migration.access'), fixNegativeStockToZero)
  return r
}
