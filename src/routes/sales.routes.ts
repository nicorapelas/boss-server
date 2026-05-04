import { Router, type RequestHandler } from 'express'
import { requireAnyPermission } from '../middleware/requireAnyPermission.middleware.js'
import { requirePermission } from '../middleware/requirePermission.middleware.js'
import { createSale, getSale, getSaleRefundPreview, listSales, refundSale } from '../controllers/sales.controller.js'

export function salesRouter(requireAuth: RequestHandler) {
  const r = Router()
  r.post('/', requireAuth, requirePermission('sales.create'), createSale)
  r.get('/', requireAuth, requirePermission('sales.read'), listSales)
  r.get('/:id', requireAuth, requireAnyPermission('sales.read', 'sales.refund'), getSale)
  r.get('/:id/refund-preview', requireAuth, requirePermission('sales.refund'), getSaleRefundPreview)
  r.post('/:id/refund', requireAuth, requirePermission('sales.refund'), refundSale)
  return r
}
