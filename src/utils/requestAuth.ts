import { hasPermission } from '../permissions/catalog.js'

type Authed = NonNullable<import('express').Request['user']>

/** Legacy rule: only some roles could set a line/quote price above catalog. */
export function canChargeAboveCatalogPrice(user: Authed | undefined): boolean {
  if (!user) return false
  return hasPermission(user.permissions, user.role, 'register.price_override')
}

/** Lay-by deposit % / expiry overrides and similar manager-only POS actions. */
export function isRegisterManager(user: Authed | undefined): boolean {
  if (!user) return false
  return hasPermission(user.permissions, user.role, 'register.manager')
}
