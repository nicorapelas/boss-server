import type { NextFunction, Request, Response } from 'express'
import { Types } from 'mongoose'
import { LayBy } from '../models/LayBy.js'
import { OpenTab } from '../models/OpenTab.js'
import { Quote } from '../models/Quote.js'
import { Sale } from '../models/Sale.js'
import { SaleRefund } from '../models/SaleRefund.js'
import { ShiftSession } from '../models/ShiftSession.js'
import { User } from '../models/User.js'

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

type SaleTenderLean = {
  total?: number
  paymentMethod?: string
  payment?: { cashAmount?: number; cardAmount?: number }
}

/** Cash portion counted toward drawer / tenders (uses payment.cashAmount when set). */
function cashCollectedFromSale(s: SaleTenderLean): number {
  const cashAmt = round2(Number(s.payment?.cashAmount ?? 0))
  if (cashAmt > 0.005) return cashAmt
  const pm = (s.paymentMethod ?? '').toLowerCase()
  if (pm.includes('split')) return 0
  if (pm.includes('store_credit') || pm === 'on_account') return 0
  if (pm.includes('card') && !pm.includes('cash')) return 0
  if (pm.includes('cash')) return round2(Number(s.total ?? 0))
  return 0
}

function cardCollectedFromSale(s: SaleTenderLean): number {
  const cardAmt = round2(Number(s.payment?.cardAmount ?? 0))
  if (cardAmt > 0.005) return cardAmt
  const pm = (s.paymentMethod ?? '').toLowerCase()
  if (pm.includes('split')) return 0
  if (pm.includes('store_credit') || pm === 'on_account') return 0
  if (pm.includes('cash') && !pm.includes('card')) return 0
  if (pm.includes('card')) return round2(Number(s.total ?? 0))
  return 0
}

function isLayByCompletionSale(s: { paymentMethod?: string }) {
  return (s.paymentMethod ?? '') === 'layby_complete'
}

function normalizeTillCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim().toUpperCase()
  if (!v || !/^[A-Z0-9_-]{1,24}$/.test(v)) return null
  return v
}

async function getOrCreateOpenShift(tillCode: string, userId?: string) {
  let shift = await ShiftSession.findOne({ tillCode, status: 'open' }).sort({ openedAt: -1 })
  if (shift) return shift
  shift = await ShiftSession.create({
    tillCode,
    status: 'open',
    openedAt: new Date(),
    openedBy: userId ? new Types.ObjectId(String(userId)) : undefined,
  })
  return shift
}

async function nextZNumber(tillCode: string): Promise<number> {
  const latest = await ShiftSession.findOne({ tillCode, zNumber: { $ne: null } })
    .sort({ zNumber: -1 })
    .select('zNumber')
    .lean()
  return Math.max(1, Number(latest?.zNumber ?? 0) + 1)
}

async function summarizeShift(shift: { _id: Types.ObjectId; tillCode: string; openedAt: Date; closedAt?: Date | null }) {
  const from = shift.openedAt
  const to = shift.closedAt ?? new Date()
  const saleMatch = { tillCode: shift.tillCode, createdAt: { $gte: from, $lte: to } }
  /** Retail sales in window (exclude lay-by stock-release completions from turnover/tenders). */
  const retailSaleMatch = {
    ...saleMatch,
    paymentMethod: { $ne: 'layby_complete' },
  }

  const [sales, refundRowsRaw, byCashier, tabActivityCount, quoteActivityCount, layByPayAgg] = await Promise.all([
    Sale.find(saleMatch)
      .select(
        'saleId total paymentMethod payment storeCreditAmount onAccountAmount refundStatus refundPayoutMethod refundPayoutAmount quoteId cashier refundedBy items',
      )
      .lean(),
    SaleRefund.find({ createdAt: { $gte: from, $lte: to } })
      .select('saleId saleShortId payoutMethod refundTotal refundCash refundCard refundedBy tillCode')
      .lean(),
    Sale.aggregate<{ _id: Types.ObjectId; count: number; total: number }>([
      { $match: retailSaleMatch },
      { $group: { _id: '$cashier', count: { $sum: 1 }, total: { $sum: '$total' } } },
    ]),
    OpenTab.countDocuments({ createdAt: { $gte: from, $lte: to } }),
    Quote.countDocuments({ createdAt: { $gte: from, $lte: to } }),
    LayBy.aggregate<{
      count: number
      cash: number
      card: number
      storeCredit: number
      total: number
    }>([
      { $match: { status: { $in: ['active', 'completed', 'cancelled'] } } },
      { $unwind: '$payments' },
      {
        $match: {
          'payments.tillCode': shift.tillCode,
          'payments.createdAt': { $gte: from, $lte: to },
        },
      },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          cash: { $sum: { $ifNull: ['$payments.cashAmount', 0] } },
          card: { $sum: { $ifNull: ['$payments.cardAmount', 0] } },
          storeCredit: { $sum: { $ifNull: ['$payments.storeCreditAmount', 0] } },
          total: { $sum: { $ifNull: ['$payments.amount', 0] } },
        },
      },
      { $project: { _id: 0, count: 1, cash: 1, card: 1, storeCredit: 1, total: 1 } },
    ]),
  ])

  const shiftTillNorm = normalizeTillCode(shift.tillCode) ?? shift.tillCode.trim().toUpperCase()

  const refundCandidates = refundRowsRaw as Array<{
    saleId?: Types.ObjectId
    saleShortId?: string
    payoutMethod?: string
    refundTotal?: number
    refundCash?: number
    refundCard?: number
    refundedBy?: Types.ObjectId
    tillCode?: string
  }>

  const candidateRefundSaleIds = [
    ...new Set(
      refundCandidates
        .map((r) => String(r.saleId ?? ''))
        .filter((id) => Types.ObjectId.isValid(id))
        .map((id) => new Types.ObjectId(id)),
    ),
  ]

  const saleDocsForRefunds =
    candidateRefundSaleIds.length > 0
      ? await Sale.find({ _id: { $in: candidateRefundSaleIds } }).select('cashier tillCode').lean()
      : []

  const tillByRefundSaleId = new Map(
    saleDocsForRefunds.map((doc) => [String(doc._id), normalizeTillCode(doc.tillCode)]),
  )
  const cashierByRefundSaleId = new Map(
    saleDocsForRefunds.map((doc) => [String(doc._id), doc.cashier ? String(doc.cashier) : '']),
  )

  /** Till on refund doc wins; if missing (legacy), use originating sale’s tillCode so Z matches the till that rang the sale. */
  const refunds = refundCandidates.filter((r) => {
    const refundTill = normalizeTillCode(r.tillCode)
    if (refundTill != null) return refundTill === shiftTillNorm
    const saleTill = tillByRefundSaleId.get(String(r.saleId ?? ''))
    return saleTill != null && saleTill === shiftTillNorm
  })

  const refundDeductionByCashier = new Map<string, number>()
  for (const r of refunds) {
    const sid = String(r.saleId ?? '')
    let ck = sid ? cashierByRefundSaleId.get(sid) ?? '' : ''
    if (!ck && r.refundedBy) ck = String(r.refundedBy)
    if (!ck) continue
    refundDeductionByCashier.set(ck, round2((refundDeductionByCashier.get(ck) ?? 0) + Number(r.refundTotal ?? 0)))
  }

  const nonRefundedSales = sales.filter((s) => s.refundStatus !== 'refunded')
  const retailSales = sales.filter((s) => !isLayByCompletionSale(s))
  const grossSalesTotal = round2(retailSales.reduce((sum, s) => sum + Number(s.total ?? 0), 0))

  const refundTotal = round2(refunds.reduce((sum, r) => sum + Number(r.refundTotal ?? 0), 0))
  const refundCashTotal = round2(refunds.reduce((sum, r) => sum + Number(r.refundCash ?? 0), 0))
  const refundCardTotal = round2(refunds.reduce((sum, r) => sum + Number(r.refundCard ?? 0), 0))
  const refundCount = refunds.length

  /** Net retail sales value after refunds recorded this shift (same window as gross). */
  const turnover = round2(grossSalesTotal - refundTotal)

  const cashSalesGross = round2(retailSales.reduce((sum, s) => sum + cashCollectedFromSale(s), 0))
  const cardSalesGross = round2(retailSales.reduce((sum, s) => sum + cardCollectedFromSale(s), 0))
  const cashSales = round2(cashSalesGross - refundCashTotal)
  const cardSales = round2(cardSalesGross - refundCardTotal)

  const voucherTotal = round2(
    nonRefundedSales.reduce((sum, s) => sum + Number(s.storeCreditAmount ?? 0), 0),
  )
  const onAccountTotal = round2(
    nonRefundedSales.reduce((sum, s) => sum + Number(s.onAccountAmount ?? 0), 0),
  )
  const layByCompletions = nonRefundedSales.filter((s) => s.paymentMethod === 'layby_complete').length
  const quoteConversions = quoteActivityCount
  const layByPayments = layByPayAgg?.[0] ?? { count: 0, cash: 0, card: 0, storeCredit: 0, total: 0 }

  const refundCashierIds = Array.from(
    new Set(
      refunds
        .map((r) => String(r.refundedBy ?? ''))
        .filter((x) => x.trim().length > 0),
    ),
  )

  const grossByCashier = new Map(
    byCashier
      .filter((x) => x._id)
      .map((x) => [String(x._id), { count: x.count, total: Number(x.total ?? 0) }]),
  )
  const refundAttributedCashierIds = Array.from(refundDeductionByCashier.keys()).filter((id) =>
    Types.ObjectId.isValid(id),
  )
  const cashierIdsFromSales = byCashier.map((x) => String(x._id ?? '')).filter((id) => id && Types.ObjectId.isValid(id))
  const allUserIds = Array.from(
    new Set([...cashierIdsFromSales, ...refundCashierIds, ...refundAttributedCashierIds]),
  ).filter(Boolean)
  const users = allUserIds.length
    ? await User.find({ _id: { $in: allUserIds.map((id) => new Types.ObjectId(id)) } })
        .select('displayName email')
        .lean()
    : []
  const userById = new Map(users.map((u) => [String(u._id), (u.displayName?.trim() || u.email || '').trim()]))
  const refundCashierNames = refundCashierIds
    .map((id) => userById.get(id) || '')
    .filter((n) => n.trim().length > 0)

  const uniqueRefundCashierNames = Array.from(new Set(refundCashierNames)).sort((a, b) => a.localeCompare(b))

  const mergedCashierIds = Array.from(
    new Set([...grossByCashier.keys(), ...refundAttributedCashierIds]),
  ).filter((id) => Types.ObjectId.isValid(id))
  const cashierSales = mergedCashierIds
    .map((cid) => {
      const g = grossByCashier.get(cid) ?? { count: 0, total: 0 }
      const deducted = refundDeductionByCashier.get(cid) ?? 0
      return {
        cashierId: new Types.ObjectId(cid),
        cashierName: userById.get(cid) || '',
        salesCount: g.count,
        total: round2(g.total - deducted),
      }
    })
    .sort((a, b) => (a.cashierName || '').localeCompare(b.cashierName || ''))
  const refundDetails = refunds.map((r) => {
    const cashierId = String(r.refundedBy ?? '')
    const cashierName = userById.get(cashierId) || ''
    const pm = r.payoutMethod
    const method: 'cash' | 'card' | undefined = pm === 'cash' || pm === 'card' ? pm : undefined
    return {
      saleId: typeof r.saleShortId === 'string' ? r.saleShortId : undefined,
      cashierId: r.refundedBy,
      cashierName,
      method,
      refundTotal: round2(Number(r.refundTotal ?? 0)),
      refundCash: round2(Number(r.refundCash ?? 0)),
      refundCard: round2(Number(r.refundCard ?? 0)),
    }
  })
  const priceOverrides = nonRefundedSales.flatMap((s) => {
    const cashierId = String(s.cashier ?? '')
    const cashierName = userById.get(cashierId) || ''
    const saleId = typeof s.saleId === 'string' ? s.saleId : undefined
    return (s.items ?? [])
      .filter((line) => {
        const listRaw = (line as { listUnitPrice?: number }).listUnitPrice
        if (listRaw === undefined || listRaw === null) return false
        const list = Number(listRaw)
        const overridden = Number((line as { unitPrice?: number }).unitPrice ?? 0)
        return Number.isFinite(list) && Number.isFinite(overridden) && Math.abs(list - overridden) > 0.0001
      })
      .map((line) => {
        const list = round2(Number((line as { listUnitPrice?: number }).listUnitPrice ?? 0))
        const overridden = round2(Number((line as { unitPrice?: number }).unitPrice ?? 0))
        const qty = round2(Number((line as { quantity?: number }).quantity ?? 0))
        return {
          saleId,
          cashierId: s.cashier ?? undefined,
          cashierName,
          itemName: String((line as { name?: string }).name ?? '').trim() || 'Item',
          quantity: qty,
          listUnitPrice: list,
          overriddenUnitPrice: overridden,
          lineDiscount: round2(Math.max(0, (list - overridden) * qty)),
        }
      })
  })

  return {
    turnover,
    cashSales,
    cardSales,
    voucherTotal,
    onAccountTotal,
    refundTotal,
    refundCashTotal,
    refundCardTotal,
    refundCount,
    refundCashierNames: uniqueRefundCashierNames,
    refundDetails,
    layByCompletions,
    layByPaymentCount: layByPayments.count,
    layByPaymentCashTotal: round2(Number(layByPayments.cash ?? 0)),
    layByPaymentCardTotal: round2(Number(layByPayments.card ?? 0)),
    layByPaymentStoreCreditTotal: round2(Number(layByPayments.storeCredit ?? 0)),
    layByPaymentTotal: round2(Number(layByPayments.total ?? 0)),
    quoteConversions,
    tabClosures: tabActivityCount,
    cashierSales,
    priceOverrides,
  }
}

export async function currentShift(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) return void res.status(401).json({ message: 'Unauthorized' })
    const tillCode = normalizeTillCode(req.query.tillCode)
    if (!tillCode) return void res.status(400).json({ message: 'tillCode required' })
    const shift = await getOrCreateOpenShift(tillCode, String(req.user.id))
    res.json(shift)
  } catch (e) {
    next(e)
  }
}

export async function zReportPreview(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) return void res.status(401).json({ message: 'Unauthorized' })
    const tillCode = normalizeTillCode(req.body?.tillCode)
    if (!tillCode) return void res.status(400).json({ message: 'tillCode required' })
    const shift = await getOrCreateOpenShift(tillCode, String(req.user.id))
    const summary = await summarizeShift({ _id: shift._id, tillCode: shift.tillCode, openedAt: shift.openedAt })
    res.json({
      shiftId: shift._id,
      tillCode: shift.tillCode,
      openedAt: shift.openedAt,
      status: shift.status,
      summary,
      cashDifferences: shift.cashDifferences ?? [],
    })
  } catch (e) {
    next(e)
  }
}

export async function addShiftDifference(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) return void res.status(401).json({ message: 'Unauthorized' })
    const shiftId = String(req.params.id ?? '').trim()
    if (!Types.ObjectId.isValid(shiftId)) return void res.status(400).json({ message: 'Invalid shift id' })
    const kind = String(req.body?.kind ?? '').trim().toLowerCase()
    if (kind !== 'over' && kind !== 'under') return void res.status(400).json({ message: 'kind must be over/under' })
    const amount = Number(req.body?.amount)
    if (!Number.isFinite(amount) || amount <= 0) return void res.status(400).json({ message: 'amount must be > 0' })
    const noteRaw = typeof req.body?.note === 'string' ? req.body.note.trim() : ''
    if (!noteRaw) return void res.status(400).json({ message: 'reason note required' })
    const source = req.body?.source === 'backoffice' ? 'backoffice' : 'pos'

    const shift = await ShiftSession.findById(shiftId)
    if (!shift) return void res.status(404).json({ message: 'Shift not found' })
    shift.cashDifferences.push({
      kind,
      amount: round2(amount),
      note: noteRaw.slice(0, 400),
      source,
      createdBy: new Types.ObjectId(String(req.user.id)),
      createdAt: new Date(),
    })
    await shift.save()
    res.status(201).json(shift)
  } catch (e) {
    next(e)
  }
}

export async function closeAndStartNextShift(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) return void res.status(401).json({ message: 'Unauthorized' })
    const shiftId = String(req.params.id ?? '').trim()
    if (!Types.ObjectId.isValid(shiftId)) return void res.status(400).json({ message: 'Invalid shift id' })
    const shift = await ShiftSession.findById(shiftId)
    if (!shift) return void res.status(404).json({ message: 'Shift not found' })
    if (shift.status !== 'open') return void res.status(400).json({ message: 'Shift already closed' })

    const closedAt = new Date()
    shift.closedAt = closedAt
    shift.closedBy = new Types.ObjectId(String(req.user.id))
    shift.summary = await summarizeShift({
      _id: shift._id,
      tillCode: shift.tillCode,
      openedAt: shift.openedAt,
      closedAt,
    })
    shift.zNumber = await nextZNumber(shift.tillCode)
    shift.status = 'closed'
    await shift.save()

    const nextShift = await ShiftSession.create({
      tillCode: shift.tillCode,
      status: 'open',
      openedAt: new Date(),
      openedBy: new Types.ObjectId(String(req.user.id)),
    })
    res.json({ closedShift: shift, nextShift })
  } catch (e) {
    next(e)
  }
}

export async function listShifts(req: Request, res: Response, next: NextFunction) {
  try {
    const tillCode = normalizeTillCode(req.query.tillCode)
    const status = typeof req.query.status === 'string' ? req.query.status.trim().toLowerCase() : ''
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 300)
    const q: Record<string, unknown> = {}
    if (tillCode) q.tillCode = tillCode
    if (status === 'open' || status === 'closed') q.status = status
    const rows = await ShiftSession.find(q).sort({ openedAt: -1 }).limit(limit).lean()
    res.json(rows)
  } catch (e) {
    next(e)
  }
}

export async function getShift(req: Request, res: Response, next: NextFunction) {
  try {
    const id = String(req.params.id ?? '').trim()
    if (!Types.ObjectId.isValid(id)) return void res.status(400).json({ message: 'Invalid shift id' })
    const shift = await ShiftSession.findById(id).lean()
    if (!shift) return void res.status(404).json({ message: 'Shift not found' })
    res.json(shift)
  } catch (e) {
    next(e)
  }
}

export { getOrCreateOpenShift }
