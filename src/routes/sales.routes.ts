import { Router, type RequestHandler } from 'express'
import { createSale, listSales } from '../controllers/sales.controller.js'

export function salesRouter(requireAuth: RequestHandler, requireAdmin: RequestHandler) {
  const r = Router()
  r.post('/', requireAuth, createSale)
  r.get('/', requireAuth, requireAdmin, listSales)
  return r
}
