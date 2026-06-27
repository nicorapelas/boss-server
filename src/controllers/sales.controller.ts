import { randomBytes } from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'
import mongoose, { type ClientSession, Types } from 'mongoose'
import { reservedQtyByProduct } from './layby.controller.js'
import { OpenTab } from '../models/OpenTab.js'
import { Product } from '../models/Product.js'
import { Quote } from '../models/Quote.js'
import { HouseAccount, HouseAccountLedger } from '../models/HouseAccount.js'
import { OfflineSyncConflict } from '../models/OfflineSyncConflict.js'
import { Sale } from '../models/Sale.js'
import { SaleRefund } from '../models/SaleRefund.js'
import type { SaleExchangeSettlementKind } from '../models/SaleExchange.js'
import { saleReturnProgress } from '../services/saleReturnProgress.js'
import {
  ExchangeError,
  exchangeEligibilityForSale,
  performSaleExchange,
} from '../services/saleExchange.service.js'
import { StoreCreditAccount, StoreCreditLedger } from '../models/StoreCreditAccount.js'
import { hasPermission } from '../permissions/catalog.js'
import { getOrCreateOpenShift } from './shifts.controller.js'
import { parseCashierSignInMethod } from '../utils/cashierSignInMethod.js'
import { canChargeAboveCatalogPrice } from '../utils/requestAuth.js'
import { productTracksInventory } from '../utils/productInventory.js'
import {
  canApplyManagerStockOverride,
  saleNeedsStockOverride,
  shouldRelaxStockDecrement,
} from '../utils/managerStockOverride.js'
import { maybeAutoClockOutOnSale } from '../services/attendance.service.js'
import { userHasRegisterManager } from '../utils/userPermissions.js'
import { expandForProduct, productHasVolumeTiering } from '../utils/volumePrice.js'
import {
  resolveCashierSoldByContext,
  soldByFieldsForProduct,
} from '../services/soldBySale.service.js'
import { LoyaltyMember } from '../models/LoyaltyMember.js'
import {
  applyLoyaltyOnSale,
  ensureLoyaltyAppliedForSale,
  maskPhone,
  planLoyaltyForSale,
  reverseLoyaltyForRefund,
} from '../services/loyalty.service.js'
import { ensureStoreSettingsDoc } from './storeSettings.controller.js'
import { cashRoundingFromSettings, computeCashPaymentLeg } from '../utils/cashRounding.js'
import type { IStoreSettings } from '../models/StoreSettings.js'

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

async function appendLoyaltyResponseFields(
  payload: Record<string, unknown>,
  sale: {
    loyaltyMemberId?: Types.ObjectId | null
    loyaltyPhone?: string | null
    loyaltyPointsEarned?: number
    loyaltyPointsRedeemed?: number
    loyaltyDiscountAmount?: number
  },
) {
  if (!sale.loyaltyMemberId && !sale.loyaltyPhone) return
  const phone = sale.loyaltyPhone ? normalizePhone(String(sale.loyaltyPhone)) : ''
  if (phone) payload.loyaltyPhoneMasked = maskPhone(phone)
  if (sale.loyaltyMemberId) {
    const memberAfter = await LoyaltyMember.findById(sale.loyaltyMemberId).select('pointsBalance').lean()
    payload.loyaltyPointsBalanceAfter = Math.max(0, Math.floor(Number(memberAfter?.pointsBalance ?? 0)))
  }
  if (sale.loyaltyPointsEarned != null) payload.loyaltyPointsEarned = sale.loyaltyPointsEarned
  if (sale.loyaltyPointsRedeemed != null) payload.loyaltyPointsRedeemed = sale.loyaltyPointsRedeemed
  if (sale.loyaltyDiscountAmount != null) payload.loyaltyDiscountAmount = sale.loyaltyDiscountAmount
}

function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, '')
}

function normalizeTillCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim().toUpperCase()
  if (!v) return null
  if (!/^[A-Z0-9_-]{1,24}$/.test(v)) return null
  return v
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const SALE_ID_HEX_LEN = 10

function isObjectId24(s: string): boolean {
  return s.length === 24 && Types.ObjectId.isValid(s)
}

function isShortSaleId(s: string): boolean {
  return new RegExp(`^[a-f0-9]{${SALE_ID_HEX_LEN}}$`, 'i').test(s)
}

function isValidSaleRouteParam(s: string): boolean {
  return isObjectId24(s) || isShortSaleId(s)
}

/** 10 hex chars, lowercase — unique by retry. */
async function allocateUniqueSaleId(): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const saleId = randomBytes(5).toString('hex')
    if (saleId.length !== SALE_ID_HEX_LEN) continue
    // eslint-disable-next-line no-await-in-loop
    const exists = await Sale.exists({ saleId })
    if (!exists) return saleId
  }
  throw new Error('Failed to allocate sale id')
}

/** Builds Mongo filter for GET /sales list (date range, payment, refund, search). */
function buildSaleListFilter(query: Request['query']): { filter: Record<string, unknown>; error?: string } {
  const conditions: Record<string, unknown>[] = []

  const fromRaw = typeof query.from === 'string' ? query.from.trim() : ''
  const toRaw = typeof query.to === 'string' ? query.to.trim() : ''
  if (fromRaw || toRaw) {
    const r: { $gte?: Date; $lte?: Date } = {}
    if (fromRaw) {
      const d = new Date(fromRaw)
      if (Number.isNaN(d.getTime())) return { filter: {}, error: 'Invalid from date' }
      r.$gte = d
    }
    if (toRaw) {
      const d = new Date(toRaw)
      if (Number.isNaN(d.getTime())) return { filter: {}, error: 'Invalid to date' }
      r.$lte = d
    }
    if (Object.keys(r).length) conditions.push({ createdAt: r })
  }

  const pm = typeof query.paymentMethod === 'string' ? query.paymentMethod.trim() : ''
  if (pm) conditions.push({ paymentMethod: pm })
  const tillCode = normalizeTillCode(query.tillCode)
  if (typeof query.tillCode === 'string' && !tillCode) return { filter: {}, error: 'Invalid tillCode' }
  if (tillCode) conditions.push({ tillCode })

  const refund = typeof query.refund === 'string' ? query.refund.trim().toLowerCase() : ''
  if (refund === 'yes') conditions.push({ refundStatus: 'refunded' })
  if (refund === 'no') {
    conditions.push({
      $or: [
        { refundStatus: { $exists: false } },
        { refundStatus: null },
        { refundStatus: { $ne: 'refunded' } },
      ],
    })
  }
  const stockOverride = typeof query.stockOverride === 'string' ? query.stockOverride.trim().toLowerCase() : ''
  if (stockOverride === 'yes') conditions.push({ 'items.stockOverrideApproved': true })
  if (stockOverride === 'no') {
    conditions.push({
      $or: [
        { 'items.stockOverrideApproved': { $exists: false } },
        { items: { $not: { $elemMatch: { stockOverrideApproved: true } } } },
      ],
    })
  }

  const qRaw = typeof query.q === 'string' ? query.q.trim() : ''
  if (qRaw) {
    if (isObjectId24(qRaw)) {
      conditions.push({ _id: new Types.ObjectId(qRaw) })
    } else if (isShortSaleId(qRaw)) {
      conditions.push({ saleId: qRaw.toLowerCase() })
    } else if (/^[a-f0-9]{4,23}$/i.test(qRaw)) {
      conditions.push({
        $expr: {
          $regexMatch: {
            input: { $toString: '$_id' },
            regex: `^${escapeRegex(qRaw)}`,
            options: 'i',
          },
        },
      })
    } else if (/^\d{3,}$/.test(qRaw)) {
      const n = Number(qRaw)
      if (Number.isFinite(n) && n >= 0) conditions.push({ 'legacy.receiptNo': n })
    } else {
      conditions.push({ 'items.name': { $regex: new RegExp(escapeRegex(qRaw), 'i') } })
    }
  }

  const filter =
    conditions.length === 0 ? {} : conditions.length === 1 ? conditions[0]! : { $and: conditions }
  return { filter }
}

type BodyItem = {
  productId?: string
  quantity?: number
  unitPrice?: number
  listUnitPrice?: number
  stockOverrideApproved?: boolean
  stockOverrideScope?: 'offline' | 'online'
  stockOverrideAvailableQty?: number
  stockOverrideApprovedByUserId?: string
  stockOverrideApprovedByDisplayName?: string
  addedByUserId?: string
  addedByDisplayName?: string
  addedAt?: string
}
function saleStockOverrideFields(row: {
  stockOverrideApproved?: boolean
  stockOverrideScope?: 'offline' | 'online'
  stockOverrideAvailableQty?: number
  stockOverrideApprovedByUserId?: Types.ObjectId
  stockOverrideApprovedByDisplayName?: string
}) {
  if (row.stockOverrideApproved !== true) return {}
  return {
    stockOverrideApproved: true as const,
    stockOverrideScope: row.stockOverrideScope,
    stockOverrideAvailableQty: row.stockOverrideAvailableQty,
    ...(row.stockOverrideApprovedByUserId
      ? { stockOverrideApprovedByUserId: row.stockOverrideApprovedByUserId }
      : {}),
    ...(row.stockOverrideApprovedByDisplayName
      ? { stockOverrideApprovedByDisplayName: row.stockOverrideApprovedByDisplayName }
      : {}),
  }
}

function stockOverrideApproverFromBodyItem(row: BodyItem): {
  stockOverrideApprovedByUserId?: Types.ObjectId
  stockOverrideApprovedByDisplayName?: string
} {
  if (row.stockOverrideApproved !== true) return {}
  let stockOverrideApprovedByUserId: Types.ObjectId | undefined
  if (
    typeof row.stockOverrideApprovedByUserId === 'string' &&
    Types.ObjectId.isValid(row.stockOverrideApprovedByUserId)
  ) {
    stockOverrideApprovedByUserId = new Types.ObjectId(row.stockOverrideApprovedByUserId)
  }
  const dn =
    typeof row.stockOverrideApprovedByDisplayName === 'string'
      ? row.stockOverrideApprovedByDisplayName.trim().slice(0, 120)
      : ''
  return {
    ...(stockOverrideApprovedByUserId ? { stockOverrideApprovedByUserId } : {}),
    ...(dn ? { stockOverrideApprovedByDisplayName: dn } : {}),
  }
}

function lineAttributionFromBodyItem(row: BodyItem): {
  addedByUserId?: Types.ObjectId
  addedByDisplayName?: string
  addedAt?: Date
} {
  let addedByUserId: Types.ObjectId | undefined
  if (typeof row.addedByUserId === 'string' && Types.ObjectId.isValid(row.addedByUserId)) {
    addedByUserId = new Types.ObjectId(row.addedByUserId)
  }
  const dn = typeof row.addedByDisplayName === 'string' ? row.addedByDisplayName.trim().slice(0, 120) : ''
  const addedByDisplayName = dn || undefined
  let addedAt: Date | undefined
  if (typeof row.addedAt === 'string' && row.addedAt.trim()) {
    const d = new Date(row.addedAt)
    if (!Number.isNaN(d.getTime())) addedAt = d
  }
  return { addedByUserId, addedByDisplayName, addedAt }
}

function saleLineAttributionFields(row: {
  addedByUserId?: Types.ObjectId
  addedByDisplayName?: string
  addedAt?: Date
}): {
  addedByUserId?: Types.ObjectId
  addedByDisplayName?: string
  addedAt?: Date
} {
  return {
    ...(row.addedByUserId ? { addedByUserId: row.addedByUserId } : {}),
    ...(row.addedByDisplayName ? { addedByDisplayName: row.addedByDisplayName } : {}),
    ...(row.addedAt ? { addedAt: row.addedAt } : {}),
  }
}
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
      purchaseOrderNumber: rawPoNumber,
      tillCode: rawTillCode,
      loyaltyPhone: rawLoyaltyPhone,
      loyaltyPointsRedeem: rawLoyaltyPointsRedeem,
      cashierSignInMethod: rawCashierSignInMethod,
      cashRoundingAdjustment: rawCashRoundingAdjustment,
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
      purchaseOrderNumber?: string
      tillCode?: string
      loyaltyPhone?: string
      loyaltyPointsRedeem?: number
      cashierSignInMethod?: string
      cashRoundingAdjustment?: number
    }
    const cashierSignInMethod = parseCashierSignInMethod(rawCashierSignInMethod)
    if (rawCashierSignInMethod != null && String(rawCashierSignInMethod).trim() !== '' && !cashierSignInMethod) {
      res.status(400).json({ message: 'Invalid cashierSignInMethod' })
      return
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
    const tillCode = normalizeTillCode(rawTillCode)
    if (rawTillCode != null && !tillCode) {
      res.status(400).json({ message: 'Invalid tillCode (use letters, numbers, _, -; max 24)' })
      return
    }
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' })
      return
    }
    const userId = String(req.user.id)
    if (!items?.length) {
      res.status(400).json({ message: 'items required' })
      return
    }

    if (quoteId && openTabId) {
      res.status(400).json({ message: 'Cannot combine quote checkout with open tab' })
      return
    }

    if (clientLocalId) {
      const existing = await Sale.findOne({ clientLocalId }).lean()
      if (existing) {
        try {
          await ensureLoyaltyAppliedForSale(existing, userId)
        } catch (loyaltyRetryErr) {
          const msg = loyaltyRetryErr instanceof Error ? loyaltyRetryErr.message : ''
          if (msg === 'INSUFFICIENT_LOYALTY_POINTS') {
            res.status(400).json({ message: 'Insufficient loyalty points' })
            return
          }
          throw loyaltyRetryErr
        }
        const payload: Record<string, unknown> = { ...existing }
        await appendLoyaltyResponseFields(payload, existing)
        res.status(200).json(payload)
        return
      }
    }

    const lines: {
      product?: unknown
      name: string
      quantity: number
      unitPrice: number
      listUnitPrice?: number
      stockOverrideApproved?: boolean
      stockOverrideScope?: 'offline' | 'online'
      stockOverrideAvailableQty?: number
      lineTotal: number
      sku?: string
      addedByUserId?: Types.ObjectId
      addedByDisplayName?: string
      addedAt?: Date
      soldByUserId?: Types.ObjectId
      soldByDisplayName?: string
    }[] = []

    // NOTE: MongoDB transactions require a replica set. For local dev setups running a standalone
    // mongod (common with a simple Docker run), we do a safe-ish non-transactional flow:
    // - read all products
    // - attempt conditional decrements (stock >= qty) in order
    // - if any decrement fails, roll back prior decrements
    const normalized = items.map((row) => {
      const stockOverrideScope: 'offline' | 'online' | undefined =
        row.stockOverrideScope === 'offline' ? 'offline' : row.stockOverrideScope === 'online' ? 'online' : undefined
      const attr = lineAttributionFromBodyItem(row)
      const overrideApprover = stockOverrideApproverFromBodyItem(row)
      return {
        productId: row.productId,
        quantity: row.quantity,
        unitPrice: row.unitPrice !== undefined ? Number(row.unitPrice) : undefined,
        listUnitPrice: row.listUnitPrice !== undefined ? Number(row.listUnitPrice) : undefined,
        stockOverrideApproved: row.stockOverrideApproved === true,
        stockOverrideScope,
        stockOverrideAvailableQty:
          row.stockOverrideAvailableQty !== undefined && Number.isFinite(Number(row.stockOverrideAvailableQty))
            ? round2(Math.max(0, Number(row.stockOverrideAvailableQty)))
            : undefined,
        ...overrideApprover,
        addedByUserId: attr.addedByUserId,
        addedByDisplayName: attr.addedByDisplayName,
        addedAt: attr.addedAt,
      }
    })
    const canManagerOverrideStock = await userHasRegisterManager(
      userId,
      req.user.permissions,
      req.user.role,
    )
    for (const row of normalized) {
      if (!row.productId || !row.quantity || row.quantity < 1) {
        res.status(400).json({ message: 'Each item needs productId and quantity >= 1' })
        return
      }
    }

    const ids = normalized.map((r) => r.productId as string)
    const products = await Product.find({ _id: { $in: ids } }).lean()
    const byId = new Map(products.map((p) => [String(p._id), p]))
    const cashierSoldBy = await resolveCashierSoldByContext(userId)
    const reserved = await reservedQtyByProduct()

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
      for (let i = 0; i < quote.lines.length; i++) {
        const qLine = quote.lines[i]
        const row = normalized[i]
        const p = byId.get(String(qLine.productId))
        if (!p) {
          res.status(400).json({ message: `Unknown product ${String(qLine.productId)}` })
          return
        }
        if (productTracksInventory(p)) {
          const rsv = reserved.get(String(p._id)) ?? 0
          const available = (p.stock ?? 0) - rsv
          const canUseOverride = canApplyManagerStockOverride(
            row ?? {},
            available,
            qLine.quantity,
            canManagerOverrideStock,
          )
          if (saleNeedsStockOverride(available, qLine.quantity) && !canUseOverride) {
            res.status(409).json({ message: `Insufficient stock for ${p.sku}` })
            return
          }
        }
        lines.push({
          product: qLine.productId,
          sku: qLine.sku,
          name: qLine.name,
          quantity: qLine.quantity,
          unitPrice: qLine.unitPrice,
          ...saleStockOverrideFields(row ?? {}),
          listUnitPrice:
            qLine.listUnitPrice !== undefined && Math.abs(qLine.listUnitPrice - qLine.unitPrice) > 0.0001
              ? qLine.listUnitPrice
              : undefined,
          lineTotal: qLine.lineTotal,
          ...soldByFieldsForProduct(p, cashierSoldBy),
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
        if (productTracksInventory(p)) {
          const rsv = reserved.get(String(p._id)) ?? 0
          const available = (p.stock ?? 0) - rsv
          const qty = row.quantity as number
          const canUseOverride = canApplyManagerStockOverride(
            row,
            available,
            qty,
            canManagerOverrideStock,
          )
          if (saleNeedsStockOverride(available, qty) && !canUseOverride) {
            res.status(409).json({ message: `Insufficient stock for ${p.sku}` })
            return
          }
        }
        const catalog = Math.round((p.price ?? 0) * 100) / 100
        const qty = row.quantity as number
        if (productHasVolumeTiering(p)) {
          const segments = expandForProduct(p, qty)
          for (const seg of segments) {
            lines.push({
              product: p._id,
              sku: p.sku,
              name: p.name,
              quantity: seg.quantity,
              unitPrice: seg.unitPrice,
              ...saleStockOverrideFields(row),
              lineTotal: seg.lineTotal,
              ...saleLineAttributionFields(row),
              ...soldByFieldsForProduct(p, cashierSoldBy),
            })
          }
        } else {
          let unitPrice = catalog
          if (row.unitPrice !== undefined) {
            const requested = Math.round(row.unitPrice * 100) / 100
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
          const lineTotal = Math.round(unitPrice * qty * 100) / 100
          const listUnitPrice =
            row.listUnitPrice !== undefined && Number.isFinite(row.listUnitPrice)
              ? Math.round(row.listUnitPrice * 100) / 100
              : catalog
          lines.push({
            product: p._id,
            sku: p.sku,
            name: p.name,
            quantity: qty,
            unitPrice,
            listUnitPrice: Math.abs(listUnitPrice - unitPrice) > 0.0001 ? listUnitPrice : undefined,
            ...saleStockOverrideFields(row),
            lineTotal,
            ...saleLineAttributionFields(row),
            ...soldByFieldsForProduct(p, cashierSoldBy),
          })
        }
      }
    }

    if (!quoteId && openTabId) {
      const tab = await OpenTab.findOne({ _id: openTabId, status: 'open' })
        .select({ kind: 1 })
        .lean()
      if (tab?.kind === 'job_card') {
        for (const row of normalized) {
          const p = byId.get(row.productId as string)
          if (!p) continue
          const per = p.jobCardLabourPerUnit
          if (per == null || !Number.isFinite(per) || per <= 0.0001) continue
          const qty = row.quantity as number
          const lab = round2(per * qty)
          if (lab <= 0.0001) continue
          lines.push({
            name: `Labour — ${p.name}`,
            quantity: 1,
            unitPrice: lab,
            lineTotal: lab,
            sku: p.sku,
          })
        }
      }
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
    const purchaseOrderNumber = typeof rawPoNumber === 'string' ? rawPoNumber.trim().slice(0, 120) : ''
    if (onAccountAmount > 0.005) {
      if (!houseAccountIdStr || !Types.ObjectId.isValid(houseAccountIdStr)) {
        res.status(400).json({ message: 'houseAccountId required when charging on account' })
        return
      }
      if (!purchaseOrderNumber) {
        res.status(400).json({ message: 'purchaseOrderNumber required when charging on account' })
        return
      }
      // Fail fast before any checkout side effects (stock updates, shift creation, ledgers, sale create).
      const account = await HouseAccount.findOne({
        _id: new Types.ObjectId(houseAccountIdStr),
        status: 'active',
      })
        .select({ balance: 1, creditLimit: 1 })
        .lean()
      if (!account) {
        res.status(400).json({ message: 'House account not found, closed, or would exceed credit limit' })
        return
      }
      const currentBalance = Number(account.balance ?? 0)
      const creditLimit = account.creditLimit === null || account.creditLimit === undefined ? null : Number(account.creditLimit)
      if (creditLimit !== null && currentBalance + onAccountAmount > creditLimit + 0.01) {
        res.status(400).json({ message: 'House account not found, closed, or would exceed credit limit' })
        return
      }
    }

    const loyaltyPhoneInput = rawLoyaltyPhone ? normalizePhone(String(rawLoyaltyPhone)) : ''
    let loyaltyPlan: Awaited<ReturnType<typeof planLoyaltyForSale>> = null
    if (loyaltyPhoneInput) {
      try {
        loyaltyPlan = await planLoyaltyForSale({
          phone: loyaltyPhoneInput,
          saleTotal: total,
          pointsToRedeem: Math.max(0, Math.floor(Number(rawLoyaltyPointsRedeem ?? 0) || 0)),
          earnEligible: onAccountAmount <= 0.005,
        })
      } catch (loyaltyErr) {
        const msg = loyaltyErr instanceof Error ? loyaltyErr.message : ''
        if (msg === 'LOYALTY_MIN_REDEEM') {
          res.status(400).json({ message: 'Minimum loyalty points not met for redemption' })
          return
        }
        if (msg === 'LOYALTY_BLOCKED') {
          res.status(400).json({ message: 'Loyalty account is blocked' })
          return
        }
        if (msg === 'INVALID_PHONE') {
          res.status(400).json({ message: 'Invalid loyalty phone number' })
          return
        }
        throw loyaltyErr
      }
    }
    const loyaltyDiscountAmount = loyaltyPlan?.loyaltyDiscountAmount ?? 0

    const settingsDoc = await ensureStoreSettingsDoc()
    const roundingConfig = cashRoundingFromSettings(settingsDoc as unknown as IStoreSettings)
    const paymentLeg = computeCashPaymentLeg({
      merchandiseTotal: total,
      loyaltyDiscount: loyaltyDiscountAmount,
      storeCredit: storeCreditAmount,
      onAccount: onAccountAmount,
      cardAmount,
      config: roundingConfig,
    })
    const expectedAdjustment = paymentLeg.cashRoundingAdjustment
    const clientAdjustment = round2(Number(rawCashRoundingAdjustment ?? 0))

    if (paymentLeg.cashAmount > 0.005) {
      if (roundingConfig.enabled) {
        if (Math.abs(clientAdjustment - expectedAdjustment) > 0.02) {
          res.status(400).json({ message: 'Cash rounding adjustment mismatch' })
          return
        }
      } else if (Math.abs(clientAdjustment) > 0.005) {
        res.status(400).json({ message: 'Cash rounding is disabled' })
        return
      }
      if (Math.abs(cashAmount - paymentLeg.cashAmount) > 0.02) {
        res.status(400).json({ message: 'Cash amount does not match payable total' })
        return
      }
    } else if (Math.abs(clientAdjustment) > 0.005) {
      res.status(400).json({ message: 'Cash rounding not applicable for this sale' })
      return
    }
    if (cardAmount > 0.005 && Math.abs(cardAmount - paymentLeg.cardAmount) > 0.02) {
      res.status(400).json({ message: 'Card amount does not match payable total' })
      return
    }

    const covered = round2(cashAmount + cardAmount + storeCreditAmount + onAccountAmount + loyaltyDiscountAmount)
    const payableTotal = round2(total + expectedAdjustment)
    if (Math.abs(covered - payableTotal) > 0.02) {
      res.status(400).json({ message: 'Payment total must match sale total' })
      return
    }
    if (onAccountAmount > 0.005) {
      const nonAccountCovered = round2(cashAmount + cardAmount + storeCreditAmount)
      if (Math.abs(onAccountAmount - total) > 0.02 || nonAccountCovered > 0.02) {
        res.status(400).json({
          message: 'On-account sales must be fully on account. Take an account payment first to increase available credit.',
        })
        return
      }
    }

    const payment = covered > 0 ? { cashAmount, cardAmount, tenderedCash, changeDue } : undefined
    const hasCash = cashAmount > 0.005
    const hasCard = cardAmount > 0.005
    const hasSc = storeCreditAmount > 0.005
    const hasOa = onAccountAmount > 0.005
    const hasLoyalty = loyaltyDiscountAmount > 0.005
    const tenderKinds = [hasCash, hasCard, hasSc, hasOa, hasLoyalty].filter(Boolean).length
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

    const shortId = await allocateUniqueSaleId()
    const openShift = tillCode ? await getOrCreateOpenShift(tillCode, userId) : null
    let sale: { _id: Types.ObjectId } | null = null
    const performCheckout = async (session?: ClientSession) => {
        for (const row of normalized) {
          const qty = row.quantity as number
          const prod = byId.get(row.productId as string)
          if (!productTracksInventory(prod)) continue
          const rsv = reserved.get(String(row.productId)) ?? 0
          const available = (prod?.stock ?? 0) - rsv
          const relaxDecrement = shouldRelaxStockDecrement(
            row,
            available,
            qty,
            canManagerOverrideStock,
          )
          const stockFilter = relaxDecrement
            ? { _id: row.productId }
            : { _id: row.productId, stock: { $gte: qty } }
          const updated = await Product.updateOne(
            stockFilter,
            { $inc: { stock: -qty } },
            session ? { session } : undefined,
          )
          if (updated.modifiedCount !== 1) {
            const p = byId.get(row.productId as string)
            throw new Error(`INSUFFICIENT_STOCK:${p?.sku ?? row.productId}`)
          }
        }

        let houseAccountMeta: { id: Types.ObjectId; accountNumber: string; name: string } | null = null
        if (hasOa && houseAccountIdStr) {
          const updatedAccount = await HouseAccount.findOneAndUpdate(
            {
              _id: new Types.ObjectId(houseAccountIdStr),
              status: 'active',
              $expr: {
                $or: [
                  { $eq: ['$creditLimit', null] },
                  { $lte: [{ $add: ['$balance', onAccountAmount] }, '$creditLimit'] },
                ],
              },
            },
            { $inc: { balance: onAccountAmount } },
            session ? { new: true, session } : { new: true },
          ).lean()
          if (!updatedAccount) throw new Error('HOUSE_ACCOUNT_LIMIT_OR_STATUS')
          houseAccountMeta = {
            id: new Types.ObjectId(String(updatedAccount._id)),
            accountNumber: updatedAccount.accountNumber,
            name: typeof updatedAccount.name === 'string' ? updatedAccount.name.trim() : '',
          }
        }

        let storeCreditMeta: { id: Types.ObjectId; phone: string } | null = null
        if (storeCreditAmount > 0 && scPhone) {
          const acct = await StoreCreditAccount.findOneAndUpdate(
            { phone: scPhone, balance: { $gte: storeCreditAmount - 0.01 } },
            { $inc: { balance: -storeCreditAmount } },
            session ? { new: true, session } : { new: true },
          ).lean()
          if (!acct) throw new Error('INSUFFICIENT_STORE_CREDIT')
          storeCreditMeta = {
            id: new Types.ObjectId(String(acct._id)),
            phone: scPhone,
          }
        }

        const created = await Sale.create(
          [
            {
              saleId: shortId,
              cashier: userId,
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
              purchaseOrderNumber: hasOa ? purchaseOrderNumber : undefined,
              tillCode: tillCode || undefined,
              shiftId: openShift?._id ?? undefined,
              cashierSignInMethod: cashierSignInMethod ?? undefined,
              loyaltyPhone: loyaltyPlan?.phone,
              loyaltyMemberId: loyaltyPlan?.memberId,
              loyaltyPointsEarned: loyaltyPlan && loyaltyPlan.pointsEarned > 0 ? loyaltyPlan.pointsEarned : undefined,
              loyaltyPointsRedeemed:
                loyaltyPlan && loyaltyPlan.pointsRedeemed > 0 ? loyaltyPlan.pointsRedeemed : undefined,
              loyaltyDiscountAmount: loyaltyDiscountAmount > 0 ? loyaltyDiscountAmount : undefined,
              cashRoundingAdjustment:
                Math.abs(expectedAdjustment) > 0.005 ? expectedAdjustment : undefined,
            },
          ],
          session ? { session } : undefined,
        )
        sale = created[0] ?? null
        if (!sale) throw new Error('SALE_CREATE_FAILED')

        if (loyaltyPlan) {
          await applyLoyaltyOnSale(loyaltyPlan, sale._id, userId, session)
        }

        if (quoteId) {
          const updated = await Quote.findOneAndUpdate(
            { _id: quoteId, status: 'open', validUntil: { $gte: new Date() } },
            { $set: { status: 'converted', convertedSaleId: sale._id } },
            session ? { new: true, session } : { new: true },
          ).lean()
          if (!updated) throw new Error('QUOTE_CONFLICT')
        }

        if (storeCreditAmount > 0 && storeCreditMeta) {
          await StoreCreditLedger.create(
            [
              {
                accountId: storeCreditMeta.id,
                phone: storeCreditMeta.phone,
                amount: -storeCreditAmount,
                kind: 'redeem',
                refType: 'sale',
                refId: sale._id,
                note: 'Sale checkout',
                createdBy: userId,
              },
            ],
            session ? { session } : undefined,
          )
        }

        if (hasOa && houseAccountMeta) {
          await HouseAccountLedger.create(
            [
              {
                houseAccountId: houseAccountMeta.id,
                accountNumber: houseAccountMeta.accountNumber,
                kind: 'charge',
                amount: onAccountAmount,
                saleId: sale._id,
                createdBy: userId,
              },
            ],
            session ? { session } : undefined,
          )
        }

        if (openTabId) {
          await OpenTab.findOneAndUpdate(
            { _id: openTabId, status: 'open' },
            { $set: { status: 'closed', closedSaleId: sale._id, lines: [] } },
            session ? { session } : undefined,
          )
        }
    }
    const session = await mongoose.startSession()
    try {
      try {
        await session.withTransaction(async () => {
          await performCheckout(session)
        })
      } catch (txErr) {
        const msg = txErr instanceof Error ? txErr.message : ''
        const unsupportedTx =
          msg.includes('Transaction numbers are only allowed on a replica set member or mongos') ||
          msg.includes('transactions are not supported')
        if (!unsupportedTx) throw txErr
        // Dev fallback: standalone mongod (no replica set) cannot run transactions.
        await performCheckout()
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (msg.startsWith('INSUFFICIENT_STOCK:')) {
        res.status(409).json({ message: `Insufficient stock for ${msg.slice('INSUFFICIENT_STOCK:'.length)}` })
        return
      }
      if (msg === 'HOUSE_ACCOUNT_LIMIT_OR_STATUS') {
        res.status(400).json({ message: 'House account not found, closed, or would exceed credit limit' })
        return
      }
      if (msg === 'INSUFFICIENT_STORE_CREDIT') {
        res.status(400).json({ message: 'Insufficient store credit' })
        return
      }
      if (msg === 'INSUFFICIENT_LOYALTY_POINTS') {
        res.status(400).json({ message: 'Insufficient loyalty points' })
        return
      }
      if (msg === 'QUOTE_CONFLICT') {
        res.status(409).json({ message: 'Quote was already converted or cancelled' })
        return
      }
      throw err
    } finally {
      await session.endSession()
    }

    const leanSale = await Sale.findOne({ saleId: shortId }).lean()
    if (!leanSale) {
      res.status(500).json({ message: 'Sale create failed' })
      return
    }
    const payload: Record<string, unknown> = { ...leanSale }
    if (storeCreditAmount > 0.005 && scPhone) {
      payload.storeCreditPhone = scPhone
      const acctAfter = await StoreCreditAccount.findOne({ phone: scPhone }).select('balance').lean()
      payload.storeCreditBalanceAfter = round2(Number(acctAfter?.balance ?? 0))
    }
    if (loyaltyPlan) {
      await appendLoyaltyResponseFields(payload, {
        loyaltyMemberId: loyaltyPlan.memberId,
        loyaltyPhone: loyaltyPlan.phone,
        loyaltyPointsEarned: loyaltyPlan.pointsEarned,
        loyaltyPointsRedeemed: loyaltyPlan.pointsRedeemed,
        loyaltyDiscountAmount: loyaltyDiscountAmount > 0 ? loyaltyDiscountAmount : undefined,
      })
    }
    try {
      await maybeAutoClockOutOnSale(userId, new Date())
    } catch {
      // Sale already committed; auto clock-out is best-effort.
    }
    res.status(201).json(payload)
  } catch (e) {
    next(e)
  }
}

function serializeCashier(c: unknown): unknown {
  if (!c || typeof c !== 'object' || !('email' in c)) return c
  const o = c as { email?: string; displayName?: string; roleId?: { slug?: string } | null }
  return {
    email: o.email,
    displayName: o.displayName,
    role: o.roleId?.slug,
  }
}

function saleQueryByRouteParam(id: string) {
  if (isObjectId24(id)) return { kind: 'oid' as const, query: Sale.findById(id) }
  if (isShortSaleId(id)) return { kind: 'short' as const, query: Sale.findOne({ saleId: id.toLowerCase() }) }
  return null
}

export async function getSale(req: Request, res: Response, next: NextFunction) {
  try {
    const id = String(req.params.id ?? '').trim()
    if (!id || !isValidSaleRouteParam(id)) {
      res.status(400).json({ message: 'Use MongoDB sale _id (24 hex chars) or 10-char sale id' })
      return
    }
    const sq = saleQueryByRouteParam(id)
    if (!sq) {
      res.status(400).json({ message: 'Invalid sale id' })
      return
    }
    const sale = await sq.query
      .populate({ path: 'cashier', select: 'email displayName', populate: { path: 'roleId', select: 'slug' } })
      .lean()
    if (!sale) {
      res.status(404).json({ message: 'Sale not found' })
      return
    }
    let storeCreditPhoneFromLedger: string | undefined
    if (Number(sale.storeCreditAmount ?? 0) > 0.005) {
      const redeem = await StoreCreditLedger.findOne({
        refType: 'sale',
        refId: sale._id,
        kind: 'redeem',
      })
        .select('phone')
        .lean()
      if (redeem?.phone) storeCreditPhoneFromLedger = redeem.phone
    }
    res.json({
      ...sale,
      cashier: serializeCashier(sale.cashier),
      ...(storeCreditPhoneFromLedger ? { storeCreditPhone: storeCreditPhoneFromLedger } : {}),
    })
  } catch (e) {
    next(e)
  }
}

type RefundBody = {
  note?: string
  payoutMethod?: string
  storeCreditPhone?: string
  lines?: Array<{ lineIndex?: number; quantity?: number }>
}

export async function getSaleRefundPreview(req: Request, res: Response, next: NextFunction) {
  try {
    const id = String(req.params.id ?? '').trim()
    if (!id || !isValidSaleRouteParam(id)) {
      res.status(400).json({ message: 'Use MongoDB sale _id (24 hex chars) or 10-char sale id' })
      return
    }
    const sq = saleQueryByRouteParam(id)
    if (!sq) {
      res.status(400).json({ message: 'Invalid sale id' })
      return
    }
    const sale = await sq.query
      .populate({ path: 'cashier', select: 'email displayName', populate: { path: 'roleId', select: 'slug' } })
      .lean()
    if (!sale) {
      res.status(404).json({ message: 'Sale not found' })
      return
    }
    const progress = await saleReturnProgress({
      _id: new Types.ObjectId(String(sale._id)),
      items: (sale.items ?? []).map((x) => ({ quantity: Number(x.quantity ?? 0) })),
      total: Number(sale.total ?? 0),
    })
    let storeCreditPhoneFromLedger: string | undefined
    if (Number(sale.storeCreditAmount ?? 0) > 0.005) {
      const redeem = await StoreCreditLedger.findOne({
        refType: 'sale',
        refId: sale._id,
        kind: 'redeem',
      })
        .select('phone')
        .lean()
      if (redeem?.phone) storeCreditPhoneFromLedger = redeem.phone
    }
    res.json({
      sale: {
        ...sale,
        cashier: serializeCashier(sale.cashier),
        ...(storeCreditPhoneFromLedger ? { storeCreditPhone: storeCreditPhoneFromLedger } : {}),
      },
      refund: progress,
    })
  } catch (e) {
    next(e)
  }
}

export async function getSaleExchangePreview(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' })
      return
    }
    const id = String(req.params.id ?? '').trim()
    if (!id || !isValidSaleRouteParam(id)) {
      res.status(400).json({ message: 'Use MongoDB sale _id (24 hex chars) or 10-char sale id' })
      return
    }
    const sq = saleQueryByRouteParam(id)
    if (!sq) {
      res.status(400).json({ message: 'Invalid sale id' })
      return
    }
    const sale = await sq.query
      .populate({ path: 'cashier', select: 'email displayName', populate: { path: 'roleId', select: 'slug' } })
      .lean()
    if (!sale) {
      res.status(404).json({ message: 'Sale not found' })
      return
    }
    if (sale.layById) {
      res.status(400).json({ message: 'This sale is linked to a lay-by release. Exchange is not supported.' })
      return
    }
    const progress = await saleReturnProgress({
      _id: new Types.ObjectId(String(sale._id)),
      items: (sale.items ?? []).map((x) => ({ quantity: Number(x.quantity ?? 0) })),
      total: Number(sale.total ?? 0),
    })
    const saleCreatedAt = (sale as unknown as { createdAt?: Date | string }).createdAt
    const isAdmin = req.user.role === 'admin'
    const eligibility = await exchangeEligibilityForSale(saleCreatedAt, isAdmin)
    let storeCreditPhoneFromLedger: string | undefined
    if (Number(sale.storeCreditAmount ?? 0) > 0.005) {
      const redeem = await StoreCreditLedger.findOne({
        refType: 'sale',
        refId: sale._id,
        kind: 'redeem',
      })
        .select('phone')
        .lean()
      if (redeem?.phone) storeCreditPhoneFromLedger = redeem.phone
    }
    res.json({
      sale: {
        ...sale,
        cashier: serializeCashier(sale.cashier),
        ...(storeCreditPhoneFromLedger ? { storeCreditPhone: storeCreditPhoneFromLedger } : {}),
      },
      return: progress,
      eligibility,
    })
  } catch (e) {
    next(e)
  }
}

type ExchangeBody = {
  note?: string
  adminBypassEligibility?: boolean
  returnLines?: Array<{ lineIndex?: number; quantity?: number }>
  newLines?: Array<{ productId?: string; quantity?: number }>
  settlementKind?: string
  cashTendered?: number
  changeDue?: number
  storeCreditPhone?: string
  tillCode?: string
}

export async function exchangeSale(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' })
      return
    }
    const id = String(req.params.id ?? '').trim()
    if (!id || !isValidSaleRouteParam(id)) {
      res.status(400).json({ message: 'Use MongoDB sale _id (24 hex chars) or 10-char sale id' })
      return
    }
    const body = (req.body ?? {}) as ExchangeBody
    const settlementRaw = typeof body.settlementKind === 'string' ? body.settlementKind.trim() : ''
    const settlementKinds: SaleExchangeSettlementKind[] = [
      'even',
      'customer_pays_cash',
      'customer_receives_cash',
      'customer_receives_store_credit',
    ]
    if (!settlementKinds.includes(settlementRaw as SaleExchangeSettlementKind)) {
      res.status(400).json({ message: 'Invalid settlementKind' })
      return
    }
    const sq = saleQueryByRouteParam(id)
    if (!sq) {
      res.status(400).json({ message: 'Invalid sale id' })
      return
    }
    const sale = await sq.query.lean()
    if (!sale) {
      res.status(404).json({ message: 'Sale not found' })
      return
    }
    const saleCreatedAt = (sale as unknown as { createdAt?: Date | string }).createdAt
    const isAdmin = req.user.role === 'admin'
    const result = await performSaleExchange({
      sale: {
        _id: new Types.ObjectId(String(sale._id)),
        saleId: sale.saleId,
        tillCode: sale.tillCode,
        items: (sale.items ?? []).map((x) => ({
          product: x.product ?? null,
          name: x.name,
          quantity: Number(x.quantity ?? 0),
          unitPrice: Number(x.unitPrice ?? 0),
          listUnitPrice: x.listUnitPrice,
        })),
        total: Number(sale.total ?? 0),
        layById: sale.layById ?? null,
        createdAt: saleCreatedAt ? new Date(saleCreatedAt) : undefined,
        storeCreditAmount: sale.storeCreditAmount,
        onAccountAmount: sale.onAccountAmount,
        houseAccountId: sale.houseAccountId ?? null,
        loyaltyMemberId: sale.loyaltyMemberId ?? null,
        loyaltyPhone: sale.loyaltyPhone ?? null,
        loyaltyPointsEarned: sale.loyaltyPointsEarned,
        loyaltyPointsRedeemed: sale.loyaltyPointsRedeemed,
        refundStatus: sale.refundStatus,
      },
      userId: String(req.user.id),
      isAdmin,
      tillCode: typeof body.tillCode === 'string' ? body.tillCode.trim() : undefined,
      note: body.note,
      adminBypassEligibility: Boolean(body.adminBypassEligibility),
      returnLinesRaw: Array.isArray(body.returnLines) ? body.returnLines : [],
      newLinesRaw: Array.isArray(body.newLines) ? body.newLines : [],
      settlementKind: settlementRaw as SaleExchangeSettlementKind,
      cashTendered: body.cashTendered,
      changeDue: body.changeDue,
      storeCreditPhone: body.storeCreditPhone,
    })
    const out = await Sale.findById(sale._id)
      .populate({ path: 'cashier', select: 'email displayName', populate: { path: 'roleId', select: 'slug' } })
      .lean()
    res.status(200).json({
      message: 'Exchange recorded',
      exchangeId: String(result.exchangeId),
      sale: out ? { ...out, cashier: serializeCashier(out.cashier) } : null,
      exchangeSettlement: result,
    })
  } catch (e) {
    if (e instanceof ExchangeError) {
      res.status(e.status).json({ message: e.message })
      return
    }
    next(e)
  }
}

export async function refundSale(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' })
      return
    }
    const id = String(req.params.id ?? '').trim()
    if (!id || !isValidSaleRouteParam(id)) {
      res.status(400).json({ message: 'Use MongoDB sale _id (24 hex chars) or 10-char sale id' })
      return
    }
    const { note, payoutMethod, storeCreditPhone: rawRefundIssuePhone } = (req.body ?? {}) as RefundBody
    const noteTrim = typeof note === 'string' ? note.trim().slice(0, 2000) : ''
    const payoutMethodNorm =
      payoutMethod === 'cash' || payoutMethod === 'card' || payoutMethod === 'store_credit'
        ? payoutMethod
        : typeof payoutMethod === 'string'
          ? payoutMethod.trim().toLowerCase()
          : ''
    if (payoutMethodNorm !== 'cash' && payoutMethodNorm !== 'card' && payoutMethodNorm !== 'store_credit') {
      res.status(400).json({ message: 'payoutMethod must be cash, card, or store_credit' })
      return
    }

    const sq = saleQueryByRouteParam(id)
    if (!sq) {
      res.status(400).json({ message: 'Invalid sale id' })
      return
    }
    const sale = await sq.query
    if (!sale) {
      res.status(404).json({ message: 'Sale not found' })
      return
    }
    if (sale.layById) {
      res.status(400).json({ message: 'This sale is linked to a lay-by release. Refund via lay-by support, not as a standard sale.' })
      return
    }

    const progress = await saleReturnProgress({
      _id: new Types.ObjectId(String(sale._id)),
      items: (sale.items ?? []).map((x) => ({ quantity: Number(x.quantity ?? 0) })),
      total: Number(sale.total ?? 0),
    })
    if (progress.remainingTotal <= 0.005) {
      const s = await Sale.findById(sale._id)
        .populate({ path: 'cashier', select: 'email displayName', populate: { path: 'roleId', select: 'slug' } })
        .lean()
      res.status(200).json({
        message: 'Already fully refunded',
        alreadyRefunded: true,
        sale: s ? { ...s, cashier: serializeCashier(s.cashier) } : null,
      })
      return
    }

    const requestLinesRaw = Array.isArray((req.body as RefundBody).lines) ? (req.body as RefundBody).lines! : []
    const selections = requestLinesRaw.length
      ? requestLinesRaw
      : progress.lines.filter((x) => x.remainingQty > 0.005).map((x) => ({ lineIndex: x.index, quantity: x.remainingQty }))
    if (!selections.length) {
      res.status(400).json({ message: 'Select at least one item quantity to refund' })
      return
    }
    const selected = new Map<number, number>()
    for (const s of selections) {
      const idx = Number(s.lineIndex)
      const qty = round2(Math.max(0, Number(s.quantity ?? 0)))
      if (!Number.isInteger(idx) || idx < 0 || idx >= sale.items.length) {
        res.status(400).json({ message: 'Invalid refund line selection' })
        return
      }
      if (qty <= 0.005) continue
      selected.set(idx, round2((selected.get(idx) ?? 0) + qty))
    }
    if (!selected.size) {
      res.status(400).json({ message: 'Select at least one item quantity to refund' })
      return
    }

    const refundLines: Array<{ saleLineIndex: number; product?: Types.ObjectId; name: string; quantity: number; unitPrice: number; lineTotal: number }> =
      []
    for (const [idx, qty] of selected.entries()) {
      const line = sale.items[idx]
      const lineProgress = progress.lines[idx]
      if (!line || !lineProgress || qty > lineProgress.remainingQty + 0.005) {
        res.status(409).json({ message: 'Requested refund quantity exceeds remaining refundable quantity' })
        return
      }
      refundLines.push({
        saleLineIndex: idx,
        product: line.product ? new Types.ObjectId(String(line.product)) : undefined,
        name: line.name,
        quantity: qty,
        unitPrice: Number(line.unitPrice ?? 0),
        lineTotal: round2(Number(line.unitPrice ?? 0) * qty),
      })
    }
    const refundTotal = round2(refundLines.reduce((sum, l) => sum + l.lineTotal, 0))
    if (refundTotal <= 0.005) {
      res.status(400).json({ message: 'Refund total must be greater than zero' })
      return
    }
    if (refundTotal > progress.remainingTotal + 0.02) {
      res.status(409).json({ message: 'Refund amount exceeds remaining refundable value' })
      return
    }

    for (const line of refundLines) {
      const pid = line.product
      if (!pid) continue
      const p = await Product.findById(pid).lean()
      if (!p || !productTracksInventory(p)) continue
      if (line.quantity > 0) {
        await Product.updateOne({ _id: pid }, { $inc: { stock: line.quantity } })
      }
    }

    const scAmt = round2(Math.max(0, Number(sale.storeCreditAmount ?? 0) || 0))
    const oaAmt = round2(Math.max(0, Number(sale.onAccountAmount ?? 0) || 0))
    const remainingSc = round2(Math.max(0, scAmt - progress.reversedStoreCredit))
    const remainingOa = round2(Math.max(0, oaAmt - progress.reversedOnAccount))
    const finalRefund = refundTotal >= progress.remainingTotal - 0.02
    let reverseSc = 0
    let reverseOa = 0
    if (finalRefund) {
      reverseSc = remainingSc
      reverseOa = remainingOa
    } else if (progress.remainingTotal > 0.005) {
      reverseSc = round2((remainingSc * refundTotal) / progress.remainingTotal)
      reverseOa = round2((remainingOa * refundTotal) / progress.remainingTotal)
    }
    reverseSc = round2(Math.min(remainingSc, Math.max(0, reverseSc)))
    reverseOa = round2(Math.min(remainingOa, Math.max(0, reverseOa)))

    const netDrawerRefund = round2(Math.max(0, refundTotal - reverseSc - reverseOa))
    let refundIssuePhone = ''
    if (payoutMethodNorm === 'store_credit' && netDrawerRefund > 0.005) {
      refundIssuePhone = normalizePhone(String(rawRefundIssuePhone ?? ''))
      if (!refundIssuePhone) {
        res.status(400).json({
          message: 'storeCreditPhone required when refunding the cash/card portion as store credit',
        })
        return
      }
    }

    if (reverseSc > 0.005) {
      const redeem = await StoreCreditLedger.findOne({
        refType: 'sale',
        refId: sale._id,
        kind: 'redeem',
      })
      if (!redeem) {
        res.status(409).json({
          message: 'Store credit was used on this sale but no matching ledger entry was found. Refund aborted.',
        })
        return
      }
      const acct = await StoreCreditAccount.findById(redeem.accountId)
      if (!acct) {
        res.status(500).json({ message: 'Store credit account missing' })
        return
      }
      acct.balance = round2((acct.balance ?? 0) + reverseSc)
      await acct.save()
      await StoreCreditLedger.create({
        accountId: acct._id,
        phone: redeem.phone,
        amount: reverseSc,
        kind: 'issue',
        refType: 'sale',
        refId: sale._id,
        note: noteTrim || 'Sale partial refund — credit restored',
        createdBy: req.user.id,
      })
    }

    if (reverseOa > 0.005) {
      if (!sale.houseAccountId) {
        res.status(409).json({ message: 'On-account amount on sale but no house account id. Refund aborted.' })
        return
      }
    }
    if (reverseOa > 0.005 && sale.houseAccountId) {
      const charge = await HouseAccountLedger.findOne({ kind: 'charge', saleId: sale._id })
      if (!charge) {
        res.status(409).json({
          message: 'On-account charge recorded on sale but no matching ledger entry. Refund aborted.',
        })
        return
      }
      const ha = await HouseAccount.findById(sale.houseAccountId)
      if (!ha) {
        res.status(500).json({ message: 'House account missing' })
        return
      }
      const nextBal = round2((ha.balance ?? 0) - reverseOa)
      if (nextBal < -0.02) {
        res.status(409).json({ message: 'House account balance would go negative. Resolve manually before refunding.' })
        return
      }
      ha.balance = Math.max(0, nextBal)
      await ha.save()
      await HouseAccountLedger.create({
        houseAccountId: ha._id,
        accountNumber: charge.accountNumber,
        kind: 'payment',
        amount: reverseOa,
        saleId: sale._id,
        note: noteTrim || 'Sale partial refund — account credit',
        createdBy: req.user.id,
      })
    }

    const refundCashAmt = payoutMethodNorm === 'cash' ? netDrawerRefund : 0
    const refundCardAmt = payoutMethodNorm === 'card' ? netDrawerRefund : 0
    const refundStoreCreditIssued = payoutMethodNorm === 'store_credit' ? netDrawerRefund : undefined

    if ((refundStoreCreditIssued ?? 0) > 0.005 && refundIssuePhone) {
      let acct = await StoreCreditAccount.findOne({ phone: refundIssuePhone })
      if (!acct) {
        acct = await StoreCreditAccount.create({
          phone: refundIssuePhone,
          name: 'Customer',
          balance: 0,
        })
      }
      acct.balance = round2((acct.balance ?? 0) + refundStoreCreditIssued!)
      await acct.save()
      await StoreCreditLedger.create({
        accountId: acct._id,
        phone: refundIssuePhone,
        amount: refundStoreCreditIssued!,
        kind: 'issue',
        refType: 'sale',
        refId: sale._id,
        note: noteTrim || 'Refund issued as store credit',
        createdBy: req.user.id,
      })
    }

    await SaleRefund.create({
      saleId: sale._id,
      saleShortId: sale.saleId,
      tillCode: sale.tillCode,
      payoutMethod: payoutMethodNorm,
      note: noteTrim || undefined,
      lines: refundLines,
      refundTotal,
      refundCash: refundCashAmt,
      refundCard: refundCardAmt,
      refundStoreCreditIssued:
        refundStoreCreditIssued !== undefined && refundStoreCreditIssued > 0.005
          ? refundStoreCreditIssued
          : undefined,
      storeCreditPhone:
        refundStoreCreditIssued !== undefined && refundStoreCreditIssued > 0.005 ? refundIssuePhone : undefined,
      reversedStoreCredit: reverseSc > 0 ? reverseSc : undefined,
      reversedOnAccount: reverseOa > 0 ? reverseOa : undefined,
      refundedBy: new Types.ObjectId(String(req.user.id)),
    })

    const cumulativeRefund = round2(progress.refundedTotal + refundTotal)
    sale.refundStatus = cumulativeRefund >= round2(Number(sale.total ?? 0)) - 0.02 ? 'refunded' : 'partial'
    if (sale.refundStatus === 'refunded') {
      sale.refundedAt = new Date()
      sale.refundedBy = new Types.ObjectId(String(req.user.id))
    }
    if (noteTrim) sale.refundNote = noteTrim
    sale.refundPayoutMethod = payoutMethodNorm
    sale.refundPayoutAmount = cumulativeRefund
    await sale.save()

    const saleTotal = Number(sale.total ?? 0)
    if (saleTotal > 0.005 && (sale.loyaltyMemberId || sale.loyaltyPhone)) {
      await reverseLoyaltyForRefund({
        sale: {
          _id: new Types.ObjectId(String(sale._id)),
          loyaltyMemberId: sale.loyaltyMemberId ?? undefined,
          loyaltyPhone: sale.loyaltyPhone ?? undefined,
          loyaltyPointsEarned: sale.loyaltyPointsEarned,
          loyaltyPointsRedeemed: sale.loyaltyPointsRedeemed,
          total: saleTotal,
        },
        refundFraction: refundTotal / saleTotal,
        userId: String(req.user.id),
      })
    }

    const out = await Sale.findById(sale._id)
      .populate({ path: 'cashier', select: 'email displayName', populate: { path: 'roleId', select: 'slug' } })
      .lean()
    res.status(200).json({
      message: sale.refundStatus === 'refunded' ? 'Sale fully refunded' : 'Sale partially refunded',
      sale: out ? { ...out, cashier: serializeCashier(out.cashier) } : null,
      refundSettlement: {
        refundTotal,
        reversedStoreCredit: reverseSc,
        reversedOnAccount: reverseOa,
        netCashOrCardPaidOut: refundCashAmt + refundCardAmt,
        storeCreditIssued: refundStoreCreditIssued ?? 0,
      },
    })
  } catch (e) {
    next(e)
  }
}

export async function listSales(req: Request, res: Response, next: NextFunction) {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200)
    const skip = Math.min(Math.max(Number(req.query.skip) || 0, 0), 50_000)
    const { filter, error } = buildSaleListFilter(req.query)
    if (error) {
      res.status(400).json({ message: error })
      return
    }

    const [total, sales] = await Promise.all([
      Sale.countDocuments(filter),
      Sale.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate({ path: 'cashier', select: 'email displayName', populate: { path: 'roleId', select: 'slug' } })
        .lean(),
    ])

    res.json({
      total,
      sales: sales.map((s) => ({
        ...s,
        cashier: serializeCashier(s.cashier),
      })),
    })
  } catch (e) {
    next(e)
  }
}

const ADJUSTMENT_LOOKUP_MAX_DAYS = 14

/** POS refund/exchange: browse recent sales when customer has no receipt id (cashiers: manager-approved). */
export async function listSalesForAdjustment(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' })
      return
    }
    const canFullRead = hasPermission(req.user.permissions, req.user.role, 'sales.read')
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), canFullRead ? 100 : 50)
    const skip = Math.min(Math.max(Number(req.query.skip) || 0, 0), 5000)

    const query: Request['query'] = { ...req.query }
    if (!canFullRead) {
      const minFrom = new Date()
      minFrom.setDate(minFrom.getDate() - ADJUSTMENT_LOOKUP_MAX_DAYS)
      minFrom.setHours(0, 0, 0, 0)
      const fromRaw = typeof query.from === 'string' ? query.from.trim() : ''
      if (!fromRaw) {
        query.from = minFrom.toISOString()
      } else {
        const requested = new Date(fromRaw)
        if (!Number.isNaN(requested.getTime()) && requested < minFrom) {
          query.from = minFrom.toISOString()
        }
      }
    }

    const { filter, error } = buildSaleListFilter(query)
    if (error) {
      res.status(400).json({ message: error })
      return
    }

    const [total, sales] = await Promise.all([
      Sale.countDocuments(filter),
      Sale.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('saleId tillCode total paymentMethod refundStatus createdAt items.name items.quantity')
        .lean(),
    ])

    res.json({
      total,
      sales: sales.map((s) => ({
        _id: String(s._id),
        saleId: s.saleId,
        tillCode: s.tillCode,
        total: s.total,
        paymentMethod: s.paymentMethod,
        refundStatus: s.refundStatus,
        createdAt: (s as { createdAt?: Date }).createdAt,
        items: (s.items ?? []).map((it) => ({
          name: it.name,
          quantity: it.quantity,
        })),
      })),
    })
  } catch (e) {
    next(e)
  }
}

type OfflineConflictLineInput = { productId?: unknown; name?: unknown; qty?: unknown }

export async function reportOfflineSyncConflict(req: Request, res: Response, next: NextFunction) {
  try {
    const body = (req.body ?? {}) as {
      clientLocalId?: unknown
      tillCode?: unknown
      scope?: unknown
      errorMessage?: unknown
      lines?: unknown
    }
    const clientLocalId = typeof body.clientLocalId === 'string' ? body.clientLocalId.trim() : ''
    if (!clientLocalId) {
      res.status(400).json({ message: 'clientLocalId is required' })
      return
    }
    const tillCode = normalizeTillCode(body.tillCode) ?? undefined
    const scope = body.scope === 'online' ? 'online' : 'offline'
    const errorMessage =
      typeof body.errorMessage === 'string' && body.errorMessage.trim()
        ? body.errorMessage.trim().slice(0, 500)
        : 'Offline sale sync failed'
    const rawLines = Array.isArray(body.lines) ? (body.lines as OfflineConflictLineInput[]) : []
    const lines = rawLines
      .map((line) => {
        const productId = typeof line.productId === 'string' ? line.productId.trim() : ''
        const name = typeof line.name === 'string' ? line.name.trim() : ''
        const qty = Number(line.qty ?? 0)
        if (!productId || !name || !Number.isFinite(qty) || qty <= 0) return null
        return { productId, name, qty: round2(qty) }
      })
      .filter((line): line is { productId: string; name: string; qty: number } => line != null)

    const now = new Date()
    await OfflineSyncConflict.updateOne(
      { clientLocalId },
      {
        $set: {
          tillCode,
          scope,
          errorMessage,
          lines,
          status: 'open',
          lastSeenAt: now,
          resolvedAt: null,
          resolvedBy: null,
          resolutionAction: null,
          resolutionNote: null,
          retryRequestedAt: null,
          retryRequestedBy: null,
        },
        $setOnInsert: { firstSeenAt: now, attemptCount: 0 },
        $inc: { attemptCount: 1 },
      },
      { upsert: true },
    )
    res.status(202).json({ ok: true })
  } catch (e) {
    next(e)
  }
}

export async function listOfflineSyncConflicts(req: Request, res: Response, next: NextFunction) {
  try {
    const statusRaw = typeof req.query.status === 'string' ? req.query.status.trim().toLowerCase() : 'open'
    const status = statusRaw === 'resolved' || statusRaw === 'all' ? statusRaw : 'open'
    const tillCode = normalizeTillCode(req.query.tillCode)
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500)
    const filter: Record<string, unknown> = {}
    if (status !== 'all') filter.status = status
    if (tillCode) filter.tillCode = tillCode

    const [total, rows] = await Promise.all([
      OfflineSyncConflict.countDocuments(filter),
      OfflineSyncConflict.find(filter)
        .sort({ status: 1, lastSeenAt: -1 })
        .limit(limit)
        .populate({ path: 'resolvedBy', select: 'email displayName' })
        .populate({ path: 'retryRequestedBy', select: 'email displayName' })
        .lean(),
    ])
    res.json({
      total,
      conflicts: rows.map((row) => ({
        ...row,
        resolvedBy:
          row.resolvedBy && typeof row.resolvedBy === 'object'
            ? {
                email: (row.resolvedBy as { email?: string }).email,
                displayName: (row.resolvedBy as { displayName?: string }).displayName,
              }
            : null,
        retryRequestedBy:
          row.retryRequestedBy && typeof row.retryRequestedBy === 'object'
            ? {
                email: (row.retryRequestedBy as { email?: string }).email,
                displayName: (row.retryRequestedBy as { displayName?: string }).displayName,
              }
            : null,
      })),
    })
  } catch (e) {
    next(e)
  }
}

export async function requestOfflineSyncConflictRetry(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' })
      return
    }
    const id = String(req.params.id ?? '').trim()
    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ message: 'Invalid conflict id' })
      return
    }
    const updated = await OfflineSyncConflict.findByIdAndUpdate(
      id,
      {
        $set: {
          retryRequestedAt: new Date(),
          retryRequestedBy: new Types.ObjectId(String(req.user.id)),
        },
      },
      { new: true },
    ).lean()
    if (!updated) {
      res.status(404).json({ message: 'Conflict not found' })
      return
    }
    res.json({ ok: true })
  } catch (e) {
    next(e)
  }
}

export async function listOfflineSyncRetryRequests(req: Request, res: Response, next: NextFunction) {
  try {
    const tillCode = normalizeTillCode(req.query.tillCode)
    if (!tillCode) {
      res.status(400).json({ message: 'Invalid tillCode' })
      return
    }
    const rows = await OfflineSyncConflict.find({
      status: 'open',
      tillCode,
      retryRequestedAt: { $ne: null },
    })
      .select({ clientLocalId: 1, retryRequestedAt: 1 })
      .sort({ retryRequestedAt: -1 })
      .limit(100)
      .lean()
    res.json({
      clientLocalIds: rows.map((row) => String(row.clientLocalId)),
    })
  } catch (e) {
    next(e)
  }
}

export async function resolveOfflineSyncConflict(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' })
      return
    }
    const id = String(req.params.id ?? '').trim()
    if (!Types.ObjectId.isValid(id)) {
      res.status(400).json({ message: 'Invalid conflict id' })
      return
    }
    const body = (req.body ?? {}) as { action?: unknown; note?: unknown }
    const actionRaw = typeof body.action === 'string' ? body.action.trim() : ''
    const action =
      actionRaw === 'stock_adjusted' || actionRaw === 'sale_retried' || actionRaw === 'waived' || actionRaw === 'other'
        ? actionRaw
        : null
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : ''
    if (!action) {
      res.status(400).json({ message: 'resolution action is required' })
      return
    }
    if (!note) {
      res.status(400).json({ message: 'resolution note is required' })
      return
    }
    const updated = await OfflineSyncConflict.findByIdAndUpdate(
      id,
      {
        $set: {
          status: 'resolved',
          resolvedAt: new Date(),
          resolvedBy: new Types.ObjectId(String(req.user.id)),
          resolutionAction: action,
          resolutionNote: note,
          retryRequestedAt: null,
          retryRequestedBy: null,
        },
      },
      { new: true },
    ).lean()
    if (!updated) {
      res.status(404).json({ message: 'Conflict not found' })
      return
    }
    res.json({ ok: true })
  } catch (e) {
    next(e)
  }
}

export async function resolveOfflineSyncConflictByClientLocalId(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' })
      return
    }
    const clientLocalId = String(req.params.clientLocalId ?? '').trim()
    if (!clientLocalId) {
      res.status(400).json({ message: 'Invalid clientLocalId' })
      return
    }
    await OfflineSyncConflict.updateOne(
      { clientLocalId },
      {
        $set: {
          status: 'resolved',
          resolvedAt: new Date(),
          resolvedBy: new Types.ObjectId(String(req.user.id)),
          resolutionAction: 'sale_retried',
          resolutionNote: 'Auto-resolved after successful sync replay.',
          retryRequestedAt: null,
          retryRequestedBy: null,
        },
      },
    )
    res.json({ ok: true })
  } catch (e) {
    next(e)
  }
}
