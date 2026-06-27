import { Router, type RequestHandler } from 'express'
import { requireAnyPermission } from '../middleware/requireAnyPermission.middleware.js'
import {
  getAttendanceMyStatus,
  getAttendancePending,
  getStaffShiftPerformance,
  postClockBadge,
  postClockFace,
  postClockOutSelf,
} from '../controllers/attendance.controller.js'

export function attendanceRouter(requireAuthMw: RequestHandler) {
  const r = Router()
  r.get('/pending', getAttendancePending)
  r.get(
    '/staff-shift-performance',
    requireAuthMw,
    requireAnyPermission('users.manage', 'sales.read'),
    getStaffShiftPerformance,
  )
  r.post('/clock-badge', postClockBadge)
  r.post('/clock-face', postClockFace)
  r.get('/my-status', requireAuthMw, getAttendanceMyStatus)
  r.post('/clock-out-self', requireAuthMw, postClockOutSelf)
  return r
}
