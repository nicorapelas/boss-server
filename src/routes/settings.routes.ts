import { Router, type RequestHandler } from 'express'
import { getStoreSettings, updateStoreSettings } from '../controllers/storeSettings.controller.js'

export function settingsRouter(requireAuth: RequestHandler, requireAdmin: RequestHandler) {
  const r = Router()
  r.get('/store', requireAuth, getStoreSettings)
  r.patch('/store', requireAdmin, updateStoreSettings)
  return r
}
