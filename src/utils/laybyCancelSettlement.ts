export type LayByCancelMode = 'full_refund' | 'percent_refund' | 'store_credit'

export type LayByPaymentTender = {
  cashAmount?: number
  cardAmount?: number
  storeCreditAmount?: number
  amount?: number
}

export type LayByCancelSettlement = {
  refundTotal: number
  refundCash: number
  refundCard: number
  storeCreditRestored: number
  storeCreditIssued: number
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function sumLayByPaymentTenders(payments: LayByPaymentTender[]): {
  cash: number
  card: number
  storeCredit: number
  total: number
} {
  let cash = 0
  let card = 0
  let storeCredit = 0
  for (const p of payments) {
    cash += Number(p.cashAmount ?? 0) || 0
    card += Number(p.cardAmount ?? 0) || 0
    storeCredit += Number(p.storeCreditAmount ?? 0) || 0
  }
  return {
    cash: round2(cash),
    card: round2(card),
    storeCredit: round2(storeCredit),
    total: round2(cash + card + storeCredit),
  }
}

function refundTotalForMode(mode: LayByCancelMode, amountPaid: number, percent?: number): number {
  if (mode === 'full_refund' || mode === 'store_credit') return round2(amountPaid)
  const pct = Number(percent)
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return 0
  return round2((amountPaid * pct) / 100)
}

function splitRefundByTender(
  refundTotal: number,
  tenders: ReturnType<typeof sumLayByPaymentTenders>,
): Pick<LayByCancelSettlement, 'refundCash' | 'refundCard' | 'storeCreditRestored'> {
  if (refundTotal < 0.005 || tenders.total < 0.005) {
    return { refundCash: 0, refundCard: 0, storeCreditRestored: 0 }
  }
  const ratio = refundTotal / tenders.total
  let refundCash = round2(tenders.cash * ratio)
  let refundCard = round2(tenders.card * ratio)
  let storeCreditRestored = round2(tenders.storeCredit * ratio)
  const drift = round2(refundTotal - (refundCash + refundCard + storeCreditRestored))
  if (Math.abs(drift) > 0.001) {
    refundCash = round2(refundCash + drift)
  }
  return { refundCash, refundCard, storeCreditRestored }
}

export function computeLayByCancelSettlement(input: {
  mode: LayByCancelMode
  amountPaid: number
  payments: LayByPaymentTender[]
  percent?: number
}): LayByCancelSettlement {
  const refundTotal = refundTotalForMode(input.mode, input.amountPaid, input.percent)
  if (input.mode === 'store_credit') {
    return {
      refundTotal,
      refundCash: 0,
      refundCard: 0,
      storeCreditRestored: 0,
      storeCreditIssued: refundTotal,
    }
  }
  const tenders = sumLayByPaymentTenders(input.payments)
  const split = splitRefundByTender(refundTotal, tenders)
  return {
    refundTotal,
    refundCash: split.refundCash,
    refundCard: split.refundCard,
    storeCreditRestored: split.storeCreditRestored,
    storeCreditIssued: 0,
  }
}
