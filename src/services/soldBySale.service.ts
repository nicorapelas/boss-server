import { Types } from 'mongoose'
import type { IProduct } from '../models/Product.js'
import { Sale } from '../models/Sale.js'
import { SaleRefund } from '../models/SaleRefund.js'
import { User } from '../models/User.js'

const MAX_DAYS = 366
const DEFAULT_DAYS = 30

function docCreatedAt(doc: { createdAt?: Date | null }): string {
  const d = doc.createdAt
  return d instanceof Date ? d.toISOString() : new Date().toISOString()
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function clampSoldByDays(days: unknown): number {
  const n = Number(days)
  if (!Number.isFinite(n) || n < 1) return DEFAULT_DAYS
  return Math.min(MAX_DAYS, Math.floor(n))
}

export type CashierSoldByContext = {
  userId: Types.ObjectId
  displayName: string
}

export async function resolveCashierSoldByContext(userId: string): Promise<CashierSoldByContext> {
  const u = await User.findById(userId).select('displayName email').lean()
  const raw = u?.displayName?.trim() || u?.email?.split('@')[0]?.trim() || 'Staff'
  const displayName = raw.slice(0, 120)
  return { userId: new Types.ObjectId(userId), displayName }
}

export function soldByFieldsForProduct(
  product: Pick<IProduct, 'trackSoldBy'>,
  cashier: CashierSoldByContext,
): { soldByUserId?: Types.ObjectId; soldByDisplayName?: string } {
  if (!product.trackSoldBy) return {}
  return {
    soldByUserId: cashier.userId,
    soldByDisplayName: cashier.displayName,
  }
}

export type UserSoldByLineRow = {
  saleId: string
  saleShortId?: string
  occurredAt: string
  sku?: string
  productName: string
  quantity: number
  unitPrice: number
  lineTotal: number
  kind: 'sale' | 'refund'
}

export type UserSoldBySalesResponse = {
  userId: string
  days: number
  from: string
  to: string
  lines: UserSoldByLineRow[]
  totals: { quantity: number; lineTotal: number }
}

export async function buildUserSoldBySales(
  userId: string,
  daysInput?: unknown,
): Promise<UserSoldBySalesResponse> {
  if (!Types.ObjectId.isValid(userId)) {
    throw new Error('Invalid user id')
  }
  const userOid = new Types.ObjectId(userId)
  const days = clampSoldByDays(daysInput)
  const to = new Date()
  const from = new Date(to.getTime() - days * 86_400_000)

  const sales = await Sale.find({
    createdAt: { $gte: from, $lte: to },
    'items.soldByUserId': userOid,
  })
    .select('saleId createdAt items')
    .sort({ createdAt: -1 })
    .lean()

  const lines: UserSoldByLineRow[] = []

  for (const sale of sales) {
    const saleId = String(sale._id)
    const saleShortId = typeof sale.saleId === 'string' ? sale.saleId : undefined
    const occurredAt = docCreatedAt(sale as { createdAt?: Date | null })
    ;(sale.items ?? []).forEach((item) => {
      const soldBy = item.soldByUserId
      if (!soldBy || String(soldBy) !== userId) return
      lines.push({
        saleId,
        saleShortId,
        occurredAt,
        sku: item.sku,
        productName: String(item.name ?? '').trim() || 'Item',
        quantity: round2(Number(item.quantity ?? 0)),
        unitPrice: round2(Number(item.unitPrice ?? 0)),
        lineTotal: round2(Number(item.lineTotal ?? 0)),
        kind: 'sale',
      })
    })
  }

  const refunds = await SaleRefund.find({ createdAt: { $gte: from, $lte: to } })
    .select('saleId lines createdAt')
    .lean()

  const refundSaleIds = Array.from(new Set(refunds.map((r) => String(r.saleId ?? '')).filter(Boolean)))
  const refundSales =
    refundSaleIds.length > 0
      ? await Sale.find({ _id: { $in: refundSaleIds.map((id) => new Types.ObjectId(id)) } })
          .select('saleId items')
          .lean()
      : []
  const saleById = new Map(refundSales.map((s) => [String(s._id), s]))

  for (const refund of refunds) {
    const sale = saleById.get(String(refund.saleId ?? ''))
    if (!sale) continue
    const occurredAt = docCreatedAt(refund as { createdAt?: Date | null })
    for (const rl of refund.lines ?? []) {
      const idx = Number(rl.saleLineIndex ?? -1)
      const orig = sale.items?.[idx]
      if (!orig?.soldByUserId || String(orig.soldByUserId) !== userId) continue
      lines.push({
        saleId: String(refund.saleId),
        saleShortId: typeof sale.saleId === 'string' ? sale.saleId : undefined,
        occurredAt,
        sku: orig.sku ?? rl.name,
        productName: String(rl.name ?? orig.name ?? '').trim() || 'Item',
        quantity: -round2(Math.max(0, Number(rl.quantity ?? 0))),
        unitPrice: round2(Number(rl.unitPrice ?? 0)),
        lineTotal: -round2(Math.max(0, Number(rl.lineTotal ?? 0))),
        kind: 'refund',
      })
    }
  }

  lines.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))

  const totals = lines.reduce(
    (acc, row) => ({
      quantity: round2(acc.quantity + row.quantity),
      lineTotal: round2(acc.lineTotal + row.lineTotal),
    }),
    { quantity: 0, lineTotal: 0 },
  )

  return {
    userId,
    days,
    from: from.toISOString(),
    to: to.toISOString(),
    lines,
    totals,
  }
}
