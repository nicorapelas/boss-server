import { Router, type RequestHandler } from 'express'
import { requirePermission } from '../middleware/requirePermission.middleware.js'
import {
  createProduct,
  deleteProduct,
  getProduct,
  listProducts,
  updateProduct,
} from '../controllers/products.controller.js'

export function productsRouter(requireAuth: RequestHandler) {
  const r = Router()
  r.get('/', requireAuth, requirePermission('catalog.read'), listProducts)
  r.get('/:id', requireAuth, requirePermission('catalog.read'), getProduct)
  r.post('/', requireAuth, requirePermission('catalog.write'), createProduct)
  r.patch('/:id', requireAuth, requirePermission('catalog.write'), updateProduct)
  r.delete('/:id', requireAuth, requirePermission('catalog.write'), deleteProduct)
  return r
}
