import { randomBytes } from 'node:crypto'
import { Types } from 'mongoose'
import { ManualReturn, type IManualReturnLine } from '../models/ManualReturn.js'
import { Product } from '../models/Product.js'
import { StoreCreditAccount, StoreCreditLedger } from '../models/StoreCreditAccount.js'
import { productTracksInventory } from '../utils/productInventory.js'
import { bumpCatalogRevision } from './catalogRevision.js'

const RETURN_ID_HEX_LEN = 10

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, '')
}

async function allocateReturnId(): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const returnId = randomBytes(5).toString('hex')
    if (returnId.length !== RETURN_ID_HEX_LEN) continue
    const exists = await ManualReturn.exists({ returnId })
    if (!exists) return returnId
  }
  throw new Error('Could not allocate return id')
}

export type ManualReturnLineInput = {
  productId: string
  quantity: number
}

export type CreateManualReturnInput = {
  tillCode?: string
  note: string
  payoutMethod: 'cash' | 'card' | 'store_credit'
  storeCreditPhone?: string
  lines: ManualReturnLineInput[]
  processedByUserId: string
}

export type CreateManualReturnResult = {
  returnId: string
  _id: string
  returnTotal: number
  payoutMethod: 'cash' | 'card' | 'store_credit'
  returnCash: number
  returnCard: number
  returnStoreCreditIssued: number
  lines: IManualReturnLine[]
  note: string
}

export async function createManualReturn(input: CreateManualReturnInput): Promise<CreateManualReturnResult> {
  const noteTrim = input.note.trim().slice(0, 2000)
  if (noteTrim.length < 3) {
    throw new Error('A note is required (at least 3 characters) explaining this return')
  }

  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new Error('At least one return line is required')
  }

  const payoutMethod = input.payoutMethod
  if (payoutMethod !== 'cash' && payoutMethod !== 'card' && payoutMethod !== 'store_credit') {
    throw new Error('payoutMethod must be cash, card, or store_credit')
  }

  const resolvedLines: IManualReturnLine[] = []
  for (const raw of input.lines) {
    const productId = String(raw.productId ?? '').trim()
    const qty = Number(raw.quantity)
    if (!Types.ObjectId.isValid(productId)) {
      throw new Error('Invalid product id on return line')
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new Error('Return quantity must be greater than zero')
    }
    const p = await Product.findById(productId).lean()
    if (!p) {
      throw new Error('Product not found for return line')
    }
    const unitPrice = round2(Number(p.price ?? 0))
    const quantity = round2(qty)
    resolvedLines.push({
      product: new Types.ObjectId(productId),
      sku: typeof p.sku === 'string' ? p.sku : undefined,
      name: String(p.name ?? '').trim() || 'Item',
      quantity,
      unitPrice,
      lineTotal: round2(unitPrice * quantity),
    })
  }

  const returnTotal = round2(resolvedLines.reduce((sum, l) => sum + l.lineTotal, 0))
  if (returnTotal <= 0.005) {
    throw new Error('Return total must be greater than zero')
  }

  let storeCreditPhone = ''
  if (payoutMethod === 'store_credit') {
    storeCreditPhone = normalizePhone(String(input.storeCreditPhone ?? ''))
    if (!storeCreditPhone) {
      throw new Error('storeCreditPhone required when payout is store credit')
    }
  }

  const returnCash = payoutMethod === 'cash' ? returnTotal : 0
  const returnCard = payoutMethod === 'card' ? returnTotal : 0
  const returnStoreCreditIssued = payoutMethod === 'store_credit' ? returnTotal : 0

  for (const line of resolvedLines) {
    const pid = line.product
    if (!pid) continue
    const p = await Product.findById(pid).lean()
    if (!p || !productTracksInventory(p)) continue
    if (line.quantity > 0) {
      await Product.updateOne({ _id: pid }, { $inc: { stock: line.quantity } })
    }
  }

  if (resolvedLines.some((l) => l.product)) {
    await bumpCatalogRevision()
  }

  const returnId = await allocateReturnId()
  const tillCode = input.tillCode?.trim().toUpperCase() || undefined

  const doc = await ManualReturn.create({
    returnId,
    tillCode,
    note: noteTrim,
    lines: resolvedLines,
    returnTotal,
    payoutMethod,
    returnCash,
    returnCard,
    returnStoreCreditIssued: returnStoreCreditIssued > 0.005 ? returnStoreCreditIssued : undefined,
    storeCreditPhone: storeCreditPhone || undefined,
    processedBy: new Types.ObjectId(input.processedByUserId),
  })

  if (returnStoreCreditIssued > 0.005 && storeCreditPhone) {
    let acct = await StoreCreditAccount.findOne({ phone: storeCreditPhone })
    if (!acct) {
      acct = await StoreCreditAccount.create({
        phone: storeCreditPhone,
        name: 'Customer',
        balance: 0,
      })
    }
    acct.balance = round2((acct.balance ?? 0) + returnStoreCreditIssued)
    await acct.save()
    await StoreCreditLedger.create({
      accountId: acct._id,
      phone: storeCreditPhone,
      amount: returnStoreCreditIssued,
      kind: 'issue',
      refType: 'manual_return',
      refId: doc._id,
      note: noteTrim || 'Manual return issued as store credit',
      createdBy: input.processedByUserId,
    })
  }

  return {
    returnId,
    _id: String(doc._id),
    returnTotal,
    payoutMethod,
    returnCash,
    returnCard,
    returnStoreCreditIssued,
    lines: resolvedLines,
    note: noteTrim,
  }
}
