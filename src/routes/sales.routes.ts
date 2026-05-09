import { Router, type RequestHandler } from 'express'
import { requireAnyPermission } from '../middleware/requireAnyPermission.middleware.js'
import { requirePermission } from '../middleware/requirePermission.middleware.js'
import {
  createSale,
  getSale,
  getSaleRefundPreview,
  listOfflineSyncConflicts,
  listOfflineSyncRetryRequests,
  listSales,
  refundSale,
  requestOfflineSyncConflictRetry,
  reportOfflineSyncConflict,
  resolveOfflineSyncConflict,
  resolveOfflineSyncConflictByClientLocalId,
} from '../controllers/sales.controller.js'

export function salesRouter(requireAuth: RequestHandler) {
  const r = Router()
  r.post('/', requireAuth, requirePermission('sales.create'), createSale)
  r.get('/', requireAuth, requirePermission('sales.read'), listSales)
  r.post('/offline-conflicts', requireAuth, requirePermission('sales.create'), reportOfflineSyncConflict)
  r.get('/offline-conflicts', requireAuth, requirePermission('sales.read'), listOfflineSyncConflicts)
  r.get('/offline-conflicts/retry-requests', requireAuth, requirePermission('sales.create'), listOfflineSyncRetryRequests)
  r.post('/offline-conflicts/:id/retry-request', requireAuth, requirePermission('sales.read'), requestOfflineSyncConflictRetry)
  r.post('/offline-conflicts/:id/resolve', requireAuth, requirePermission('sales.read'), resolveOfflineSyncConflict)
  r.post(
    '/offline-conflicts/by-client/:clientLocalId/resolve',
    requireAuth,
    requirePermission('sales.create'),
    resolveOfflineSyncConflictByClientLocalId,
  )
  r.get('/:id', requireAuth, requireAnyPermission('sales.read', 'sales.refund'), getSale)
  r.get('/:id/refund-preview', requireAuth, requirePermission('sales.refund'), getSaleRefundPreview)
  r.post('/:id/refund', requireAuth, requirePermission('sales.refund'), refundSale)
  return r
}
