import { Router, type RequestHandler } from 'express'
import { requirePermission } from '../middleware/requirePermission.middleware.js'
import {
  addLayByPayment,
  cancelLayBy,
  completeLayBy,
  createLayBy,
  getLayBy,
  listActiveLayBys,
  listLayBysForAdmin,
} from '../controllers/layby.controller.js'

export function laybyRouter(requireAuth: RequestHandler) {
  const r = Router()
  r.get('/active', requireAuth, requirePermission('laybys.use'), listActiveLayBys)
  r.get('/', requireAuth, requirePermission('laybys.admin'), listLayBysForAdmin)
  r.post('/', requireAuth, requirePermission('laybys.use'), createLayBy)
  r.get('/:id', requireAuth, requirePermission('laybys.use'), getLayBy)
  r.post('/:id/payments', requireAuth, requirePermission('laybys.use'), addLayByPayment)
  r.post('/:id/complete', requireAuth, requirePermission('laybys.use'), completeLayBy)
  r.post('/:id/cancel', requireAuth, requirePermission('laybys.admin'), cancelLayBy)
  return r
}
