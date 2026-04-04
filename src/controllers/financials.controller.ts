import type { NextFunction, Request, Response } from 'express'
import { LayBy } from '../models/LayBy.js'
import { Sale } from '../models/Sale.js'

function parseDateParam(raw: unknown): Date | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

export async function financialsSummary(req: Request, res: Response, next: NextFunction) {
  try {
    const from = parseDateParam(req.query.from)
    const to = parseDateParam(req.query.to)

    if (!from || !to) {
      res.status(400).json({ message: 'from and to query params required (ISO dates)' })
      return
    }
    if (to.getTime() < from.getTime()) {
      res.status(400).json({ message: 'to must be >= from' })
      return
    }

    const match = {
      createdAt: {
        $gte: from,
        $lte: to,
      },
      $or: [{ layById: { $exists: false } }, { layById: null }],
    }

    const [totalsAgg, byMethodAgg, byDayAgg, layByPayAgg] = await Promise.all([
      Sale.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            saleCount: { $sum: 1 },
            grossTotal: { $sum: '$total' },
          },
        },
      ]),
      Sale.aggregate([
        { $match: match },
        {
          $group: {
            _id: { $ifNull: ['$paymentMethod', 'unknown'] },
            saleCount: { $sum: 1 },
            grossTotal: { $sum: '$total' },
          },
        },
        { $sort: { grossTotal: -1 } },
      ]),
      Sale.aggregate([
        { $match: match },
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: '$createdAt',
              },
            },
            saleCount: { $sum: 1 },
            grossTotal: { $sum: '$total' },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      LayBy.aggregate([
        { $unwind: '$payments' },
        {
          $match: {
            'payments.createdAt': { $gte: from, $lte: to },
          },
        },
        {
          $group: {
            _id: null,
            paymentCount: { $sum: 1 },
            amountTotal: { $sum: '$payments.amount' },
            cashTotal: { $sum: '$payments.cashAmount' },
            cardTotal: { $sum: '$payments.cardAmount' },
            storeCreditTotal: { $sum: '$payments.storeCreditAmount' },
          },
        },
      ]),
    ])

    const totals = totalsAgg[0] as { saleCount: number; grossTotal: number } | undefined
    const layByP = layByPayAgg[0] as
      | {
          paymentCount: number
          amountTotal: number
          cashTotal: number
          cardTotal: number
          storeCreditTotal: number
        }
      | undefined

    res.json({
      range: { from: from.toISOString(), to: to.toISOString() },
      totals: {
        saleCount: totals?.saleCount ?? 0,
        grossTotal: Math.round((totals?.grossTotal ?? 0) * 100) / 100,
      },
      layByPayments: {
        paymentCount: layByP?.paymentCount ?? 0,
        amountTotal: Math.round((layByP?.amountTotal ?? 0) * 100) / 100,
        cashTotal: Math.round((layByP?.cashTotal ?? 0) * 100) / 100,
        cardTotal: Math.round((layByP?.cardTotal ?? 0) * 100) / 100,
        storeCreditTotal: Math.round((layByP?.storeCreditTotal ?? 0) * 100) / 100,
      },
      byPaymentMethod: (byMethodAgg as Array<{ _id: string; saleCount: number; grossTotal: number }>).map((r) => ({
        paymentMethod: r._id,
        saleCount: r.saleCount,
        grossTotal: Math.round((r.grossTotal ?? 0) * 100) / 100,
      })),
      byDay: (byDayAgg as Array<{ _id: string; saleCount: number; grossTotal: number }>).map((r) => ({
        day: r._id,
        saleCount: r.saleCount,
        grossTotal: Math.round((r.grossTotal ?? 0) * 100) / 100,
      })),
    })
  } catch (e) {
    next(e)
  }
}

