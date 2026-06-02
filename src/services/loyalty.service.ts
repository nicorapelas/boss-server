import { type ClientSession, Types } from 'mongoose'
import { Sale } from '../models/Sale.js'
import { LoyaltyLedger, LoyaltyMember, LoyaltyPhoneChange } from '../models/LoyaltyMember.js'
import { ensureStoreSettingsDoc } from '../controllers/storeSettings.controller.js'
import {
  discountForPoints,
  loyaltyProgramFromSettings,
  maxRedeemPointsForSale,
  pointsEarnedForSpend,
  round2,
  type LoyaltyProgramConfig,
} from '../utils/loyaltyProgram.js'
import { isValidPhoneDigits, normalizePhone } from '../utils/phone.js'

export function maskPhone(phone: string): string {
  const digits = normalizePhone(phone)
  if (digits.length <= 4) return '****'
  const last4 = digits.slice(-4)
  if (digits.length <= 7) return `*** ${last4}`
  return `*** *** ${last4}`
}

export async function getLoyaltyProgramConfig(): Promise<LoyaltyProgramConfig> {
  const doc = await ensureStoreSettingsDoc()
  return loyaltyProgramFromSettings(doc)
}

export async function getOrCreateLoyaltyMember(phone: string, session?: ClientSession) {
  const normalized = normalizePhone(phone)
  if (!isValidPhoneDigits(normalized)) {
    throw new Error('INVALID_PHONE')
  }
  let member = await LoyaltyMember.findOne({ phone: normalized }).session(session ?? null)
  if (!member) {
    const created = await LoyaltyMember.create(
      [{ phone: normalized, pointsBalance: 0, status: 'active', optedInAt: new Date() }],
      session ? { session } : undefined,
    )
    member = created[0] ?? null
  }
  if (!member) throw new Error('LOYALTY_MEMBER_CREATE_FAILED')
  if (member.status === 'blocked') throw new Error('LOYALTY_BLOCKED')
  return member
}

export type LoyaltyLookupResult = {
  memberId: string
  phoneMasked: string
  pointsBalance: number
  program: LoyaltyProgramConfig
}

export async function lookupLoyaltyMember(phone: string): Promise<LoyaltyLookupResult | null> {
  const cfg = await getLoyaltyProgramConfig()
  if (!cfg.enabled) return null
  const normalized = normalizePhone(phone)
  if (!isValidPhoneDigits(normalized)) return null
  const member = await LoyaltyMember.findOne({ phone: normalized }).lean()
  if (!member || member.status === 'blocked') return null
  return {
    memberId: String(member._id),
    phoneMasked: maskPhone(normalized),
    pointsBalance: Math.max(0, Math.floor(Number(member.pointsBalance ?? 0))),
    program: cfg,
  }
}

export type LoyaltyCheckoutPlan = {
  phone: string
  memberId: Types.ObjectId
  pointsRedeemed: number
  loyaltyDiscountAmount: number
  pointsEarned: number
}

export async function planLoyaltyForSale(input: {
  phone: string
  saleTotal: number
  pointsToRedeem: number
  /** Exclude on-account-only sales from earn. */
  earnEligible: boolean
}): Promise<LoyaltyCheckoutPlan | null> {
  const cfg = await getLoyaltyProgramConfig()
  if (!cfg.enabled) return null
  const normalized = normalizePhone(input.phone)
  if (!normalized) return null
  const member = await getOrCreateLoyaltyMember(normalized)
  const balance = Math.max(0, Math.floor(Number(member.pointsBalance ?? 0)))
  const maxRedeem = maxRedeemPointsForSale(input.saleTotal, balance, cfg)
  const pointsRedeemed = Math.min(Math.max(0, Math.floor(input.pointsToRedeem)), maxRedeem)
  if (pointsRedeemed > 0 && pointsRedeemed < cfg.minRedeemPoints) {
    throw new Error('LOYALTY_MIN_REDEEM')
  }
  const loyaltyDiscountAmount = discountForPoints(pointsRedeemed, cfg)
  const eligibleSpend = round2(Math.max(0, input.saleTotal - loyaltyDiscountAmount))
  const pointsEarned = input.earnEligible ? pointsEarnedForSpend(eligibleSpend, cfg) : 0
  return {
    phone: normalized,
    memberId: member._id as Types.ObjectId,
    pointsRedeemed,
    loyaltyDiscountAmount,
    pointsEarned,
  }
}

function loyaltyLedgerCreatedBy(userId: string): Types.ObjectId | undefined {
  return Types.ObjectId.isValid(userId) ? new Types.ObjectId(userId) : undefined
}

/** Apply earn/redeem ledger entries once per sale (safe for idempotent sale retries). */
export async function ensureLoyaltyAppliedForSale(
  sale: {
    _id: Types.ObjectId
    loyaltyMemberId?: Types.ObjectId | null
    loyaltyPhone?: string | null
    loyaltyPointsEarned?: number
    loyaltyPointsRedeemed?: number
  },
  userId: string,
  session?: ClientSession,
) {
  const memberId = sale.loyaltyMemberId
  const phone = sale.loyaltyPhone ? normalizePhone(sale.loyaltyPhone) : ''
  const redeemed = Math.max(0, Math.floor(Number(sale.loyaltyPointsRedeemed ?? 0)))
  const earned = Math.max(0, Math.floor(Number(sale.loyaltyPointsEarned ?? 0)))
  if (!memberId || !phone || (redeemed <= 0 && earned <= 0)) return

  const opts = session ? { session } : undefined
  const createdBy = loyaltyLedgerCreatedBy(userId)
  const saleId = sale._id

  if (redeemed > 0) {
    const existingRedeem = await LoyaltyLedger.findOne({
      refType: 'sale',
      refId: saleId,
      kind: 'redeem',
    }).session(session ?? null)
    if (!existingRedeem) {
      const updated = await LoyaltyMember.findOneAndUpdate(
        { _id: memberId, pointsBalance: { $gte: redeemed } },
        { $inc: { pointsBalance: -redeemed } },
        { new: true, ...(opts ?? {}) },
      )
      if (!updated) throw new Error('INSUFFICIENT_LOYALTY_POINTS')
      await LoyaltyLedger.create(
        [
          {
            memberId,
            phone,
            points: -redeemed,
            kind: 'redeem',
            refType: 'sale',
            refId: saleId,
            note: 'Sale checkout',
            ...(createdBy ? { createdBy } : {}),
          },
        ],
        opts,
      )
    }
  }

  if (earned > 0) {
    const existingEarn = await LoyaltyLedger.findOne({
      refType: 'sale',
      refId: saleId,
      kind: 'earn',
    }).session(session ?? null)
    if (!existingEarn) {
      await LoyaltyMember.updateOne({ _id: memberId }, { $inc: { pointsBalance: earned } }, opts)
      await LoyaltyLedger.create(
        [
          {
            memberId,
            phone,
            points: earned,
            kind: 'earn',
            refType: 'sale',
            refId: saleId,
            note: 'Sale checkout',
            ...(createdBy ? { createdBy } : {}),
          },
        ],
        opts,
      )
    }
  }
}

export async function applyLoyaltyOnSale(
  plan: LoyaltyCheckoutPlan,
  saleId: Types.ObjectId,
  userId: string,
  session?: ClientSession,
) {
  await ensureLoyaltyAppliedForSale(
    {
      _id: saleId,
      loyaltyMemberId: plan.memberId,
      loyaltyPhone: plan.phone,
      loyaltyPointsRedeemed: plan.pointsRedeemed,
      loyaltyPointsEarned: plan.pointsEarned,
    },
    userId,
    session,
  )
}

export async function reverseLoyaltyForRefund(input: {
  sale: {
    _id: Types.ObjectId
    loyaltyMemberId?: Types.ObjectId | null
    loyaltyPhone?: string | null
    loyaltyPointsEarned?: number
    loyaltyPointsRedeemed?: number
    total: number
  }
  refundFraction: number
  userId: string
}) {
  const memberId = input.sale.loyaltyMemberId
  const phone = input.sale.loyaltyPhone ? normalizePhone(input.sale.loyaltyPhone) : ''
  const earned = Math.max(0, Math.floor(Number(input.sale.loyaltyPointsEarned ?? 0)))
  const redeemed = Math.max(0, Math.floor(Number(input.sale.loyaltyPointsRedeemed ?? 0)))
  if (!memberId || !phone || (earned <= 0 && redeemed <= 0)) return
  const frac = Math.min(1, Math.max(0, input.refundFraction))
  const clawEarn = Math.floor(earned * frac)
  const restoreRedeem = Math.floor(redeemed * frac)
  if (clawEarn <= 0 && restoreRedeem <= 0) return

  const createdBy = loyaltyLedgerCreatedBy(input.userId)
  if (clawEarn > 0) {
    await LoyaltyMember.updateOne({ _id: memberId }, { $inc: { pointsBalance: -clawEarn } })
    await LoyaltyLedger.create({
      memberId,
      phone,
      points: -clawEarn,
      kind: 'refund_clawback',
      refType: 'refund',
      refId: input.sale._id,
      note: 'Sale refund — earn reversed',
      ...(createdBy ? { createdBy } : {}),
    })
  }
  if (restoreRedeem > 0) {
    await LoyaltyMember.updateOne({ _id: memberId }, { $inc: { pointsBalance: restoreRedeem } })
    await LoyaltyLedger.create({
      memberId,
      phone,
      points: restoreRedeem,
      kind: 'refund_restore',
      refType: 'refund',
      refId: input.sale._id,
      note: 'Sale refund — redeem restored',
      ...(createdBy ? { createdBy } : {}),
    })
  }
}

export type LoyaltyPurchaseSummary = {
  _id: string
  saleId?: string
  createdAt?: string
  tillCode?: string
  total: number
  paymentMethod?: string
  itemCount: number
  loyaltyDiscountAmount?: number
  loyaltyPointsEarned?: number
  loyaltyPointsRedeemed?: number
  refundStatus?: 'partial' | 'refunded'
}

export async function listLoyaltyMemberPurchases(
  memberId: string,
  options?: { limit?: number; skip?: number },
): Promise<{ total: number; purchases: LoyaltyPurchaseSummary[] }> {
  if (!Types.ObjectId.isValid(memberId)) throw new Error('INVALID_MEMBER_ID')
  const member = await LoyaltyMember.findById(memberId).lean()
  if (!member) throw new Error('MEMBER_NOT_FOUND')

  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 200)
  const skip = Math.min(Math.max(options?.skip ?? 0, 0), 50_000)
  const oid = new Types.ObjectId(memberId)
  const phone = normalizePhone(member.phone)
  const filter = phone
    ? { $or: [{ loyaltyMemberId: oid }, { loyaltyPhone: phone }] }
    : { loyaltyMemberId: oid }

  const [total, rows] = await Promise.all([
    Sale.countDocuments(filter),
    Sale.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select({
        saleId: 1,
        createdAt: 1,
        tillCode: 1,
        total: 1,
        paymentMethod: 1,
        items: 1,
        loyaltyDiscountAmount: 1,
        loyaltyPointsEarned: 1,
        loyaltyPointsRedeemed: 1,
        refundStatus: 1,
      })
      .lean(),
  ])

  return {
    total,
    purchases: rows.map((s) => {
      const created = (s as { createdAt?: Date }).createdAt
      return {
      _id: String(s._id),
      saleId: typeof s.saleId === 'string' ? s.saleId : undefined,
      createdAt: created ? new Date(created).toISOString() : undefined,
      tillCode: typeof s.tillCode === 'string' ? s.tillCode : undefined,
      total: round2(Number(s.total ?? 0)),
      paymentMethod: typeof s.paymentMethod === 'string' ? s.paymentMethod : undefined,
      itemCount: Array.isArray(s.items) ? s.items.length : 0,
      loyaltyDiscountAmount:
        s.loyaltyDiscountAmount != null && s.loyaltyDiscountAmount > 0
          ? round2(Number(s.loyaltyDiscountAmount))
          : undefined,
      loyaltyPointsEarned:
        s.loyaltyPointsEarned != null && s.loyaltyPointsEarned > 0
          ? Math.floor(Number(s.loyaltyPointsEarned))
          : undefined,
      loyaltyPointsRedeemed:
        s.loyaltyPointsRedeemed != null && s.loyaltyPointsRedeemed > 0
          ? Math.floor(Number(s.loyaltyPointsRedeemed))
          : undefined,
      refundStatus: s.refundStatus === 'partial' || s.refundStatus === 'refunded' ? s.refundStatus : undefined,
    }
    }),
  }
}

export async function adminChangeLoyaltyPhone(input: {
  fromPhone: string
  toPhone: string
  userId: string
  note?: string
}) {
  const from = normalizePhone(input.fromPhone)
  const to = normalizePhone(input.toPhone)
  if (!isValidPhoneDigits(from) || !isValidPhoneDigits(to)) throw new Error('INVALID_PHONE')
  if (from === to) throw new Error('SAME_PHONE')

  const member = await LoyaltyMember.findOne({ phone: from })
  if (!member) throw new Error('MEMBER_NOT_FOUND')
  const existingTarget = await LoyaltyMember.findOne({ phone: to })
  if (existingTarget) throw new Error('PHONE_IN_USE')

  const balance = Math.max(0, Math.floor(Number(member.pointsBalance ?? 0)))
  member.phone = to
  await member.save()

  await LoyaltyPhoneChange.create({
    memberId: member._id,
    fromPhone: from,
    toPhone: to,
    changedBy: input.userId,
    note: input.note?.trim() || undefined,
  })

  await LoyaltyLedger.create({
    memberId: member._id,
    phone: to,
    points: 0,
    kind: 'phone_change',
    refType: 'admin',
    note: `Phone changed ${maskPhone(from)} → ${maskPhone(to)}`,
    createdBy: input.userId,
  })

  return { memberId: String(member._id), pointsBalance: balance, phoneMasked: maskPhone(to) }
}
