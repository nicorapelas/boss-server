import type { IStoreSettings } from '../models/StoreSettings.js'

export type LoyaltyProgramConfig = {
  enabled: boolean
  /** Whole points earned per R1 of eligible spend (e.g. 1 = 1 point per rand). */
  pointsPerRand: number
  /** Rand discount value of one point (e.g. 0.1 = 100 points → R10). */
  redeemValuePerPoint: number
  minRedeemPoints: number
  /** Max share of sale total redeemable via points (0–100). */
  maxRedeemPercent: number
}

export const DEFAULT_LOYALTY_PROGRAM: LoyaltyProgramConfig = {
  enabled: false,
  pointsPerRand: 1,
  redeemValuePerPoint: 0.1,
  minRedeemPoints: 100,
  maxRedeemPercent: 50,
}

export function loyaltyProgramFromSettings(doc: Pick<IStoreSettings, 'loyaltyProgram'> | null | undefined): LoyaltyProgramConfig {
  const raw = doc?.loyaltyProgram
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_LOYALTY_PROGRAM }
  const o = raw as Record<string, unknown>
  const enabled = o.enabled === true
  const pointsPerRand = Number(o.pointsPerRand)
  const redeemValuePerPoint = Number(o.redeemValuePerPoint)
  const minRedeemPoints = Number(o.minRedeemPoints)
  const maxRedeemPercent = Number(o.maxRedeemPercent)
  return {
    enabled,
    pointsPerRand: Number.isFinite(pointsPerRand) && pointsPerRand > 0 ? pointsPerRand : DEFAULT_LOYALTY_PROGRAM.pointsPerRand,
    redeemValuePerPoint:
      Number.isFinite(redeemValuePerPoint) && redeemValuePerPoint > 0
        ? redeemValuePerPoint
        : DEFAULT_LOYALTY_PROGRAM.redeemValuePerPoint,
    minRedeemPoints:
      Number.isFinite(minRedeemPoints) && minRedeemPoints >= 0
        ? Math.floor(minRedeemPoints)
        : DEFAULT_LOYALTY_PROGRAM.minRedeemPoints,
    maxRedeemPercent:
      Number.isFinite(maxRedeemPercent) && maxRedeemPercent >= 0 && maxRedeemPercent <= 100
        ? maxRedeemPercent
        : DEFAULT_LOYALTY_PROGRAM.maxRedeemPercent,
  }
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function pointsEarnedForSpend(spend: number, cfg: LoyaltyProgramConfig): number {
  if (spend <= 0.005 || cfg.pointsPerRand <= 0) return 0
  return Math.floor(spend * cfg.pointsPerRand)
}

export function discountForPoints(points: number, cfg: LoyaltyProgramConfig): number {
  if (points <= 0 || cfg.redeemValuePerPoint <= 0) return 0
  return round2(points * cfg.redeemValuePerPoint)
}

export function maxRedeemPointsForSale(
  saleTotal: number,
  memberBalance: number,
  cfg: LoyaltyProgramConfig,
): number {
  if (!cfg.enabled || saleTotal <= 0.005 || memberBalance < cfg.minRedeemPoints) return 0
  const capByPercent = Math.floor((saleTotal * (cfg.maxRedeemPercent / 100)) / cfg.redeemValuePerPoint)
  const capByBalance = Math.floor(memberBalance)
  return Math.max(0, Math.min(capByBalance, capByPercent))
}
