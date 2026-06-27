import { Types } from 'mongoose'
import { Sale } from '../models/Sale.js'
import { SaleRefund } from '../models/SaleRefund.js'
import { StaffAttendanceSession } from '../models/StaffAttendanceSession.js'

const MAX_DAYS = 366
const DEFAULT_DAYS = 30

function clampDays(days: unknown): number {
  const n = Number(days)
  if (!Number.isFinite(n) || n < 1) return DEFAULT_DAYS
  return Math.min(MAX_DAYS, Math.floor(n))
}

function saleTurnoverMatch(userId: Types.ObjectId, from: Date, to: Date) {
  return {
    cashier: userId,
    createdAt: { $gte: from, $lte: to },
    $or: [{ layById: { $exists: false } }, { layById: null }],
  }
}

function sessionMinutesInPeriod(
  clockInAt: Date,
  clockOutAt: Date | null | undefined,
  status: string,
  from: Date,
  to: Date,
): number {
  const start = clockInAt.getTime()
  const endRaw =
    clockOutAt instanceof Date ? clockOutAt.getTime() : status === 'open' ? Date.now() : start
  const windowStart = Math.max(start, from.getTime())
  const windowEnd = Math.min(endRaw, to.getTime())
  if (windowEnd <= windowStart) return 0
  return Math.round((windowEnd - windowStart) / 60_000)
}

export async function buildUserPerformance(userId: string, daysInput?: unknown) {
  if (!Types.ObjectId.isValid(userId)) {
    throw new Error('Invalid user id')
  }
  const userOid = new Types.ObjectId(userId)
  const days = clampDays(daysInput)
  const to = new Date()
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000)

  const [salesAgg, refundsAgg, sessions, openSession] = await Promise.all([
    Sale.aggregate<{ count: number; turnover: number; cashTotal: number; cardTotal: number }>([
      { $match: saleTurnoverMatch(userOid, from, to) },
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
      { $match: { refundedBy: userOid, createdAt: { $gte: from, $lte: to } } },
      { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$refundTotal' } } },
    ]),
    StaffAttendanceSession.find({
      userId: userOid,
      $or: [{ clockInAt: { $gte: from, $lte: to } }, { status: 'open' }],
    })
      .sort({ clockInAt: -1 })
      .limit(25)
      .lean(),
    StaffAttendanceSession.findOne({ userId: userOid, status: 'open' }).lean(),
  ])

  const sales = salesAgg[0] ?? { count: 0, turnover: 0, cashTotal: 0, cardTotal: 0 }
  const refunds = refundsAgg[0] ?? { count: 0, total: 0 }

  let totalMinutes = 0
  const recentSessions = sessions.map((s) => {
    const clockInAt = s.clockInAt instanceof Date ? s.clockInAt : new Date(s.clockInAt)
    const clockOutAt =
      s.clockOutAt instanceof Date ? s.clockOutAt : s.clockOutAt ? new Date(s.clockOutAt) : null
    const durationMinutes = sessionMinutesInPeriod(clockInAt, clockOutAt, s.status, from, to)
    totalMinutes += durationMinutes
    return {
      id: String(s._id),
      status: s.status as 'open' | 'closed',
      clockInAt: clockInAt.toISOString(),
      clockOutAt: clockOutAt ? clockOutAt.toISOString() : null,
      clockInMethod: s.clockInMethod,
      clockOutMethod: s.clockOutMethod ?? null,
      tillCode: s.tillCode ?? null,
      durationMinutes,
    }
  })

  const openSince =
    openSession?.clockInAt instanceof Date
      ? openSession.clockInAt.toISOString()
      : openSession?.clockInAt
        ? String(openSession.clockInAt)
        : null

  return {
    period: { days, from: from.toISOString(), to: to.toISOString() },
    sales: {
      count: sales.count,
      turnover: sales.turnover,
      cashTotal: sales.cashTotal,
      cardTotal: sales.cardTotal,
      netTurnover: Math.max(0, sales.turnover - refunds.total),
    },
    refunds: {
      count: refunds.count,
      total: refunds.total,
    },
    attendance: {
      currentlyClockedIn: Boolean(openSession),
      openSince,
      sessionCount: recentSessions.length,
      totalHours: Math.round((totalMinutes / 60) * 10) / 10,
      recentSessions,
    },
  }
}
