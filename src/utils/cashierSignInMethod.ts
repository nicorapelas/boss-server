export const CASHIER_SIGN_IN_METHODS = [
  'badge',
  'face',
  'password',
  'offline_badge',
  'offline_password',
] as const

export type CashierSignInMethod = (typeof CASHIER_SIGN_IN_METHODS)[number]

export function parseCashierSignInMethod(raw: unknown): CashierSignInMethod | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim() as CashierSignInMethod
  return (CASHIER_SIGN_IN_METHODS as readonly string[]).includes(v) ? v : null
}

export function cashierSignInMethodLabel(method: CashierSignInMethod | string | null | undefined): string {
  switch (method) {
    case 'badge':
      return 'Badge scan'
    case 'face':
      return 'Face recognition'
    case 'password':
      return 'Email & password'
    case 'offline_badge':
      return 'Badge scan (offline)'
    case 'offline_password':
      return 'Email & password (offline)'
    default:
      return ''
  }
}
