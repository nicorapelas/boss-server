import { Router, type RequestHandler } from 'express'
import { requirePermission } from '../middleware/requirePermission.middleware.js'
import { getProductPresets, putProductPresets } from '../controllers/productPresets.controller.js'
import {
  getCatalogSync,
  getStoreSettings,
  pushCatalogToTills,
  updateStoreSettings,
} from '../controllers/storeSettings.controller.js'

export function settingsRouter(requireAuth: RequestHandler) {
  const r = Router()
  r.get('/store', requireAuth, requirePermission('settings.read'), getStoreSettings)
  r.patch('/store', requireAuth, requirePermission('settings.write'), updateStoreSettings)
  r.get('/catalog-sync', requireAuth, requirePermission('catalog.read'), getCatalogSync)
  r.post('/catalog-push', requireAuth, requirePermission('catalog.write'), pushCatalogToTills)
  r.get('/product-presets', requireAuth, requirePermission('presets.read'), getProductPresets)
  r.put('/product-presets', requireAuth, requirePermission('presets.write'), putProductPresets)
  return r
}
