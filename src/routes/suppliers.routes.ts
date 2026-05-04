import { Router, type RequestHandler } from 'express'
import { requirePermission } from '../middleware/requirePermission.middleware.js'
import {
  createSupplier,
  createSupplierOffer,
  deleteSupplier,
  deleteSupplierOffer,
  getSupplier,
  listOffersForProduct,
  listOffersForSupplier,
  listSuppliers,
  updateSupplier,
  updateSupplierOffer,
} from '../controllers/suppliers.controller.js'

export function suppliersRouter(requireAuth: RequestHandler) {
  const r = Router()
  r.get(
    '/offers/by-product',
    requireAuth,
    requirePermission('suppliers.read'),
    listOffersForProduct,
  )
  r.get('/', requireAuth, requirePermission('suppliers.read'), listSuppliers)
  r.post('/', requireAuth, requirePermission('suppliers.write'), createSupplier)
  r.get('/:supplierId/offers', requireAuth, requirePermission('suppliers.read'), listOffersForSupplier)
  r.post('/:supplierId/offers', requireAuth, requirePermission('suppliers.write'), createSupplierOffer)
  r.get('/:id', requireAuth, requirePermission('suppliers.read'), getSupplier)
  r.patch('/:id', requireAuth, requirePermission('suppliers.write'), updateSupplier)
  r.delete('/:id', requireAuth, requirePermission('suppliers.write'), deleteSupplier)
  return r
}

export function supplierOffersRouter(requireAuth: RequestHandler) {
  const r = Router()
  r.patch('/:id', requireAuth, requirePermission('suppliers.write'), updateSupplierOffer)
  r.delete('/:id', requireAuth, requirePermission('suppliers.write'), deleteSupplierOffer)
  return r
}
