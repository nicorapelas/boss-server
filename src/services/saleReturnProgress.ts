import { Types } from 'mongoose'
import { SaleExchange } from '../models/SaleExchange.js'
import { SaleRefund } from '../models/SaleRefund.js'

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export type SaleReturnProgress = {
  refundedTotal: number
  remainingTotal: number
  reversedStoreCredit: number
  reversedOnAccount: number
  lines: Array<{ index: number; soldQty: number; refundedQty: number; remainingQty: number }>
}

function accumulateReturnLines(
  refundedByIndex: Map<number, number>,
  lines: Array<{ saleLineIndex?: number; quantity?: number }> | undefined,
) {
  for (const l of lines ?? []) {
    const idx = Number(l.saleLineIndex ?? -1)
    if (!Number.isInteger(idx) || idx < 0) continue
    const q = Math.max(0, Number(l.quantity ?? 0))
    refundedByIndex.set(idx, round2((refundedByIndex.get(idx) ?? 0) + q))
  }
}

/** Refundable qty/value remaining on a sale (refunds + exchange returns consume the same pool). */
export async function saleReturnProgress(sale: {
  _id: Types.ObjectId
  items: Array<{ quantity: number }>
  total: number
}): Promise<SaleReturnProgress> {
  const [refunds, exchanges] = await Promise.all([
    SaleRefund.find({ saleId: sale._id }).select('lines refundTotal reversedStoreCredit reversedOnAccount').lean(),
    SaleExchange.find({ saleId: sale._id }).select('returnLines returnTotal reversedStoreCredit reversedOnAccount').lean(),
  ])

  const refundedByIndex = new Map<number, number>()
  let refundedTotal = 0
  let reversedStoreCredit = 0
  let reversedOnAccount = 0

  for (const r of refunds) {
    refundedTotal = round2(refundedTotal + Number(r.refundTotal ?? 0))
    reversedStoreCredit = round2(reversedStoreCredit + Number(r.reversedStoreCredit ?? 0))
    reversedOnAccount = round2(reversedOnAccount + Number(r.reversedOnAccount ?? 0))
    accumulateReturnLines(refundedByIndex, r.lines)
  }

  for (const ex of exchanges) {
    refundedTotal = round2(refundedTotal + Number(ex.returnTotal ?? 0))
    reversedStoreCredit = round2(reversedStoreCredit + Number(ex.reversedStoreCredit ?? 0))
    reversedOnAccount = round2(reversedOnAccount + Number(ex.reversedOnAccount ?? 0))
    accumulateReturnLines(refundedByIndex, ex.returnLines)
  }

  const lines = sale.items.map((line, index) => {
    const refundedQty = round2(Math.max(0, refundedByIndex.get(index) ?? 0))
    const soldQty = round2(Math.max(0, Number(line.quantity ?? 0)))
    const remainingQty = round2(Math.max(0, soldQty - refundedQty))
    return { index, soldQty, refundedQty, remainingQty }
  })

  return {
    refundedTotal: round2(Math.min(Number(sale.total ?? 0), refundedTotal)),
    remainingTotal: round2(Math.max(0, Number(sale.total ?? 0) - refundedTotal)),
    reversedStoreCredit,
    reversedOnAccount,
    lines,
  }
}
