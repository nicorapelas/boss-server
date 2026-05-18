/** Max units a manager-approved POS override may sell above non-negative available stock. */
export const MANAGER_STOCK_OVERRIDE_MAX_UNITS = 3

export type StockOverrideClaim = {
  stockOverrideApproved?: boolean
  stockOverrideScope?: string
}

export function managerStockOverrideAllowsQty(available: number, qty: number): boolean {
  const base = Math.max(0, available)
  return qty <= base + MANAGER_STOCK_OVERRIDE_MAX_UNITS
}

export function saleNeedsStockOverride(available: number, qty: number): boolean {
  return qty > Math.max(0, available)
}

/** POS sets scope after manager approval; used to honor override even if JWT permissions are stale. */
export function isTrustedPosStockOverrideClaim(row: StockOverrideClaim): boolean {
  return (
    row.stockOverrideApproved === true &&
    (row.stockOverrideScope === 'offline' || row.stockOverrideScope === 'online')
  )
}

/**
 * Whether checkout may proceed when on-hand (minus lay-by reserve) is below line qty.
 * Trusted POS claims (approved + scope) are honored within the +N cap without re-checking JWT manager.
 */
export function canApplyManagerStockOverride(
  row: StockOverrideClaim,
  available: number,
  qty: number,
  userCanManager: boolean,
): boolean {
  if (!saleNeedsStockOverride(available, qty)) return true
  if (!managerStockOverrideAllowsQty(available, qty)) return false
  if (isTrustedPosStockOverrideClaim(row)) return true
  return row.stockOverrideApproved === true && userCanManager
}

export function shouldRelaxStockDecrement(
  row: StockOverrideClaim,
  available: number,
  qty: number,
  userCanManager: boolean,
): boolean {
  return saleNeedsStockOverride(available, qty) && canApplyManagerStockOverride(row, available, qty, userCanManager)
}
