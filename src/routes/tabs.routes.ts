import { Router, type RequestHandler } from 'express'
import { requirePermission } from '../middleware/requirePermission.middleware.js'
import {
  createOpenTab,
  getOpenTab,
  listOpenTabs,
  updateOpenTabLines,
  voidOpenTab,
} from '../controllers/tabs.controller.js'

export function tabsRouter(requireAuth: RequestHandler) {
  const r = Router()
  r.get('/open', requireAuth, requirePermission('tabs.use'), listOpenTabs)
  r.post('/', requireAuth, requirePermission('tabs.use'), createOpenTab)
  r.get('/:id', requireAuth, requirePermission('tabs.use'), getOpenTab)
  r.put('/:id/lines', requireAuth, requirePermission('tabs.use'), updateOpenTabLines)
  r.delete('/:id', requireAuth, requirePermission('tabs.use'), voidOpenTab)
  return r
}
