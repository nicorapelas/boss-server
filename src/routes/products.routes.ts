import { Router, type RequestHandler } from 'express'
import {
  createProduct,
  deleteProduct,
  getProduct,
  listProducts,
  updateProduct,
} from '../controllers/products.controller.js'

export function productsRouter(requireAuth: RequestHandler, requireAdmin: RequestHandler) {
  const r = Router()
  r.get('/', requireAuth, listProducts)
  r.get('/:id', requireAuth, getProduct)
  r.post('/', requireAuth, requireAdmin, createProduct)
  r.patch('/:id', requireAuth, requireAdmin, updateProduct)
  r.delete('/:id', requireAuth, requireAdmin, deleteProduct)
  return r
}
