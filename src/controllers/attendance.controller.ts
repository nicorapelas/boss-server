import type { NextFunction, Request, Response } from 'express'
import {
  AttendanceError,
  clockByBadge,
  clockByFace,
  clockOutSelf,
  getMyAttendanceStatus,
  getPendingClockInStaff,
} from '../services/attendance.service.js'
import { buildStaffShiftPerformanceBoard } from '../services/staffShiftPerformance.service.js'

export async function postClockBadge(req: Request, res: Response, next: NextFunction) {
  try {
    const { badgeCode, tillCode } = req.body as { badgeCode?: string; tillCode?: string }
    if (!badgeCode?.trim()) {
      res.status(400).json({ message: 'badgeCode required' })
      return
    }
    const result = await clockByBadge(badgeCode, tillCode ?? null)
    res.json(result)
  } catch (e) {
    if (e instanceof AttendanceError) {
      res.status(e.status).json({ message: e.message })
      return
    }
    next(e)
  }
}

export async function postClockFace(req: Request, res: Response, next: NextFunction) {
  try {
    const { embedding, tillCode } = req.body as { embedding?: unknown; tillCode?: string }
    if (!embedding) {
      res.status(400).json({ message: 'embedding required' })
      return
    }
    const result = await clockByFace(embedding, tillCode ?? null)
    res.json(result)
  } catch (e) {
    if (e instanceof AttendanceError) {
      res.status(e.status).json({ message: e.message })
      return
    }
    next(e)
  }
}

export async function getAttendanceMyStatus(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user?.id) {
      res.status(401).json({ message: 'Unauthorized' })
      return
    }
    const status = await getMyAttendanceStatus(req.user.id)
    res.json(status)
  } catch (e) {
    next(e)
  }
}

export async function getAttendancePending(_req: Request, res: Response, next: NextFunction) {
  try {
    const result = await getPendingClockInStaff()
    res.json(result)
  } catch (e) {
    if (e instanceof AttendanceError) {
      res.status(e.status).json({ message: e.message })
      return
    }
    next(e)
  }
}

export async function getStaffShiftPerformance(_req: Request, res: Response, next: NextFunction) {
  try {
    const board = await buildStaffShiftPerformanceBoard()
    res.json(board)
  } catch (e) {
    next(e)
  }
}

export async function postClockOutSelf(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user?.id) {
      res.status(401).json({ message: 'Unauthorized' })
      return
    }
    const result = await clockOutSelf(req.user.id)
    res.json(result)
  } catch (e) {
    if (e instanceof AttendanceError) {
      res.status(e.status).json({ message: e.message })
      return
    }
    next(e)
  }
}
