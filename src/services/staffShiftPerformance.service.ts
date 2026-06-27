import { Types } from 'mongoose'
import type { IRole } from '../models/Role.js'
import { Sale } from '../models/Sale.js'
import { SaleRefund } from '../models/SaleRefund.js'
import { ManualReturn } from '../models/ManualReturn.js'
import { StaffAttendanceSession } from '../models/StaffAttendanceSession.js'
import { ensureStoreSettingsDoc } from '../controllers/storeSettings.controller.js'
import { attendanceFromSettings } from '../utils/attendanceSettings.js'

function saleTurnoverMatch(userId: Types.ObjectId, from: Date, to: Date) {
  return {
    cashier: userId,
    createdAt: { $gte: from, $lte: to },
    $or: [{ layById: { $exists: false } }, { layById: null }],
  }
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}

function displayName(user: { displayName?: string | null; email?: string }) {
  const name = user.displayName?.trim()
  if (name) return name
  return user.email?.trim() || 'Staff'
}

export type StaffShiftPerformanceRow = {
  userId: string
  displayName: string
  roleName: string | null
  sessionId: string
  clockInAt: string
  clockInMethod: string
  tillCode: string | null
  shiftMinutes: number
  salesCount: number
  turnover: number
  cashTotal: number
  cardTotal: number
  refundCount: number
  refundTotal: number
  netTurnover: number
}

export type StaffShiftPerformanceResponse = {
  attendanceEnabled: boolean
  generatedAt: string
  staff: StaffShiftPerformanceRow[]
}

async function statsForShiftWindow(userId: Types.ObjectId, from: Date, to: Date) {
  const [salesAgg, refundsAgg, manualReturnsAgg] = await Promise.all([
    Sale.aggregate<{ count: number; turnover: number; cashTotal: number; cardTotal: number }>([
      { $match: saleTurnoverMatch(userId, from, to) },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          turnover: { $sum: '$total' },
          cashTotal: { $sum: { $ifNull: ['$payment.cashAmount', 0] } },
          cardTotal: { $sum: { $ifNull: ['$payment.cardAmount', 0] } },
        },
      },
    ]),
    SaleRefund.aggregate<{ count: number; total: number }>([
      { $match: { refundedBy: userId, createdAt: { $gte: from, $lte: to } } },
      { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$refundTotal' } } },
    ]),
    ManualReturn.aggregate<{ count: number; total: number }>([
      { $match: { processedBy: userId, createdAt: { $gte: from, $lte: to } } },
      { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$returnTotal' } } },
    ]),
  ])
  const sales = salesAgg[0] ?? { count: 0, turnover: 0, cashTotal: 0, cardTotal: 0 }
  const refunds = refundsAgg[0] ?? { count: 0, total: 0 }
  const manualReturns = manualReturnsAgg[0] ?? { count: 0, total: 0 }
  const refundCount = refunds.count + manualReturns.count
  const refundTotal = round2(refunds.total + manualReturns.total)
  return {
    salesCount: sales.count,
    turnover: round2(sales.turnover),
    cashTotal: round2(sales.cashTotal),
    cardTotal: round2(sales.cardTotal),
    refundCount,
    refundTotal,
    netTurnover: round2(Math.max(0, sales.turnover - refundTotal)),
  }
}

export async function buildStaffShiftPerformanceBoard(): Promise<StaffShiftPerformanceResponse> {
  const generatedAt = new Date().toISOString()
  const settings = await ensureStoreSettingsDoc()
  const attendance = attendanceFromSettings(settings as Parameters<typeof attendanceFromSettings>[0])
  if (!attendance.enabled) {
    return { attendanceEnabled: false, generatedAt, staff: [] }
  }

  const openSessions = await StaffAttendanceSession.find({ status: 'open' })
    .populate({
      path: 'userId',
      select: 'displayName email roleId',
      populate: { path: 'roleId', select: 'name slug' },
    })
    .sort({ clockInAt: 1 })
    .lean()

  const to = new Date()
  const staff: StaffShiftPerformanceRow[] = []

  for (const session of openSessions) {
    const userRaw = session.userId as
      | Types.ObjectId
      | {
          _id: Types.ObjectId
          displayName?: string | null
          email?: string
          roleId?: IRole | null
        }
      | null
    if (!userRaw || userRaw instanceof Types.ObjectId) continue
    const userId =
      userRaw._id instanceof Types.ObjectId ? userRaw._id : new Types.ObjectId(String(userRaw._id))
    const clockInAt = session.clockInAt instanceof Date ? session.clockInAt : new Date(session.clockInAt)
    const shiftMinutes = Math.max(0, Math.round((to.getTime() - clockInAt.getTime()) / 60_000))
    const role = userRaw.roleId
    const roleName =
      role && typeof role === 'object' && 'name' in role && typeof role.name === 'string' ? role.name : null
    const stats = await statsForShiftWindow(userId, clockInAt, to)
    staff.push({
      userId: String(userId),
      displayName: displayName(userRaw),
      roleName,
      sessionId: String(session._id),
      clockInAt: clockInAt.toISOString(),
      clockInMethod: session.clockInMethod,
      tillCode: session.tillCode ?? null,
      shiftMinutes,
      ...stats,
    })
  }

  staff.sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }))
  return { attendanceEnabled: true, generatedAt, staff }
}
