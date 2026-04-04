import type { Request, Response, NextFunction } from 'express'
import { Types } from 'mongoose'
import { reservedQtyByProduct } from './layby.controller.js'
import { OpenTab } from '../models/OpenTab.js'
import { Product } from '../models/Product.js'
import { Quote } from '../models/Quote.js'
import { HouseAccount, HouseAccountLedger } from '../models/HouseAccount.js'
import { Sale } from '../models/Sale.js'
import { StoreCreditAccount, StoreCreditLedger } from '../models/StoreCreditAccount.js'

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, '')
}

type BodyItem = { productId?: string; quantity?: number; unitPrice?: number }
type BodyPayment = {
  cashAmount?: number
  cardAmount?: number
  tenderedCash?: number
  changeDue?: number
}

export async function createSale(req: Request, res: Response, next: NextFunction) {
  try {
    const {
      items,
      paymentMethod,
      payment: paymentIn,
      clientLocalId: rawLocalId,
      openTabId: rawOpenTabId,
      storeCreditAmount: rawSc,
      storeCreditPhone: rawScPhone,
      quoteId: rawQuoteId,
      onAccountAmount: rawOnAccount,
      houseAccountId: rawHouseAccountId,
    } = req.body as {
      items?: BodyItem[]
      paymentMethod?: string
      payment?: BodyPayment
      clientLocalId?: string
      openTabId?: string
      storeCreditAmount?: number
      storeCreditPhone?: string
      quoteId?: string
      onAccountAmount?: number
      houseAccountId?: string
    }
    const openTabId = rawOpenTabId?.trim() || undefined
    const quoteIdRaw = typeof rawQuoteId === 'string' ? rawQuoteId.trim() : ''
    if (rawQuoteId !== undefined && rawQuoteId !== null && String(rawQuoteId).trim() !== '') {
      if (!Types.ObjectId.isValid(quoteIdRaw)) {
        res.status(400).json({ message: 'Invalid quoteId' })
        return
      }
    }
    const quoteId = quoteIdRaw && Types.ObjectId.isValid(quoteIdRaw) ? quoteIdRaw : undefined
    const clientLocalId = rawLocalId?.trim() || undefined
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' })
      return
    }
    if (!items?.length) {
      res.status(400).json({ message: 'items required' })
      return
    }

    if (quoteId && openTabId) {
      res.status(400).json({ message: 'Cannot combine quote checkout with open tab' })
      return
    }

    if (clientLocalId) {
      const existing = await Sale.findOne({ clientLocalId })
      if (existing) {
        res.status(200).json(existing)
        return
      }
    }

    const lines: {
      product: unknown
      name: string
      quantity: number
      unitPrice: number
      lineTotal: number
      sku?: string
    }[] = []

    // NOTE: MongoDB transactions require a replica set. For local dev setups running a standalone
    // mongod (common with a simple Docker run), we do a safe-ish non-transactional flow:
    // - read all products
    // - attempt conditional decrements (stock >= qty) in order
    // - if any decrement fails, roll back prior decrements
    const normalized = items.map((row) => ({
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
    const reserved = await reservedQtyByProduct()

    const role = req.user.role

    if (quoteId) {
      const quote = await Quote.findById(quoteId).lean()
      if (!quote) {
        res.status(400).json({ message: 'Quote not found' })
        return
      }
      if (quote.status !== 'open') {
        res.status(400).json({ message: 'Quote is no longer open' })
        return
      }
      if (new Date(quote.validUntil).getTime() < Date.now()) {
        res.status(400).json({ message: 'Quote has expired' })
        return
      }
      if (normalized.length !== quote.lines.length) {
        res.status(400).json({ message: 'Cart does not match quote lines' })
        return
      }
      for (let i = 0; i < normalized.length; i++) {
        const qLine = quote.lines[i]
        const row = normalized[i]
        if (String(qLine.productId) !== String(row.productId) || qLine.quantity !== row.quantity) {
          res.status(400).json({ message: 'Cart does not match quote lines' })
          return
        }
      }
      for (const qLine of quote.lines) {
        const p = byId.get(String(qLine.productId))
        if (!p) {
          res.status(400).json({ message: `Unknown product ${String(qLine.productId)}` })
          return
        }
        const rsv = reserved.get(String(p._id)) ?? 0
        const available = (p.stock ?? 0) - rsv
        if (available < qLine.quantity) {
          res.status(409).json({ message: `Insufficient stock for ${p.sku}` })
          return
        }
        lines.push({
          product: qLine.productId,
          sku: qLine.sku,
          name: qLine.name,
          quantity: qLine.quantity,
          unitPrice: qLine.unitPrice,
          lineTotal: qLine.lineTotal,
        })
      }
      const sumLines = round2(lines.reduce((s, l) => s + l.lineTotal, 0))
      if (Math.abs(sumLines - quote.totalInclVat) > 0.02) {
        res.status(400).json({ message: 'Quote totals are inconsistent' })
        return
      }
    } else {
      for (const row of normalized) {
        const p = byId.get(row.productId as string)
        if (!p) {
          res.status(400).json({ message: `Unknown product ${row.productId}` })
          return
        }
        const rsv = reserved.get(String(p._id)) ?? 0
        const available = (p.stock ?? 0) - rsv
        if (available < (row.quantity as number)) {
          res.status(409).json({ message: `Insufficient stock for ${p.sku}` })
          return
        }
        const catalog = Math.round((p.price ?? 0) * 100) / 100
        let unitPrice = catalog
        if (row.unitPrice !== undefined) {
          const requested = Math.round(row.unitPrice * 100) / 100
          if (!Number.isFinite(requested) || requested < 0) {
            res.status(400).json({ message: 'Invalid unitPrice' })
            return
          }
          if (requested > catalog && role !== 'admin') {
            res.status(403).json({ message: 'Only admins may charge above the catalog price' })
            return
          }
          unitPrice = requested
        }
        const qty = row.quantity as number
        const lineTotal = Math.round(unitPrice * qty * 100) / 100
        lines.push({
          product: p._id,
          name: p.name,
          quantity: qty,
          unitPrice,
          lineTotal,
        })
      }
    }

    const applied: Array<{ productId: string; quantity: number }> = []
    for (const row of normalized) {
      const qty = row.quantity as number
      const updated = await Product.updateOne(
        { _id: row.productId, stock: { $gte: qty } },
        { $inc: { stock: -qty } },
      )
      if (updated.modifiedCount !== 1) {
        // rollback prior decrements
        for (const a of applied) {
          await Product.updateOne({ _id: a.productId }, { $inc: { stock: a.quantity } })
        }
        const p = byId.get(row.productId as string)
        res.status(409).json({ message: `Insufficient stock for ${p?.sku ?? row.productId}` })
        return
      }
      applied.push({ productId: row.productId as string, quantity: qty })
    }

    const total = round2(lines.reduce((s, l) => s + l.lineTotal, 0))
    const cashAmount = Math.max(0, Number(paymentIn?.cashAmount ?? 0) || 0)
    const cardAmount = Math.max(0, Number(paymentIn?.cardAmount ?? 0) || 0)
    const tenderedCash =
      paymentIn?.tenderedCash === undefined ? undefined : Math.max(0, Number(paymentIn.tenderedCash) || 0)
    const changeDue =
      paymentIn?.changeDue === undefined ? undefined : Math.max(0, Number(paymentIn.changeDue) || 0)

    const storeCreditAmount = Math.max(0, Number(rawSc ?? 0) || 0)
    const scPhone = rawScPhone ? normalizePhone(String(rawScPhone)) : ''
    if (storeCreditAmount > 0) {
      if (!scPhone) {
        res.status(400).json({ message: 'storeCreditPhone required when using store credit' })
        return
      }
      const acct = await StoreCreditAccount.findOne({ phone: scPhone }).lean()
      if (!acct || (acct.balance ?? 0) < storeCreditAmount - 0.01) {
        res.status(400).json({ message: 'Insufficient store credit' })
        return
      }
    }

    const onAccountAmount = round2(Math.max(0, Number(rawOnAccount ?? 0) || 0))
    const houseAccountIdStr =
      typeof rawHouseAccountId === 'string' ? rawHouseAccountId.trim() : ''
    let houseAccountMeta: { id: Types.ObjectId; accountNumber: string; name: string } | null = null
    if (onAccountAmount > 0.005) {
      if (!houseAccountIdStr || !Types.ObjectId.isValid(houseAccountIdStr)) {
        res.status(400).json({ message: 'houseAccountId required when charging on account' })
        return
      }
      const ha = await HouseAccount.findById(houseAccountIdStr).lean()
      if (!ha || ha.status !== 'active') {
        res.status(400).json({ message: 'House account not found or closed' })
        return
      }
      const nextBal = round2((ha.balance ?? 0) + onAccountAmount)
      if (ha.creditLimit != null && nextBal > round2(ha.creditLimit) + 0.02) {
        res.status(400).json({ message: 'Would exceed house account credit limit' })
        return
      }
      houseAccountMeta = {
        id: new Types.ObjectId(houseAccountIdStr),
        accountNumber: ha.accountNumber,
        name: typeof ha.name === 'string' ? ha.name.trim() : '',
      }
    }

    const covered = round2(cashAmount + cardAmount + storeCreditAmount + onAccountAmount)
    if (Math.abs(covered - total) > 0.02) {
      res.status(400).json({ message: 'Payment total must match sale total' })
      return
    }

    const payment = covered > 0 ? { cashAmount, cardAmount, tenderedCash, changeDue } : undefined
    const hasCash = cashAmount > 0.005
    const hasCard = cardAmount > 0.005
    const hasSc = storeCreditAmount > 0.005
    const hasOa = onAccountAmount > 0.005
    const tenderKinds = [hasCash, hasCard, hasSc, hasOa].filter(Boolean).length
    const resolvedMethod =
      paymentMethod?.trim() ||
      (covered > 0
        ? tenderKinds >= 2 || (hasCash && hasCard)
          ? 'split'
          : hasOa && !hasCash && !hasCard && !hasSc
            ? 'on_account'
            : hasSc && !hasCash && !hasCard && !hasOa
              ? 'store_credit'
              : hasCard && !hasCash && !hasSc && !hasOa
                ? 'card'
                : 'cash'
        : undefined)

    const sale = await Sale.create({
      cashier: req.user.id,
      items: lines,
      total,
      paymentMethod: resolvedMethod,
      payment,
      clientLocalId: clientLocalId || undefined,
      storeCreditAmount: storeCreditAmount > 0 ? storeCreditAmount : undefined,
      quoteId: quoteId ? new Types.ObjectId(quoteId) : undefined,
      onAccountAmount: hasOa ? onAccountAmount : undefined,
      houseAccountId: hasOa && houseAccountMeta ? houseAccountMeta.id : undefined,
      houseAccountNumber: hasOa && houseAccountMeta ? houseAccountMeta.accountNumber : undefined,
      houseAccountName: hasOa && houseAccountMeta?.name ? houseAccountMeta.name : undefined,
    })

    if (quoteId) {
      const updated = await Quote.findOneAndUpdate(
        { _id: quoteId, status: 'open', validUntil: { $gte: new Date() } },
        { $set: { status: 'converted', convertedSaleId: sale._id } },
        { new: true },
      ).lean()
      if (!updated) {
        await Sale.deleteOne({ _id: sale._id })
        for (const a of applied) {
          await Product.updateOne({ _id: a.productId }, { $inc: { stock: a.quantity } })
        }
        res.status(409).json({ message: 'Quote was already converted or cancelled' })
        return
      }
    }

    if (storeCreditAmount > 0 && scPhone) {
      const acct = await StoreCreditAccount.findOne({ phone: scPhone })
      if (!acct) {
        res.status(500).json({ message: 'Store credit account missing' })
        return
      }
      acct.balance = Math.round((acct.balance - storeCreditAmount) * 100) / 100
      if (acct.balance < 0) acct.balance = 0
      await acct.save()
      await StoreCreditLedger.create({
        accountId: acct._id,
        phone: scPhone,
        amount: -storeCreditAmount,
        kind: 'redeem',
        refType: 'sale',
        refId: sale._id,
        note: 'Sale checkout',
        createdBy: req.user.id,
      })
    }

    if (hasOa && houseAccountMeta) {
      await HouseAccount.updateOne({ _id: houseAccountMeta.id }, { $inc: { balance: onAccountAmount } })
      await HouseAccountLedger.create({
        houseAccountId: houseAccountMeta.id,
        accountNumber: houseAccountMeta.accountNumber,
        kind: 'charge',
        amount: onAccountAmount,
        saleId: sale._id,
        createdBy: req.user.id,
      })
    }

    if (openTabId) {
      await OpenTab.findOneAndUpdate(
        { _id: openTabId, status: 'open' },
        { $set: { status: 'closed', closedSaleId: sale._id, lines: [] } },
      )
    }

    res.status(201).json(sale)
  } catch (e) {
    next(e)
  }
}

export async function listSales(req: Request, res: Response, next: NextFunction) {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200)
    const sales = await Sale.find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('cashier', 'email role')
      .lean()
    res.json(sales)
  } catch (e) {
    next(e)
  }
}
