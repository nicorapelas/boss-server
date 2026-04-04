import { Router, type RequestHandler } from 'express'
import {
  addLayByPayment,
  cancelLayBy,
  completeLayBy,
  createLayBy,
  getLayBy,
  getStoreCreditBalance,
  listActiveLayBys,
  listLayBysForAdmin,
} from '../controllers/layby.controller.js'

export function laybyRouter(requireAuth: RequestHandler, requireAdmin: RequestHandler) {
  const r = Router()
  r.get('/credit-balance', requireAuth, getStoreCreditBalance)
  r.get('/active', requireAuth, listActiveLayBys)
  r.get('/', requireAuth, requireAdmin, listLayBysForAdmin)
  r.post('/', requireAuth, createLayBy)
  r.get('/:id', requireAuth, getLayBy)
  r.post('/:id/payments', requireAuth, addLayByPayment)
  r.post('/:id/complete', requireAuth, completeLayBy)
  r.post('/:id/cancel', requireAuth, requireAdmin, cancelLayBy)
  return r
}
