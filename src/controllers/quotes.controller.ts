import type { NextFunction, Request, Response } from 'express'
import { Types } from 'mongoose'
import { Product } from '../models/Product.js'
import { Quote } from '../models/Quote.js'
import { StoreSettings } from '../models/StoreSettings.js'
import { vatAmountFromInclusive } from './layby.controller.js'

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, '')
}

async function ensureSettings() {
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

/** One-time backfill of sequenceNumber + sync counter; then atomic increments only. */
let quoteSequenceReady = false

async function ensureQuoteSequenceReady(): Promise<void> {
  if (quoteSequenceReady) return

  const missing = await Quote.find({ sequenceNumber: { $exists: false } }).sort({ createdAt: 1 }).lean()
  if (missing.length > 0) {
    const used = new Set<number>()
    const existing = await Quote.find({ sequenceNumber: { $exists: true } }).select('sequenceNumber').lean()
    for (const x of existing) used.add(x.sequenceNumber)

    let last = 0
    const high = await Quote.findOne({ sequenceNumber: { $exists: true } }).sort({ sequenceNumber: -1 }).lean()
    if (high?.sequenceNumber) last = high.sequenceNumber

    for (const q of missing) {
      const m = /^QT-\d{4}-(\d+)$/.exec(q.quoteNumber)
      let seq = m ? parseInt(m[1], 10) : 0
      if (seq < 1 || used.has(seq)) {
        last += 1
        seq = last
      } else {
        last = Math.max(last, seq)
      }
      used.add(seq)
      await Quote.updateOne({ _id: q._id }, { $set: { sequenceNumber: seq } })
    }
  }

  const top = await Quote.findOne().sort({ sequenceNumber: -1 }).select('sequenceNumber').lean()
  const maxSeq = top?.sequenceNumber ?? 0
  await StoreSettings.updateOne({ _id: 'default' }, { $set: { nextQuoteSeq: maxSeq } }, { upsert: true })
  quoteSequenceReady = true
}

/** Call once after DB connect so legacy quotes get sequenceNumber before reads. */
export async function bootstrapQuoteSequences(): Promise<void> {
  await ensureQuoteSequenceReady()
}

type BodyLine = { productId?: string; quantity?: number; unitPrice?: number }

export async function createQuote(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' })
      return
    }
    const body = req.body as {
      customerName?: string
      phone?: string
      items?: BodyLine[]
    }
    const customerName = body.customerName?.trim() ?? ''
    const phoneNorm = body.phone ? normalizePhone(body.phone) : ''
    if (!body.items?.length) {
      res.status(400).json({ message: 'items required' })
      return
    }
    const settings = await ensureSettings()
    const vatRate = settings.vatRate ?? 0.14
    const role = req.user.role

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
      let unitPrice = catalog
      if (row.unitPrice !== undefined) {
        const requested = round2(row.unitPrice)
        if (!Number.isFinite(requested) || requested < 0) {
          res.status(400).json({ message: 'Invalid unitPrice' })
          return
        }
        if (requested > catalog && role !== 'admin') {
          res.status(403).json({ message: 'Only admins may quote above the catalog price' })
          return
        }
        unitPrice = requested
      }
      const qty = row.quantity as number
      const lineTotal = round2(unitPrice * qty)
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

    const totalInclVat = round2(lines.reduce((s, l) => s + l.lineTotal, 0))
    const totalVatAmount = round2(vatAmountFromInclusive(totalInclVat, vatRate))
    const totalNetAmount = round2(totalInclVat - totalVatAmount)

    await ensureQuoteSequenceReady()
    const st = await StoreSettings.findOneAndUpdate(
      { _id: 'default' },
      [{ $set: { nextQuoteSeq: { $add: [{ $ifNull: ['$nextQuoteSeq', 0] }, 1] } } }],
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).lean()
    const seq = st!.nextQuoteSeq
    const year = new Date().getFullYear()
    const quoteNumber = `QT-${year}-${String(seq).padStart(5, '0')}`

    const validUntil = new Date()
    validUntil.setDate(validUntil.getDate() + 7)

    const doc = await Quote.create({
      sequenceNumber: seq,
      quoteNumber,
      customerName,
      phone: phoneNorm,
      lines,
      vatRate,
      totalInclVat,
      totalVatAmount,
      totalNetAmount,
      validUntil,
      status: 'open',
      createdBy: new Types.ObjectId(String(req.user.id)),
    })

    const out = await Quote.findById(doc._id).lean()
    res.status(201).json(out)
  } catch (e) {
    next(e)
  }
}

export async function listQuotes(req: Request, res: Response, next: NextFunction) {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200)
    const phone = req.query.phone ? normalizePhone(String(req.query.phone)) : ''
    const q = String(req.query.q ?? '').trim()

    const filter: Record<string, unknown> = {}
    if (phone) filter.phone = phone
    if (q) {
      filter.$or = [
        { quoteNumber: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
        { customerName: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
      ]
    }

    const rows = await Quote.find(filter).sort({ createdAt: -1 }).limit(limit).lean()
    const now = Date.now()
    res.json(
      rows.map((r) => ({
        ...r,
        isExpired: new Date(r.validUntil).getTime() < now,
      })),
    )
  } catch (e) {
    next(e)
  }
}

export async function getQuote(req: Request, res: Response, next: NextFunction) {
  try {
    const id = req.params.id
    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ message: 'Invalid id' })
      return
    }
    const row = await Quote.findById(id).lean()
    if (!row) {
      res.status(404).json({ message: 'Quote not found' })
      return
    }
    const now = Date.now()
    res.json({
      ...row,
      isExpired: new Date(row.validUntil).getTime() < now,
    })
  } catch (e) {
    next(e)
  }
}

export async function cancelQuote(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' })
      return
    }
    const id = req.params.id
    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ message: 'Invalid id' })
      return
    }
    const updated = await Quote.findOneAndUpdate(
      { _id: id, status: 'open' },
      { $set: { status: 'cancelled' } },
      { new: true },
    ).lean()
    if (!updated) {
      res.status(400).json({ message: 'Quote cannot be cancelled' })
      return
    }
    res.json(updated)
  } catch (e) {
    next(e)
  }
}
