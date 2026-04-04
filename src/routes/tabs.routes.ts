import { Router, type RequestHandler } from 'express'
import {
  createOpenTab,
  getOpenTab,
  listOpenTabs,
  updateOpenTabLines,
  voidOpenTab,
} from '../controllers/tabs.controller.js'

export function tabsRouter(requireAuth: RequestHandler) {
  const r = Router()
  r.get('/open', requireAuth, listOpenTabs)
  r.post('/', requireAuth, createOpenTab)
  r.get('/:id', requireAuth, getOpenTab)
  r.put('/:id/lines', requireAuth, updateOpenTabLines)
  r.delete('/:id', requireAuth, voidOpenTab)
  return r
}
