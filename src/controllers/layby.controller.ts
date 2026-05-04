import type { NextFunction, Request, Response } from 'express'
import { Types } from 'mongoose'
import { LayBy } from '../models/LayBy.js'
import { Product } from '../models/Product.js'
import { expandForProduct, productHasVolumeTiering } from '../utils/volumePrice.js'
import { Sale } from '../models/Sale.js'
import { StoreCreditAccount, StoreCreditLedger } from '../models/StoreCreditAccount.js'
import { StoreSettings } from '../models/StoreSettings.js'
import { canChargeAboveCatalogPrice, isRegisterManager } from '../utils/requestAuth.js'
import { productTracksInventory } from '../utils/productInventory.js'
import { getOrCreateOpenShift } from './shifts.controller.js'

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** VAT-inclusive total → VAT amount (South Africa style: prices incl. VAT). */
export function vatAmountFromInclusive(totalIncl: number, vatRate: number): number {
  const net = totalIncl / (1 + vatRate)
  return round2(totalIncl - net)
}

export function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, '')
}

function normalizeTillCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim().toUpperCase()
  if (!v || !/^[A-Z0-9_-]{1,24}$/.test(v)) return null
  return v
}

async function getSettings() {
  let s = await StoreSettings.findById('default').lean()
  if (!s) {
    await StoreSettings.create({
      _id: 'default',
      storeName: 'ElectroPOS',
      storeAddressLines: [],
      storePhone: '',
      storeVatNumber: '',
      layByTerms: '',
      defaultDepositPercent: 30,
      defaultExpiryMonths: 3,
      vatRate: 0.14,
      nextLayBySeq: 1,
      nextQuoteSeq: 0,
    })
    s = await StoreSettings.findById('default').lean()
  }
  return s!
}

export async function reservedQtyByProduct(): Promise<Map<string, number>> {
  const rows = await LayBy.aggregate<{ _id: string; qty: number }>([
    { $match: { status: 'active' } },
    { $unwind: '$lines' },
    { $group: { _id: '$lines.productId', qty: { $sum: '$lines.quantity' } } },
  ])
  return new Map(rows.map((r) => [String(r._id), r.qty]))
}

type BodyLine = { productId?: string; quantity?: number; unitPrice?: number }

export async function createLayBy(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' })
      return
    }
    const body = req.body as {
      customerName?: string
      phone?: string
      items?: BodyLine[]
      depositPercentOverride?: number
      expiresAtOverride?: string
      firstPayment?: { cashAmount?: number; cardAmount?: number; storeCreditAmount?: number }
      tillCode?: string
    }
    const customerName = body.customerName?.trim()
    const phoneNorm = body.phone ? normalizePhone(body.phone) : ''
    if (!customerName || !phoneNorm) {
      res.status(400).json({ message: 'customerName and phone are required' })
      return
    }
    if (!body.items?.length) {
      res.status(400).json({ message: 'items required' })
      return
    }
    const settings = await getSettings()
    const vatRate = settings.vatRate ?? 0.14

    let depositPercent = settings.defaultDepositPercent ?? 30
    if (body.depositPercentOverride !== undefined) {
      if (!isRegisterManager(req.user)) {
        res.status(403).json({ message: 'Manager permission required to override the deposit percentage' })
        return
      }
      const p = Number(body.depositPercentOverride)
      if (!Number.isFinite(p) || p < 0 || p > 100) {
        res.status(400).json({ message: 'depositPercentOverride must be 0–100' })
        return
      }
      depositPercent = p
    }

    let expiresAt: Date
    if (body.expiresAtOverride !== undefined) {
      if (!isRegisterManager(req.user)) {
        res.status(403).json({ message: 'Manager permission required to override expiry' })
        return
      }
      const d = new Date(body.expiresAtOverride)
      if (Number.isNaN(d.getTime())) {
        res.status(400).json({ message: 'Invalid expiresAtOverride' })
        return
      }
      expiresAt = d
    } else {
      const months = settings.defaultExpiryMonths ?? 3
      expiresAt = new Date()
      expiresAt.setMonth(expiresAt.getMonth() + months)
    }

    const normalized = body.items.map((row) => ({
      productId: row.productId,
      quantity: row.quantity,
      unitPrice: row.unitPrice !== undefined ? Number(row.unitPrice) : undefined,
    }))
    for (const row of normalized) {
      if (!row.productId || !row.quantity || row.quantity < 1) {
        res.status(400).json({ message: 'Each item needs productId and quantity >= 1' })
        return
      }
    }

    const reserved = await reservedQtyByProduct()
    const ids = normalized.map((r) => r.productId as string)
    const products = await Product.find({ _id: { $in: ids } }).lean()
    const byId = new Map(products.map((p) => [String(p._id), p]))

    const lines: Array<{
      productId: unknown
      name: string
      sku: string
      quantity: number
      unitPrice: number
      lineTotal: number
      listUnitPrice?: number
    }> = []

    for (const row of normalized) {
      const p = byId.get(row.productId as string)
      if (!p) {
        res.status(400).json({ message: `Unknown product ${row.productId}` })
        return
      }
      const catalog = round2(p.price ?? 0)
      const qty = row.quantity as number
      if (productHasVolumeTiering(p)) {
        if (productTracksInventory(p)) {
          const stock = p.stock ?? 0
          const rsv = reserved.get(String(p._id)) ?? 0
          const available = stock - rsv
          if (available < qty) {
            res.status(409).json({
              message: `Insufficient available stock for ${p.sku} (lay-by reservations)`,
            })
            return
          }
        }
        const segments = expandForProduct(p, qty)
        for (const seg of segments) {
          lines.push({
            productId: p._id,
            name: p.name,
            sku: p.sku,
            quantity: seg.quantity,
            unitPrice: seg.unitPrice,
            lineTotal: seg.lineTotal,
            listUnitPrice: seg.listUnitPrice,
          })
        }
      } else {
        let unitPrice = catalog
        if (row.unitPrice !== undefined) {
          const requested = round2(row.unitPrice)
          if (!Number.isFinite(requested) || requested < 0) {
            res.status(400).json({ message: 'Invalid unitPrice' })
            return
          }
          if (requested > catalog && !canChargeAboveCatalogPrice(req.user)) {
            res.status(403).json({ message: 'Not allowed to charge above the catalog price' })
            return
          }
          unitPrice = requested
        }
        const lineTotal = round2(unitPrice * qty)
        if (productTracksInventory(p)) {
          const stock = p.stock ?? 0
          const rsv = reserved.get(String(p._id)) ?? 0
          const available = stock - rsv
          if (available < qty) {
            res.status(409).json({
              message: `Insufficient available stock for ${p.sku} (lay-by reservations)`,
            })
            return
          }
        }
        lines.push({
          productId: p._id,
          name: p.name,
          sku: p.sku,
          quantity: qty,
          unitPrice,
          lineTotal,
          listUnitPrice: unitPrice !== catalog ? catalog : undefined,
        })
      }
    }

    const totalInclVat = round2(lines.reduce((s, l) => s + l.lineTotal, 0))
    const totalVatAmount = round2(vatAmountFromInclusive(totalInclVat, vatRate))
    const totalNetAmount = round2(totalInclVat - totalVatAmount)
    const depositAmount = round2((totalInclVat * depositPercent) / 100)

    const fp = body.firstPayment ?? {}
    const cashAmount = Math.max(0, Number(fp.cashAmount ?? 0) || 0)
    const cardAmount = Math.max(0, Number(fp.cardAmount ?? 0) || 0)
    let storeCreditAmount = Math.max(0, Number(fp.storeCreditAmount ?? 0) || 0)
    const firstTotal = round2(cashAmount + cardAmount + storeCreditAmount)

    if (firstTotal < depositAmount - 0.01) {
      res.status(400).json({
        message: `First payment must be at least the deposit (${depositAmount.toFixed(2)})`,
      })
      return
    }
    if (firstTotal > totalInclVat + 0.02) {
      res.status(400).json({ message: 'First payment cannot exceed lay-by total' })
      return
    }

    if (storeCreditAmount > 0) {
      const acct = await StoreCreditAccount.findOne({ phone: phoneNorm }).lean()
      if (!acct || (acct.balance ?? 0) < storeCreditAmount - 0.01) {
        res.status(400).json({ message: 'Insufficient store credit for this phone number' })
        return
      }
    }

    const tillCode = normalizeTillCode(body.tillCode)
    if (body.tillCode != null && !tillCode) {
      res.status(400).json({ message: 'Invalid tillCode (use letters, numbers, _, -; max 24)' })
      return
    }
    const openShift = tillCode ? await getOrCreateOpenShift(tillCode, String(req.user.id)) : null

    const st = await StoreSettings.findOneAndUpdate(
      { _id: 'default' },
      { $inc: { nextLayBySeq: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).lean()
    const seq = (st?.nextLayBySeq ?? 1) - 1
    const year = new Date().getFullYear()
    const layByNumber = `LB-${year}-${String(seq).padStart(5, '0')}`

    const paymentDoc = {
      amount: firstTotal,
      cashAmount,
      cardAmount,
      storeCreditAmount,
      tillCode: tillCode || undefined,
      shiftId: openShift?._id ?? undefined,
      createdAt: new Date(),
      createdBy: new Types.ObjectId(String(req.user.id)),
    }

    const amountPaid = firstTotal
    const balance = round2(totalInclVat - amountPaid)

    const doc = await LayBy.create({
      layByNumber,
      customerName,
      phone: phoneNorm,
      lines,
      vatRate,
      totalInclVat,
      totalVatAmount,
      totalNetAmount,
      depositPercentUsed: depositPercent,
      depositAmount,
      amountPaid,
      balance: Math.max(0, balance),
      status: 'active',
      expiresAt,
      payments: [paymentDoc],
      createdBy: new Types.ObjectId(String(req.user.id)),
    })

    if (storeCreditAmount > 0) {
      const acct = await StoreCreditAccount.findOne({ phone: phoneNorm })
      if (!acct) {
        await LayBy.deleteOne({ _id: doc._id })
        res.status(400).json({ message: 'Store credit account not found' })
        return
      }
      acct.balance = round2((acct.balance ?? 0) - storeCreditAmount)
      await acct.save()
      await StoreCreditLedger.create({
        accountId: acct._id,
        phone: phoneNorm,
        amount: -storeCreditAmount,
        kind: 'redeem',
        refType: 'sale',
        refId: doc._id,
        note: 'Lay-by deposit',
        createdBy: new Types.ObjectId(String(req.user.id)),
      })
    }

    const out = await LayBy.findById(doc._id).lean()
    res.status(201).json(out)
  } catch (e) {
    next(e)
  }
}

export async function listActiveLayBys(req: Request, res: Response, next: NextFunction) {
  try {
    const q = (req.query.q as string | undefined)?.trim()
    const filter: Record<string, unknown> = { status: 'active' }
    if (q) {
      const digits = normalizePhone(q)
      filter.$or = [
        { layByNumber: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
        { customerName: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
        ...(digits ? [{ phone: digits }] : []),
      ]
    }
    const list = await LayBy.find(filter).sort({ createdAt: -1 }).limit(100).lean()
    res.json(list)
  } catch (e) {
    next(e)
  }
}

export async function getLayBy(req: Request, res: Response, next: NextFunction) {
  try {
    const lb = await LayBy.findById(req.params.id).lean()
    if (!lb) {
      res.status(404).json({ message: 'Lay-by not found' })
      return
    }
    res.json(lb)
  } catch (e) {
    next(e)
  }
}

export async function addLayByPayment(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' })
      return
    }
    const lb = await LayBy.findById(req.params.id)
    if (!lb || lb.status !== 'active') {
      res.status(404).json({ message: 'Active lay-by not found' })
      return
    }
    const body = req.body as { cashAmount?: number; cardAmount?: number; storeCreditAmount?: number; tillCode?: string }
    const tenderCash = round2(Math.max(0, Number(body.cashAmount ?? 0) || 0))
    const tenderCard = round2(Math.max(0, Number(body.cardAmount ?? 0) || 0))
    const tenderSc = round2(Math.max(0, Number(body.storeCreditAmount ?? 0) || 0))
    const tenderTotal = round2(tenderCash + tenderCard + tenderSc)
    if (tenderTotal < 0.01) {
      res.status(400).json({ message: 'Payment amount required' })
      return
    }

    const tillCode = normalizeTillCode(body.tillCode)
    if (body.tillCode != null && !tillCode) {
      res.status(400).json({ message: 'Invalid tillCode (use letters, numbers, _, -; max 24)' })
      return
    }
    const openShift = tillCode ? await getOrCreateOpenShift(tillCode, String(req.user.id)) : null

    const balanceDue = round2(lb.balance)
    if (balanceDue < 0.01) {
      res.status(400).json({ message: 'Lay-by is already paid in full' })
      return
    }

    /** Amount that actually applies to the lay-by (tender may exceed balance — change due on cash). */
    const appliedTotal = round2(Math.min(tenderTotal, balanceDue))
    if (appliedTotal < 0.01) {
      res.status(400).json({ message: 'Payment amount required' })
      return
    }

    // Same order as POS sale: store credit toward balance, then card, then cash.
    const scApplied = round2(Math.min(tenderSc, appliedTotal))
    const remAfterSc = round2(appliedTotal - scApplied)
    const cardApplied = round2(Math.min(tenderCard, remAfterSc))
    const cashApplied = round2(Math.min(tenderCash, remAfterSc - cardApplied))

    if (scApplied > 0) {
      const acct = await StoreCreditAccount.findOne({ phone: lb.phone }).lean()
      if (!acct || (acct.balance ?? 0) < scApplied - 0.01) {
        res.status(400).json({ message: 'Insufficient store credit' })
        return
      }
      const acc = await StoreCreditAccount.findById(acct._id)
      if (!acc) {
        res.status(400).json({ message: 'Store credit account missing' })
        return
      }
      acc.balance = round2((acc.balance ?? 0) - scApplied)
      await acc.save()
      await StoreCreditLedger.create({
        accountId: acc._id,
        phone: lb.phone,
        amount: -scApplied,
        kind: 'redeem',
        refType: 'sale',
        refId: lb._id,
        note: 'Lay-by payment',
        createdBy: new Types.ObjectId(String(req.user.id)),
      })
    }

    lb.payments.push({
      amount: appliedTotal,
      cashAmount: cashApplied,
      cardAmount: cardApplied,
      storeCreditAmount: scApplied,
      tillCode: tillCode || undefined,
      shiftId: openShift?._id ?? undefined,
      createdAt: new Date(),
      createdBy: new Types.ObjectId(String(req.user.id)),
    })
    lb.amountPaid = round2(lb.amountPaid + appliedTotal)
    lb.balance = round2(lb.totalInclVat - lb.amountPaid)
    if (lb.balance < 0) lb.balance = 0
    await lb.save()

    const changeDue = round2(Math.max(0, tenderCash - cashApplied))

    // Auto-complete when the final payment clears the balance.
    if (lb.balance <= 0.02) {
      await completeLayByInternal(String(lb._id), req.user.id, tillCode || undefined)
    }

    const out = await LayBy.findById(lb._id).lean()
    res.json({
      ...out,
      paymentChangeDue: changeDue,
      paymentTenderedCash: tenderCash,
      paymentTenderedCard: tenderCard,
      paymentAppliedCash: cashApplied,
      paymentAppliedCard: cardApplied,
      paymentAppliedStoreCredit: scApplied,
    })
  } catch (e) {
    next(e)
  }
}

async function completeLayByInternal(layById: string, userId: string, tillCode?: string) {
  const lb = await LayBy.findById(layById)
  if (!lb || lb.status !== 'active') return
  if (lb.balance > 0.02) return

  const lines: Array<{
    product: unknown
    name: string
    quantity: number
    unitPrice: number
    lineTotal: number
  }> = []

  const normalized = lb.lines.map((l) => ({
    productId: String(l.productId),
    quantity: l.quantity,
    unitPrice: l.unitPrice,
  }))

  const ids = normalized.map((r) => r.productId)
  const products = await Product.find({ _id: { $in: ids } }).lean()
  const byId = new Map(products.map((p) => [String(p._id), p]))

  const applied: Array<{ productId: string; quantity: number }> = []
  for (const row of normalized) {
    const p = byId.get(row.productId)
    if (!p) throw new Error(`Product ${row.productId} missing`)
    const qty = row.quantity
    const unitPrice = row.unitPrice
    const lineTotal = round2(unitPrice * qty)
    lines.push({
      product: p._id,
      name: p.name,
      quantity: qty,
      unitPrice,
      lineTotal,
    })
  }

  for (const row of normalized) {
    const qty = row.quantity
    const p = byId.get(row.productId)
    if (!productTracksInventory(p)) {
      continue
    }
    const updated = await Product.updateOne(
      { _id: row.productId, stock: { $gte: qty } },
      { $inc: { stock: -qty } },
    )
    if (updated.modifiedCount !== 1) {
      for (const a of applied) {
        await Product.updateOne({ _id: a.productId }, { $inc: { stock: a.quantity } })
      }
      throw new Error('Stock changed during lay-by completion')
    }
    applied.push({ productId: row.productId, quantity: qty })
  }

  const total = round2(lines.reduce((s, l) => s + l.lineTotal, 0))
  const openShift = tillCode ? await getOrCreateOpenShift(tillCode, userId) : null
  const sale = await Sale.create({
    cashier: userId,
    items: lines,
    total,
    paymentMethod: 'layby_complete',
    payment: { cashAmount: 0, cardAmount: 0 },
    layById: lb._id,
    tillCode: tillCode || undefined,
    shiftId: openShift?._id ?? undefined,
  })

  lb.status = 'completed'
  lb.balance = 0
  lb.completedSaleId = sale._id
  await lb.save()
}

export async function completeLayBy(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' })
      return
    }
    const lb = await LayBy.findById(req.params.id)
    if (!lb || lb.status !== 'active') {
      res.status(404).json({ message: 'Active lay-by not found' })
      return
    }
    if (lb.balance > 0.02) {
      res.status(400).json({ message: 'Balance must be cleared before completion' })
      return
    }
    const tillCode = normalizeTillCode((req.body ?? {}).tillCode)
    if ((req.body ?? {}).tillCode != null && !tillCode) {
      res.status(400).json({ message: 'Invalid tillCode (use letters, numbers, _, -; max 24)' })
      return
    }
    try {
      await completeLayByInternal(String(lb._id), req.user.id, tillCode || undefined)
    } catch (err) {
      res.status(409).json({ message: err instanceof Error ? err.message : 'Completion failed' })
      return
    }
    const out = await LayBy.findById(lb._id).lean()
    res.json(out)
  } catch (e) {
    next(e)
  }
}

export async function cancelLayBy(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' })
      return
    }
    const lb = await LayBy.findById(req.params.id)
    if (!lb || lb.status !== 'active') {
      res.status(404).json({ message: 'Active lay-by not found' })
      return
    }
    const body = req.body as {
      mode?: 'full_refund' | 'percent_refund' | 'store_credit'
      percent?: number
    }
    if (!body.mode) {
      res.status(400).json({ message: 'mode required' })
      return
    }
    const paid = lb.amountPaid
    let refundAmount = 0
    let storeCreditIssued = 0

    if (body.mode === 'full_refund') {
      refundAmount = paid
    } else if (body.mode === 'percent_refund') {
      const pct = Number(body.percent)
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        res.status(400).json({ message: 'percent required (0–100)' })
        return
      }
      refundAmount = round2((paid * pct) / 100)
    } else if (body.mode === 'store_credit') {
      storeCreditIssued = paid
      refundAmount = paid
    } else {
      res.status(400).json({ message: 'Invalid mode' })
      return
    }

    if (body.mode === 'store_credit' && storeCreditIssued > 0) {
      const phone = lb.phone
      let acct = await StoreCreditAccount.findOne({ phone })
      if (!acct) {
        acct = await StoreCreditAccount.create({
          phone,
          name: lb.customerName,
          balance: 0,
        })
      }
      acct.balance = round2((acct.balance ?? 0) + storeCreditIssued)
      await acct.save()
      await StoreCreditLedger.create({
        accountId: acct._id,
        phone,
        amount: storeCreditIssued,
        kind: 'issue',
        refType: 'layby_cancel',
        refId: lb._id,
        note: 'Lay-by cancellation',
        createdBy: new Types.ObjectId(String(req.user.id)),
      })
    }

    lb.status = 'cancelled'
    lb.cancellation = {
      mode: body.mode,
      percent: body.mode === 'percent_refund' ? Number(body.percent) : undefined,
      refundAmount,
      storeCreditIssued: body.mode === 'store_credit' ? storeCreditIssued : undefined,
      at: new Date(),
      by: new Types.ObjectId(String(req.user.id)),
    }
    await lb.save()
    const out = await LayBy.findById(lb._id).lean()
    res.json(out)
  } catch (e) {
    next(e)
  }
}

export async function listLayBysForAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const status = (req.query.status as string | undefined)?.trim()
    const limit = Math.min(Number(req.query.limit) || 100, 500)
    const filter: Record<string, unknown> = {}
    if (status && ['active', 'completed', 'cancelled'].includes(status)) {
      filter.status = status
    }
    const list = await LayBy.find(filter).sort({ createdAt: -1 }).limit(limit).lean()
    res.json(list)
  } catch (e) {
    next(e)
  }
}
