import { Router, type RequestHandler } from 'express'
import { getProductPresets, putProductPresets } from '../controllers/productPresets.controller.js'
import { getStoreSettings, updateStoreSettings } from '../controllers/storeSettings.controller.js'

export function settingsRouter(requireAuth: RequestHandler, requireAdmin: RequestHandler) {
  const r = Router()
  r.get('/store', requireAuth, getStoreSettings)
  r.patch('/store', requireAdmin, updateStoreSettings)
  r.get('/product-presets', requireAuth, getProductPresets)
  r.put('/product-presets', requireAuth, putProductPresets)
  return r
}
