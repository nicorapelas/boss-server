import type { IStoreSettings } from '../models/StoreSettings.js'

export type CashRoundingIncrement = 10 | 20 | 50
export type CashRoundingMode = 'nearest' | 'down' | 'up'

export interface CashRoundingConfig {
  enabled: boolean
  incrementCents: CashRoundingIncrement
  mode: CashRoundingMode
}

export const DEFAULT_CASH_ROUNDING: CashRoundingConfig = {
  enabled: false,
  incrementCents: 10,
  mode: 'nearest',
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function cashRoundingFromSettings(
  doc: Pick<IStoreSettings, 'cashRounding'> | null | undefined,
): CashRoundingConfig {
  const raw = doc?.cashRounding
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CASH_ROUNDING }
  const incrementRaw = Number(raw.incrementCents)
  const incrementCents: CashRoundingIncrement =
    incrementRaw === 20 ? 20 : incrementRaw === 50 ? 50 : 10
  const modeRaw = String(raw.mode ?? 'nearest')
  const mode: CashRoundingMode =
    modeRaw === 'down' ? 'down' : modeRaw === 'up' ? 'up' : 'nearest'
  return {
    enabled: raw.enabled === true,
    incrementCents,
    mode,
  }
}

export function cashRoundingFromBody(body: unknown): CashRoundingConfig | null {
  if (!body || typeof body !== 'object') return null
  const o = body as Record<string, unknown>
  const incrementRaw = Number(o.incrementCents)
  const incrementCents: CashRoundingIncrement =
    incrementRaw === 20 ? 20 : incrementRaw === 50 ? 50 : 10
  const modeRaw = String(o.mode ?? 'nearest')
  const mode: CashRoundingMode =
    modeRaw === 'down' ? 'down' : modeRaw === 'up' ? 'up' : 'nearest'
  if (o.enabled !== undefined && o.enabled !== true && o.enabled !== false) return null
  if (o.mode !== undefined && modeRaw !== 'nearest' && modeRaw !== 'down' && modeRaw !== 'up') return null
  if (
    o.incrementCents !== undefined &&
    incrementRaw !== 10 &&
    incrementRaw !== 20 &&
    incrementRaw !== 50
  ) {
    return null
  }
  return {
    enabled: o.enabled === true,
    incrementCents,
    mode,
  }
}

/** Round a cash amount to the configured increment (SA: no 5c coins). */
export function roundCashAmount(
  amount: number,
  config: CashRoundingConfig,
): { rounded: number; adjustment: number } {
  if (!config.enabled || amount <= 0.005) {
    return { rounded: round2(amount), adjustment: 0 }
  }
  const inc = config.incrementCents
  const cents = Math.round(amount * 100)
  let roundedCents: number
  if (config.mode === 'down') {
    roundedCents = Math.floor(cents / inc) * inc
  } else if (config.mode === 'up') {
    roundedCents = Math.ceil(cents / inc) * inc
  } else {
    roundedCents = Math.round(cents / inc) * inc
  }
  const rounded = round2(roundedCents / 100)
  return { rounded, adjustment: round2(rounded - amount) }
}

export type PaymentSplitInput = {
  merchandiseTotal: number
  loyaltyDiscount?: number
  storeCredit?: number
  onAccount?: number
  cardAmount?: number
  config: CashRoundingConfig
}

/** Cash leg and rounding adjustment once card / voucher / account / loyalty are known. */
export function computeCashPaymentLeg(input: PaymentSplitInput): {
  cashDueExact: number
  cashAmount: number
  cardAmount: number
  cashRoundingAdjustment: number
  payableTotal: number
} {
  const loyaltyDiscount = round2(input.loyaltyDiscount ?? 0)
  const storeCredit = round2(input.storeCredit ?? 0)
  const onAccount = round2(input.onAccount ?? 0)
  const cardAmount = round2(input.cardAmount ?? 0)
  const remainingAfterScOa = round2(input.merchandiseTotal - storeCredit - onAccount - loyaltyDiscount)
  const cardApplied = round2(Math.min(cardAmount, Math.max(0, remainingAfterScOa)))
  const cashDueExact = round2(Math.max(0, remainingAfterScOa - cardApplied))
  const { rounded: cashAmount, adjustment: cashRoundingAdjustment } = roundCashAmount(
    cashDueExact,
    input.config,
  )
  const payableTotal = round2(input.merchandiseTotal + cashRoundingAdjustment)
  return { cashDueExact, cashAmount, cardAmount: cardApplied, cashRoundingAdjustment, payableTotal }
}

export type CheckoutTenderInput = {
  merchandiseTotal: number
  loyaltyDiscount?: number
  storeCredit?: number
  onAccount?: number
  cashReceived: number
  cardReceived: number
  config: CashRoundingConfig
}

export function computeCheckoutTenders(input: CheckoutTenderInput): {
  cashDueExact: number
  cashAmount: number
  cardAmount: number
  cashRoundingAdjustment: number
  payableTotal: number
  covered: number
  amountDue: number
  isComplete: boolean
  changeDue: number
} {
  const loyaltyDiscount = round2(input.loyaltyDiscount ?? 0)
  const storeCredit = round2(input.storeCredit ?? 0)
  const onAccount = round2(input.onAccount ?? 0)
  const leg = computeCashPaymentLeg({
    merchandiseTotal: input.merchandiseTotal,
    loyaltyDiscount,
    storeCredit,
    onAccount,
    cardAmount: input.cardReceived,
    config: input.config,
  })
  const covered = round2(
    input.cashReceived + input.cardReceived + storeCredit + onAccount + loyaltyDiscount,
  )
  const amountDue = round2(Math.max(0, leg.payableTotal - covered))
  const changeDue = round2(Math.max(0, covered - leg.payableTotal))
  return {
    ...leg,
    covered,
    amountDue,
    isComplete: amountDue <= 0.02,
    changeDue,
  }
}

/** Max card tender before cash leg (exact, not rounded). */
export function maxCardTender(input: Omit<CheckoutTenderInput, 'cashReceived' | 'cardReceived'> & {
  cardReceived: number
}): number {
  const loyaltyDiscount = round2(input.loyaltyDiscount ?? 0)
  const storeCredit = round2(input.storeCredit ?? 0)
  const onAccount = round2(input.onAccount ?? 0)
  const remainingAfterScOa = round2(
    input.merchandiseTotal - storeCredit - onAccount - loyaltyDiscount,
  )
  return round2(Math.max(0, remainingAfterScOa - input.cardReceived))
}
