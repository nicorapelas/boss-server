import { Router, type RequestHandler } from 'express'
import {
  claimShopAssistCart,
  createShopAssistCart,
} from '../controllers/shopAssistCarts.controller.js'
import { requirePermission } from '../middleware/requirePermission.middleware.js'

export function shopAssistCartsRouter(requireAuth: RequestHandler) {
  const r = Router()
  r.post('/', requireAuth, requirePermission('catalog.read'), createShopAssistCart)
  r.post('/claim', requireAuth, requirePermission('sales.create'), claimShopAssistCart)
  return r
}
