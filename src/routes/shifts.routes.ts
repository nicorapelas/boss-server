import { Router, type RequestHandler } from 'express'
import {
  addShiftDifference,
  closeAndStartNextShift,
  currentShift,
  getShift,
  listShifts,
  zReportPreview,
} from '../controllers/shifts.controller.js'
import { requirePermission } from '../middleware/requirePermission.middleware.js'

export function shiftsRouter(requireAuth: RequestHandler) {
  const r = Router()
  r.get('/', requireAuth, requirePermission('shifts.read'), listShifts)
  r.get('/current', requireAuth, requirePermission('shifts.manage'), currentShift)
  r.post('/z-report', requireAuth, requirePermission('shifts.manage'), zReportPreview)
  r.get('/:id', requireAuth, requirePermission('shifts.read'), getShift)
  r.post('/:id/differences', requireAuth, requirePermission('shifts.manage'), addShiftDifference)
  r.post('/:id/close-start-next', requireAuth, requirePermission('shifts.manage'), closeAndStartNextShift)
  return r
}
