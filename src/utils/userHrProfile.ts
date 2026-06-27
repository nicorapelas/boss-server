export const USER_PAYMENT_TERMS = ['weekly', 'biweekly', 'monthly', 'custom'] as const
export type UserPaymentTerms = (typeof USER_PAYMENT_TERMS)[number]

export function parsePaymentTerms(raw: unknown): UserPaymentTerms | null | undefined {
  if (raw === null) return null
  if (raw === undefined) return undefined
  const v = String(raw).trim().toLowerCase()
  if (!v) return null
  return USER_PAYMENT_TERMS.includes(v as UserPaymentTerms) ? (v as UserPaymentTerms) : null
}

export function parseOptionalDate(raw: unknown): Date | null | undefined {
  if (raw === null) return null
  if (raw === undefined) return undefined
  const v = String(raw).trim()
  if (!v) return null
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return null
  return d
}

export function parseOptionalMoney(raw: unknown): number | null | undefined {
  if (raw === null) return null
  if (raw === undefined) return undefined
  if (raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100) / 100
}

export function parseOptionalString(raw: unknown): string | null | undefined {
  if (raw === null) return null
  if (raw === undefined) return undefined
  const v = String(raw).trim()
  return v || null
}

export type ParsedStaffLoan = {
  startDate?: Date | null
  amount?: number | null
  terms?: string | null
  notes?: string | null
}

export function parseStaffLoans(raw: unknown): ParsedStaffLoan[] | null | undefined {
  if (raw === null) return null
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) return null
  const out: ParsedStaffLoan[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    out.push({
      startDate: parseOptionalDate(row.startDate),
      amount: parseOptionalMoney(row.amount),
      terms: parseOptionalString(row.terms),
      notes: parseOptionalString(row.notes),
    })
  }
  return out
}
