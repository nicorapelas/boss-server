import { Types } from 'mongoose'
import type { IProduct } from '../models/Product.js'
import type { ISaleExchangeNewLine, ISaleExchangeReturnLine, SaleExchangeSettlementKind } from '../models/SaleExchange.js'
import { SaleExchange } from '../models/SaleExchange.js'
import { Product } from '../models/Product.js'
import { Sale } from '../models/Sale.js'
import { StoreCreditAccount, StoreCreditLedger } from '../models/StoreCreditAccount.js'
import { HouseAccount, HouseAccountLedger } from '../models/HouseAccount.js'
import { reverseLoyaltyForRefund } from './loyalty.service.js'
import { saleReturnProgress } from './saleReturnProgress.js'
import { ensureStoreSettingsDoc } from '../controllers/storeSettings.controller.js'
import { productTracksInventory } from '../utils/productInventory.js'
import { expandForProduct } from '../utils/volumePrice.js'

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, '')
}

export class ExchangeError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export type ExchangeEligibility = {
  eligible: boolean
  daysSinceSale: number
  maxDays: number
  adminBypassAvailable: boolean
}

export async function exchangeEligibilityForSale(
  saleCreatedAt: Date | string | undefined,
  isAdmin: boolean,
): Promise<ExchangeEligibility> {
  const doc = await ensureStoreSettingsDoc()
  const maxDays =
    typeof doc?.exchangeEligibilityDays === 'number' && doc.exchangeEligibilityDays >= 0
      ? Math.floor(doc.exchangeEligibilityDays)
      : 30
  const created = saleCreatedAt ? new Date(saleCreatedAt) : new Date()
  const daysSinceSale = Math.max(
    0,
    Math.floor((Date.now() - created.getTime()) / (24 * 60 * 60 * 1000)),
  )
  const eligible = maxDays === 0 ? true : daysSinceSale <= maxDays
  return {
    eligible,
    daysSinceSale,
    maxDays,
    adminBypassAvailable: isAdmin,
  }
}

type ReturnLineInput = { lineIndex?: number; quantity?: number }
type NewLineInput = { productId?: string; quantity?: number }

export type PerformExchangeInput = {
  sale: {
    _id: Types.ObjectId
    saleId?: string
    tillCode?: string
    items: Array<{
      product?: Types.ObjectId | null
      name: string
      quantity: number
      unitPrice: number
      listUnitPrice?: number
    }>
    total: number
    layById?: Types.ObjectId | null
    createdAt?: Date
    storeCreditAmount?: number
    onAccountAmount?: number
    houseAccountId?: Types.ObjectId | null
    loyaltyMemberId?: Types.ObjectId | null
    loyaltyPhone?: string | null
    loyaltyPointsEarned?: number
    loyaltyPointsRedeemed?: number
    refundStatus?: string
    refundNote?: string
    refundedAt?: Date
    refundedBy?: Types.ObjectId
    refundPayoutMethod?: string
    refundPayoutAmount?: number
  }
  userId: string
  isAdmin: boolean
  tillCode?: string | null
  note?: string
  adminBypassEligibility?: boolean
  returnLinesRaw: ReturnLineInput[]
  newLinesRaw: NewLineInput[]
  settlementKind: SaleExchangeSettlementKind
  cashTendered?: number
  changeDue?: number
  storeCreditPhone?: string
}

export type PerformExchangeResult = {
  exchangeId: Types.ObjectId
  returnTotal: number
  newTotal: number
  netAmount: number
  cashPaidIn: number
  cashPaidOut: number
  storeCreditIssued: number
  reversedStoreCredit: number
  reversedOnAccount: number
}

function parseReturnSelections(
  sale: PerformExchangeInput['sale'],
  progress: Awaited<ReturnType<typeof saleReturnProgress>>,
  raw: ReturnLineInput[],
): ISaleExchangeReturnLine[] {
  if (!raw.length) throw new ExchangeError(400, 'Select at least one item to return')
  const selected = new Map<number, number>()
  for (const s of raw) {
    const idx = Number(s.lineIndex)
    const qty = round2(Math.max(0, Number(s.quantity ?? 0)))
    if (!Number.isInteger(idx) || idx < 0 || idx >= sale.items.length) {
      throw new ExchangeError(400, 'Invalid return line selection')
    }
    if (qty <= 0.005) continue
    selected.set(idx, round2((selected.get(idx) ?? 0) + qty))
  }
  if (!selected.size) throw new ExchangeError(400, 'Select at least one item quantity to return')

  const returnLines: ISaleExchangeReturnLine[] = []
  for (const [idx, qty] of selected.entries()) {
    const line = sale.items[idx]
    const lineProgress = progress.lines[idx]
    if (!line || !lineProgress || qty > lineProgress.remainingQty + 0.005) {
      throw new ExchangeError(409, 'Return quantity exceeds remaining returnable quantity')
    }
    returnLines.push({
      saleLineIndex: idx,
      product: line.product ? new Types.ObjectId(String(line.product)) : undefined,
      name: line.name,
      quantity: qty,
      unitPrice: Number(line.unitPrice ?? 0),
      lineTotal: round2(Number(line.unitPrice ?? 0) * qty),
    })
  }
  const returnTotal = round2(returnLines.reduce((sum, l) => sum + l.lineTotal, 0))
  if (returnTotal <= 0.005) throw new ExchangeError(400, 'Return total must be greater than zero')
  if (returnTotal > progress.remainingTotal + 0.02) {
    throw new ExchangeError(409, 'Return amount exceeds remaining returnable value')
  }
  return returnLines
}

async function buildNewLines(raw: NewLineInput[]): Promise<ISaleExchangeNewLine[]> {
  if (!raw.length) throw new ExchangeError(400, 'Add at least one replacement item')
  const newLines: ISaleExchangeNewLine[] = []
  for (const row of raw) {
    const productId = String(row.productId ?? '').trim()
    const qty = round2(Math.max(0, Number(row.quantity ?? 0)))
    if (!Types.ObjectId.isValid(productId) || qty <= 0.005) {
      throw new ExchangeError(400, 'Invalid replacement line')
    }
    const p = await Product.findById(productId).lean()
    if (!p) throw new ExchangeError(400, `Unknown product ${productId}`)
    const segments = expandForProduct(p as IProduct, qty)
    for (const seg of segments) {
      newLines.push({
        product: new Types.ObjectId(productId),
        sku: p.sku,
        name: p.name,
        quantity: seg.quantity,
        unitPrice: seg.unitPrice,
        lineTotal: seg.lineTotal,
      })
    }
  }
  const newTotal = round2(newLines.reduce((sum, l) => sum + l.lineTotal, 0))
  if (newTotal <= 0.005) throw new ExchangeError(400, 'Replacement total must be greater than zero')
  return newLines
}

async function applyReturnReversals(input: {
  sale: PerformExchangeInput['sale']
  progress: Awaited<ReturnType<typeof saleReturnProgress>>
  returnTotal: number
  noteTrim: string
  userId: string
}): Promise<{ reverseSc: number; reverseOa: number }> {
  const { sale, progress, returnTotal, noteTrim, userId } = input
  const scAmt = round2(Math.max(0, Number(sale.storeCreditAmount ?? 0) || 0))
  const oaAmt = round2(Math.max(0, Number(sale.onAccountAmount ?? 0) || 0))
  const remainingSc = round2(Math.max(0, scAmt - progress.reversedStoreCredit))
  const remainingOa = round2(Math.max(0, oaAmt - progress.reversedOnAccount))
  const finalReturn = returnTotal >= progress.remainingTotal - 0.02
  let reverseSc = 0
  let reverseOa = 0
  if (finalReturn) {
    reverseSc = remainingSc
    reverseOa = remainingOa
  } else if (progress.remainingTotal > 0.005) {
    reverseSc = round2((remainingSc * returnTotal) / progress.remainingTotal)
    reverseOa = round2((remainingOa * returnTotal) / progress.remainingTotal)
  }
  reverseSc = round2(Math.min(remainingSc, Math.max(0, reverseSc)))
  reverseOa = round2(Math.min(remainingOa, Math.max(0, reverseOa)))

  if (reverseSc > 0.005) {
    const redeem = await StoreCreditLedger.findOne({
      refType: 'sale',
      refId: sale._id,
      kind: 'redeem',
    })
    if (!redeem) {
      throw new ExchangeError(
        409,
        'Store credit was used on this sale but no matching ledger entry was found. Exchange aborted.',
      )
    }
    const acct = await StoreCreditAccount.findById(redeem.accountId)
    if (!acct) throw new ExchangeError(500, 'Store credit account missing')
    acct.balance = round2((acct.balance ?? 0) + reverseSc)
    await acct.save()
    await StoreCreditLedger.create({
      accountId: acct._id,
      phone: redeem.phone,
      amount: reverseSc,
      kind: 'issue',
      refType: 'sale',
      refId: sale._id,
      note: noteTrim || 'Exchange return — credit restored',
      createdBy: userId,
    })
  }

  if (reverseOa > 0.005) {
    if (!sale.houseAccountId) {
      throw new ExchangeError(409, 'On-account amount on sale but no house account id. Exchange aborted.')
    }
    const charge = await HouseAccountLedger.findOne({ kind: 'charge', saleId: sale._id })
    if (!charge) {
      throw new ExchangeError(
        409,
        'On-account charge recorded on sale but no matching ledger entry. Exchange aborted.',
      )
    }
    const ha = await HouseAccount.findById(sale.houseAccountId)
    if (!ha) throw new ExchangeError(500, 'House account missing')
    const nextBal = round2((ha.balance ?? 0) - reverseOa)
    if (nextBal < -0.02) {
      throw new ExchangeError(
        409,
        'House account balance would go negative. Resolve manually before exchanging.',
      )
    }
    ha.balance = Math.max(0, nextBal)
    await ha.save()
    await HouseAccountLedger.create({
      houseAccountId: ha._id,
      accountNumber: charge.accountNumber,
      kind: 'payment',
      amount: reverseOa,
      saleId: sale._id,
      note: noteTrim || 'Exchange return — account credit',
      createdBy: userId,
    })
  }

  return { reverseSc, reverseOa }
}

export async function performSaleExchange(input: PerformExchangeInput): Promise<PerformExchangeResult> {
  const { sale, userId, isAdmin, tillCode, note, adminBypassEligibility } = input
  if (sale.layById) {
    throw new ExchangeError(400, 'This sale is linked to a lay-by release. Exchange is not supported.')
  }

  const eligibility = await exchangeEligibilityForSale(sale.createdAt, isAdmin)
  const bypass = Boolean(adminBypassEligibility && isAdmin)
  if (!eligibility.eligible && !bypass) {
    throw new ExchangeError(
      403,
      `Sale is outside the ${eligibility.maxDays}-day exchange window (${eligibility.daysSinceSale} days ago)`,
    )
  }

  const progress = await saleReturnProgress({
    _id: sale._id,
    items: sale.items.map((x) => ({ quantity: Number(x.quantity ?? 0) })),
    total: Number(sale.total ?? 0),
  })
  if (progress.remainingTotal <= 0.005) {
    throw new ExchangeError(409, 'Nothing left to return on this sale')
  }

  const returnLines = parseReturnSelections(sale, progress, input.returnLinesRaw)
  const returnTotal = round2(returnLines.reduce((sum, l) => sum + l.lineTotal, 0))
  const newLines = await buildNewLines(input.newLinesRaw)
  const newTotal = round2(newLines.reduce((sum, l) => sum + l.lineTotal, 0))
  const netAmount = round2(newTotal - returnTotal)

  const kind = input.settlementKind
  let cashPaidIn = 0
  let cashPaidOut = 0
  let storeCreditIssued = 0
  let storeCreditPhone = ''

  if (Math.abs(netAmount) <= 0.005) {
    if (kind !== 'even') throw new ExchangeError(400, 'Even exchange requires settlement kind "even"')
  } else if (netAmount > 0.005) {
    if (kind !== 'customer_pays_cash') {
      throw new ExchangeError(400, 'Customer must pay the difference in cash')
    }
    const tendered = round2(Math.max(0, Number(input.cashTendered ?? 0)))
    const change = round2(Math.max(0, Number(input.changeDue ?? 0)))
    if (Math.abs(tendered - change - netAmount) > 0.03) {
      throw new ExchangeError(400, 'Cash tendered and change do not match amount due')
    }
    cashPaidIn = netAmount
  } else {
    const creditDue = round2(Math.abs(netAmount))
    if (kind === 'customer_receives_cash') {
      cashPaidOut = creditDue
    } else if (kind === 'customer_receives_store_credit') {
      storeCreditPhone = normalizePhone(String(input.storeCreditPhone ?? ''))
      if (!storeCreditPhone) {
        throw new ExchangeError(400, 'storeCreditPhone required for store credit payout')
      }
      storeCreditIssued = creditDue
    } else {
      throw new ExchangeError(400, 'Customer credit must be paid as cash or store credit')
    }
  }

  const noteTrim = typeof note === 'string' ? note.trim().slice(0, 2000) : ''

  const stockIncrements: Array<{ id: Types.ObjectId; qty: number }> = []
  for (const line of returnLines) {
    if (!line.product) continue
    const p = await Product.findById(line.product).lean()
    if (!p || !productTracksInventory(p)) continue
    stockIncrements.push({ id: line.product, qty: line.quantity })
  }

  const stockDecrements: Array<{ id: Types.ObjectId; qty: number }> = []
  for (const line of newLines) {
    if (!line.product) continue
    const p = await Product.findById(line.product).lean()
    if (!p || !productTracksInventory(p)) continue
    stockDecrements.push({ id: line.product, qty: line.quantity })
  }

  for (const { id, qty } of stockDecrements) {
    const updated = await Product.updateOne({ _id: id, stock: { $gte: qty } }, { $inc: { stock: -qty } })
    if (updated.modifiedCount !== 1) {
      const p = await Product.findById(id).select('sku').lean()
      throw new ExchangeError(409, `Insufficient stock for ${p?.sku ?? id}`)
    }
  }

  for (const { id, qty } of stockIncrements) {
    await Product.updateOne({ _id: id }, { $inc: { stock: qty } })
  }

  let reverseSc = 0
  let reverseOa = 0
  let creditAccountId: Types.ObjectId | undefined
  try {
    const rev = await applyReturnReversals({ sale, progress, returnTotal, noteTrim, userId })
    reverseSc = rev.reverseSc
    reverseOa = rev.reverseOa

    if (storeCreditIssued > 0.005 && storeCreditPhone) {
      let acct = await StoreCreditAccount.findOne({ phone: storeCreditPhone })
      if (!acct) {
        acct = await StoreCreditAccount.create({
          phone: storeCreditPhone,
          name: 'Customer',
          balance: 0,
        })
      }
      acct.balance = round2((acct.balance ?? 0) + storeCreditIssued)
      await acct.save()
      creditAccountId = acct._id as Types.ObjectId
    }

    const exchangeDoc = await SaleExchange.create({
      saleId: sale._id,
      saleShortId: sale.saleId,
      tillCode: tillCode ?? sale.tillCode,
      note: noteTrim || undefined,
      returnLines,
      returnTotal,
      newLines,
      newTotal,
      netAmount,
      settlementKind: kind,
      cashPaidIn,
      cashPaidOut,
      storeCreditIssued: storeCreditIssued > 0.005 ? storeCreditIssued : undefined,
      storeCreditPhone: storeCreditIssued > 0.005 ? storeCreditPhone : undefined,
      reversedStoreCredit: reverseSc > 0 ? reverseSc : undefined,
      reversedOnAccount: reverseOa > 0 ? reverseOa : undefined,
      adminBypassEligibility: bypass || undefined,
      exchangedBy: new Types.ObjectId(userId),
    })

    if (creditAccountId && storeCreditIssued > 0.005) {
      await StoreCreditLedger.create({
        accountId: creditAccountId,
        phone: storeCreditPhone,
        amount: storeCreditIssued,
        kind: 'issue',
        refType: 'sale_exchange',
        refId: exchangeDoc._id,
        note: noteTrim || 'Exchange balance issued as store credit',
        createdBy: userId,
      })
    }

    const cumulativeReturn = round2(progress.refundedTotal + returnTotal)
    const saleDoc = await Sale.findById(sale._id)
    if (saleDoc) {
      saleDoc.refundStatus =
        cumulativeReturn >= round2(Number(sale.total ?? 0)) - 0.02 ? 'refunded' : 'partial'
      if (saleDoc.refundStatus === 'refunded') {
        saleDoc.refundedAt = new Date()
        saleDoc.refundedBy = new Types.ObjectId(userId)
      }
      if (noteTrim) saleDoc.refundNote = noteTrim
      saleDoc.refundPayoutAmount = cumulativeReturn
      await saleDoc.save()
    }

    const saleTotal = Number(sale.total ?? 0)
    if (saleTotal > 0.005 && (sale.loyaltyMemberId || sale.loyaltyPhone)) {
      await reverseLoyaltyForRefund({
        sale: {
          _id: sale._id,
          loyaltyMemberId: sale.loyaltyMemberId ?? undefined,
          loyaltyPhone: sale.loyaltyPhone ?? undefined,
          loyaltyPointsEarned: sale.loyaltyPointsEarned,
          loyaltyPointsRedeemed: sale.loyaltyPointsRedeemed,
          total: saleTotal,
        },
        refundFraction: returnTotal / saleTotal,
        userId,
      })
    }

    return {
      exchangeId: exchangeDoc._id as Types.ObjectId,
      returnTotal,
      newTotal,
      netAmount,
      cashPaidIn,
      cashPaidOut,
      storeCreditIssued,
      reversedStoreCredit: reverseSc,
      reversedOnAccount: reverseOa,
    }
  } catch (e) {
    for (const { id, qty } of stockDecrements) {
      await Product.updateOne({ _id: id }, { $inc: { stock: qty } })
    }
    for (const { id, qty } of stockIncrements) {
      await Product.updateOne({ _id: id }, { $inc: { stock: -qty } })
    }
    throw e
  }
}
